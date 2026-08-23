/** Force-directed layout engine shared by the People and Financial graphs.
 *
 *  Why hand-rolled
 *  ---------------
 *  `d3-force` is not a dependency and adding one for ~200 lines of well-understood
 *  physics is not worth it. `@xyflow/react` is installed but is a node-editor, not
 *  a force layout. So this is deliberate, not ignorance of the alternatives.
 *
 *  What it fixes relative to the previous inline simulation in network.tsx
 *  ---------------------------------------------------------------------
 *  1. **It settles.** The old loop ran `requestAnimationFrame` forever with no
 *     energy decay, calling `setState` at 60 fps even on an empty graph. Here alpha
 *     decays and the loop reports "at rest" so the caller can stop drawing.
 *  2. **Time-scaled integration.** The old loop measured `dt` and then ignored it,
 *     so the layout drifted faster on a 144 Hz screen than on a 60 Hz one. Steps are
 *     normalised against a 60 fps reference and clamped, so a stalled tab cannot
 *     fling nodes across the canvas on the next frame.
 *  3. **Adjacency is precomputed.** The old spring pass ran
 *     `nodes.find(n => n.id === a)` twice per edge per frame — a linear scan inside
 *     the hot loop.
 *  4. **Drag carries neighbours.** Dragging pinned one node and left the springs to
 *     catch up next frame. Here a drag applies a hop-decayed share of the movement
 *     to nodes within a couple of hops, which is what makes a graph feel like a
 *     connected object rather than beads on elastic.
 *
 *  Repulsion is O(n²) all-pairs, deliberately. The backend caps the ego query at
 *  200 rows, so n stays in the low hundreds where 20k pair checks per frame is
 *  cheap; a Barnes-Hut quadtree would be more code for no gain at this size.
 *  ponytail: if n ever exceeds ~800, add spatial bucketing here rather than
 *  reaching for a library.
 */

export type FgNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position. Non-null means physics does not move this node. */
  fx: number | null;
  fy: number | null;
  /** Layout weight. Bigger nodes shove harder and drift less. */
  mass: number;
  /** Drawn radius in world units, used by collision resolution so bodies never
   *  overlap. Zero disables collision for this node. */
  radius: number;
};

export type FgEdge = { a: string; b: string };

export type FgParams = {
  repulsion: number;
  spring: number;
  gravity: number;
  damping: number;
  /** Preferred edge length in world units. */
  linkDistance: number;
  /** Centre of gravity. */
  cx: number;
  cy: number;
  /** Keep nodes inside [min, max] on both axes. Null disables clamping. */
  bounds: { min: number; max: number } | null;
  /** Extra clearance kept between node edges, in world units. */
  collidePadding: number;
};

export const FG_DEFAULTS: FgParams = {
  repulsion: 18,
  spring: 0.012,
  gravity: 0.002,
  damping: 0.82,
  linkDistance: 22,
  cx: 50,
  cy: 50,
  bounds: { min: 6, max: 94 },
  collidePadding: 1.2,
};

/** How much of a drag's movement neighbours inherit, indexed by hop distance.
 *
 *  Index 0 is the dragged node itself. The falloff is steep on purpose: at 0.5 the
 *  whole graph slides as a rigid block and dragging stops revealing structure,
 *  while below ~0.2 the connection is not felt at all. Two hops is the useful
 *  limit — three starts moving nodes the user cannot see. */
export const DRAG_FALLOFF = [1, 0.42, 0.16];

/** Reference frame time. Steps are scaled against this so behaviour matches the
 *  tuning the sliders were calibrated at, regardless of display refresh rate. */
const REF_FRAME_MS = 1000 / 60;
/** Never integrate more than this many reference frames in one step. A backgrounded
 *  tab returns with a huge dt; without the clamp the first frame explodes. */
const MAX_STEP_SCALE = 3;

/** Below this total kinetic energy per node the layout is called settled. */
const REST_ENERGY = 0.0004;

/** Floor on pair separation used for the repulsion denominator.
 *
 *  `repulsion / d²` is unbounded as d approaches 0. Measured on a 40-node chain
 *  without this floor: velocity reached 1.6e5 world units per frame in a 100-unit
 *  world, the bounds clamp caught the positions, and the layout then sat in a
 *  permanent standoff that never settled. Flooring d² is the standard guard and
 *  caps any single pair force at `repulsion / MIN_SEP²`. */
const MIN_SEP = 1.2;

/** Terminal speed per reference frame, in world units.
 *
 *  A second, independent safety net: even with the force floor, a node with many
 *  close neighbours accumulates their contributions. Nothing legible moves faster
 *  than a few units per frame in a 100-unit space, so clamping here costs no
 *  expressiveness and removes the last route to a numerical blow-up. */
const MAX_SPEED = 4;

export class ForceGraph {
  nodes: FgNode[] = [];
  edges: FgEdge[] = [];
  params: FgParams = { ...FG_DEFAULTS };

  /** id -> node, for O(1) lookup during drag and rendering. */
  private byId = new Map<string, FgNode>();
  /** id -> neighbour ids, precomputed so the spring pass does no searching. */
  private adj = new Map<string, string[]>();
  /** Cooling factor. Starts at 1 on a new layout and decays toward 0. */
  private alpha = 1;
  /** True once motion drops below REST_ENERGY. */
  settled = false;

  /** Replace the graph, preserving positions of nodes that already existed so a
   *  filter change does not throw away a layout the user has arranged. */
  setGraph(
    nodes: {
      id: string;
      x: number;
      y: number;
      mass?: number;
      pinned?: boolean;
      radius?: number;
    }[],
    edges: FgEdge[],
  ) {
    const prev = this.byId;
    this.nodes = nodes.map((n) => {
      const old = prev.get(n.id);
      return {
        id: n.id,
        x: old ? old.x : n.x,
        y: old ? old.y : n.y,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
        fx: n.pinned ? (old ? old.x : n.x) : null,
        fy: n.pinned ? (old ? old.y : n.y) : null,
        mass: n.mass ?? 1,
        radius: n.radius ?? 0,
      };
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges.filter((e) => this.byId.has(e.a) && this.byId.has(e.b));

    this.adj = new Map(this.nodes.map((n) => [n.id, [] as string[]]));
    for (const e of this.edges) {
      this.adj.get(e.a)!.push(e.b);
      this.adj.get(e.b)!.push(e.a);
    }
    this.reheat();
  }

  node(id: string): FgNode | undefined {
    return this.byId.get(id);
  }

  neighbours(id: string): string[] {
    return this.adj.get(id) ?? [];
  }

  /** Wake the layout up. Call after any change that should re-settle it. */
  reheat(to = 1) {
    this.alpha = Math.max(this.alpha, to);
    this.settled = false;
  }

  /** Hop distance from `id` out to `maxHops`, by breadth-first search.
   *  Used by drag to decide how much each neighbour inherits. */
  hopsFrom(id: string, maxHops: number): Map<string, number> {
    const seen = new Map<string, number>([[id, 0]]);
    let frontier = [id];
    for (let hop = 1; hop <= maxHops; hop++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of this.adj.get(cur) ?? []) {
          if (!seen.has(nb)) {
            seen.set(nb, hop);
            next.push(nb);
          }
        }
      }
      if (!next.length) break;
      frontier = next;
    }
    return seen;
  }

  /** Advance the simulation by one frame.
   *
   *  `dtMs` is real elapsed time; it is converted to a scale factor so the same
   *  slider values behave identically at 60 and 144 Hz. Returns true while the
   *  layout is still moving, false once it has come to rest — the caller uses that
   *  to stop requesting frames instead of spinning forever.
   */
  step(dtMs: number): boolean {
    if (this.settled) return false;
    const p = this.params;
    const nodes = this.nodes;
    const n = nodes.length;
    if (!n) {
      this.settled = true;
      return false;
    }

    const scale = Math.min(MAX_STEP_SCALE, Math.max(0.2, dtMs / REF_FRAME_MS));

    // Repulsion, all pairs. Force is divided by mass so a heavy seed barely reacts
    // while light leaf nodes are pushed clear.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // Exactly coincident nodes have no direction to separate along. Nudge
          // deterministically by index rather than randomly, so a layout is
          // reproducible between runs.
          dx = (i - j) * 0.01 || 0.01;
          dy = (j - i) * 0.007 || 0.007;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        // Direction from the true separation, magnitude from the floored one, so
        // very close nodes still push apart along the correct axis without the
        // force going to infinity.
        const f = (p.repulsion / Math.max(d2, MIN_SEP * MIN_SEP)) * scale;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;

        // Collision resolution, in the same pass because it needs the same pair
        // distance. Charge repulsion alone does NOT prevent overlap: it falls off
        // as 1/d² while a spring pulling two linked nodes together does not, so
        // connected nodes settle on top of each other and the labels collide. This
        // separates them positionally rather than by adding force, which converges
        // immediately instead of oscillating.
        const minDist = a.radius + b.radius + p.collidePadding;
        if (minDist > 0 && d < minDist) {
          const overlap = (minDist - d) / d;
          // Split the correction by inverse mass so a heavy pinned hub barely
          // yields and the light node moves aside.
          const total = a.mass + b.mass;
          const shiftA = (b.mass / total) * overlap;
          const shiftB = (a.mass / total) * overlap;
          if (a.fx == null) {
            a.x -= dx * shiftA;
            a.y -= dy * shiftA;
          }
          if (b.fx == null) {
            b.x += dx * shiftB;
            b.y += dy * shiftB;
          }
        }
      }
    }

    // Springs along edges, pulling toward linkDistance.
    for (const e of this.edges) {
      const A = this.byId.get(e.a)!;
      const B = this.byId.get(e.b)!;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const k = p.spring * (d - p.linkDistance) * scale;
      const fx = (dx / d) * k;
      const fy = (dy / d) * k;
      A.vx += fx / A.mass;
      A.vy += fy / A.mass;
      B.vx -= fx / B.mass;
      B.vy -= fy / B.mass;
    }

    // Gravity, damping, integration.
    let energy = 0;
    for (const node of nodes) {
      if (node.fx != null && node.fy != null) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx += (p.cx - node.x) * p.gravity * scale;
      node.vy += (p.cy - node.y) * p.gravity * scale;
      // Damping is applied per reference frame, so a long step damps more.
      const damp = Math.pow(p.damping, scale);
      node.vx *= damp;
      node.vy *= damp;
      // Terminal speed, applied to the vector so direction is preserved.
      const sp = Math.hypot(node.vx, node.vy);
      if (sp > MAX_SPEED) {
        node.vx = (node.vx / sp) * MAX_SPEED;
        node.vy = (node.vy / sp) * MAX_SPEED;
      }
      node.x += node.vx * scale * this.alpha;
      node.y += node.vy * scale * this.alpha;
      if (p.bounds) {
        // A wall absorbs momentum. Clamping the position while leaving velocity
        // intact is what made the old layout jitter forever: springs kept pushing
        // into the boundary, the clamp kept undoing it, and the residual velocity
        // never decayed — a limit cycle that reads as a graph that will not sit
        // still. Measured on a 12-node chain: energy plateaued at 1.23 and stayed
        // there for 20,000 frames.
        if (node.x <= p.bounds.min || node.x >= p.bounds.max) {
          node.x = Math.max(p.bounds.min, Math.min(p.bounds.max, node.x));
          node.vx = 0;
        }
        if (node.y <= p.bounds.min || node.y >= p.bounds.max) {
          node.y = Math.max(p.bounds.min, Math.min(p.bounds.max, node.y));
          node.vy = 0;
        }
      }
      energy += node.vx * node.vx + node.vy * node.vy;
    }

    // Cool down. The layout keeps a small floor of alpha so a nudge still relaxes,
    // but energy is what actually decides "settled".
    this.alpha = Math.max(0.15, this.alpha * Math.pow(0.985, scale));
    if (energy / n < REST_ENERGY) {
      this.settled = true;
      return false;
    }
    return true;
  }

  // ── Drag ───────────────────────────────────────────────────────────────────

  private drag: { id: string; weights: [FgNode, number][] } | null = null;

  /** Begin dragging `id`. Pins the node and gathers the neighbours that will be
   *  carried with it, weighted by hop distance. */
  dragStart(id: string) {
    const node = this.byId.get(id);
    if (!node) return;
    const hops = this.hopsFrom(id, DRAG_FALLOFF.length - 1);
    const weights: [FgNode, number][] = [];
    for (const [nid, hop] of hops) {
      const nb = this.byId.get(nid);
      if (!nb) continue;
      const w = DRAG_FALLOFF[hop] ?? 0;
      if (w > 0) weights.push([nb, w]);
    }
    this.drag = { id, weights };
    node.fx = node.x;
    node.fy = node.y;
    this.reheat();
  }

  /** Move the dragged node to an absolute world position, carrying neighbours.
   *
   *  Neighbours are nudged, not pinned: they receive a share of the movement and
   *  the springs then resolve the result, so releasing mid-drag relaxes naturally
   *  instead of snapping. */
  dragTo(x: number, y: number) {
    const d = this.drag;
    if (!d) return;
    const node = this.byId.get(d.id);
    if (!node) return;
    const dx = x - node.x;
    const dy = y - node.y;
    for (const [nb, w] of d.weights) {
      if (nb.id === d.id) continue;
      if (nb.fx != null) continue; // never drag a pinned node off its pin
      nb.x += dx * w;
      nb.y += dy * w;
      // Give them the drag velocity too, so they keep moving with momentum for a
      // frame or two after release rather than stopping dead.
      nb.vx = dx * w;
      nb.vy = dy * w;
    }
    node.x = x;
    node.y = y;
    node.fx = x;
    node.fy = y;
    node.vx = 0;
    node.vy = 0;
    this.reheat();
  }

  /** End the drag. `keepPinned` leaves the node where it was dropped. */
  dragEnd(keepPinned = false) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const node = this.byId.get(d.id);
    if (!node) return;
    if (!keepPinned) {
      node.fx = null;
      node.fy = null;
    }
    this.reheat();
  }

  get dragging(): string | null {
    return this.drag?.id ?? null;
  }
}

/** Edge length that actually fits `n` nodes inside a box of `span` units.
 *
 *  A fixed link distance is wrong at almost every graph size, and wrong in a way
 *  that is invisible: too large and every node is jammed against the bounds with
 *  the springs still pulling, which never reaches equilibrium. The old code used a
 *  constant 22 in an 88-unit box, so anything past about five nodes in a chain was
 *  permanently over-constrained.
 *
 *  `span / (2 * sqrt(n))` is the usual area-per-node heuristic: it treats the box
 *  as holding roughly sqrt(n) nodes per side. */
export function fitLinkDistance(n: number, span = 88): number {
  if (n <= 1) return span / 4;
  return Math.max(4, Math.min(26, span / (2 * Math.sqrt(n))));
}

/** Seed positions on a ring, with the pinned/seed nodes in the middle.
 *
 *  Deterministic by index rather than random: a random jitter makes the same
 *  query settle differently on every reload, which reads as instability. */
export function ringLayout(
  ids: string[],
  opts: { cx: number; cy: number; radius: number; centreIds?: Set<string> },
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const centre = opts.centreIds ?? new Set<string>();
  const outer = ids.filter((id) => !centre.has(id));
  ids
    .filter((id) => centre.has(id))
    .forEach((id) => {
      out[id] = { x: opts.cx, y: opts.cy };
    });
  outer.forEach((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, outer.length);
    // Golden-angle offset per index breaks up the perfect circle just enough that
    // edges do not all overlap on the first frame.
    const wobble = 1 + ((i * 0.618) % 1) * 0.18;
    out[id] = {
      x: opts.cx + opts.radius * wobble * Math.cos(a),
      y: opts.cy + opts.radius * wobble * Math.sin(a),
    };
  });
  return out;
}
