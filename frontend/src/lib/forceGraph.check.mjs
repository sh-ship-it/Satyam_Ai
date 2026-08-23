/** Self-check for the force-graph engine.
 *
 *  Run: node src/lib/forceGraph.check.mjs
 *
 *  The engine's failures are all *silent* — a layout that never settles still looks
 *  fine while burning a core, a drag that misses neighbours just feels stiff, and a
 *  frame-rate-dependent step only shows up on a different monitor. So each check
 *  below asserts a property that cannot be eyeballed.
 *
 *  Mirrors forceGraph.ts rather than importing it (that file is TypeScript). Kept
 *  adjacent so the two are edited together.
 */
import assert from "node:assert/strict";

const REF = 1000 / 60;
const MAX_STEP_SCALE = 3;
const REST_ENERGY = 0.0004;
const MIN_SEP = 1.2;
const MAX_SPEED = 4;
const DRAG_FALLOFF = [1, 0.42, 0.16];

class ForceGraph {
  nodes = [];
  edges = [];
  byId = new Map();
  adj = new Map();
  alpha = 1;
  settled = false;
  params = {
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
  drag = null;

  setGraph(nodes, edges) {
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
    this.adj = new Map(this.nodes.map((n) => [n.id, []]));
    for (const e of this.edges) {
      this.adj.get(e.a).push(e.b);
      this.adj.get(e.b).push(e.a);
    }
    this.reheat();
  }
  node(id) {
    return this.byId.get(id);
  }
  reheat(to = 1) {
    this.alpha = Math.max(this.alpha, to);
    this.settled = false;
  }
  hopsFrom(id, maxHops) {
    const seen = new Map([[id, 0]]);
    let frontier = [id];
    for (let hop = 1; hop <= maxHops; hop++) {
      const next = [];
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
  step(dtMs) {
    if (this.settled) return false;
    const p = this.params;
    const nodes = this.nodes;
    const n = nodes.length;
    if (!n) {
      this.settled = true;
      return false;
    }
    const scale = Math.min(MAX_STEP_SCALE, Math.max(0.2, dtMs / REF));
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (i - j) * 0.01 || 0.01;
          dy = (j - i) * 0.007 || 0.007;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (p.repulsion / Math.max(d2, MIN_SEP * MIN_SEP)) * scale;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;

        const minDist = a.radius + b.radius + p.collidePadding;
        if (minDist > 0 && d < minDist) {
          const overlap = (minDist - d) / d;
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
    for (const e of this.edges) {
      const A = this.byId.get(e.a);
      const B = this.byId.get(e.b);
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
      const damp = Math.pow(p.damping, scale);
      node.vx *= damp;
      node.vy *= damp;
      const sp = Math.hypot(node.vx, node.vy);
      if (sp > MAX_SPEED) {
        node.vx = (node.vx / sp) * MAX_SPEED;
        node.vy = (node.vy / sp) * MAX_SPEED;
      }
      node.x += node.vx * scale * this.alpha;
      node.y += node.vy * scale * this.alpha;
      if (p.bounds) {
        // A wall absorbs momentum — see forceGraph.ts for why this matters.
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
    this.alpha = Math.max(0.15, this.alpha * Math.pow(0.985, scale));
    if (energy / n < REST_ENERGY) {
      this.settled = true;
      return false;
    }
    return true;
  }
  dragStart(id) {
    const node = this.byId.get(id);
    if (!node) return;
    const hops = this.hopsFrom(id, DRAG_FALLOFF.length - 1);
    const weights = [];
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
  dragTo(x, y) {
    const d = this.drag;
    if (!d) return;
    const node = this.byId.get(d.id);
    if (!node) return;
    const dx = x - node.x;
    const dy = y - node.y;
    for (const [nb, w] of d.weights) {
      if (nb.id === d.id) continue;
      if (nb.fx != null) continue;
      nb.x += dx * w;
      nb.y += dy * w;
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
}

function fitLinkDistance(n, span = 88) {
  if (n <= 1) return span / 4;
  return Math.max(4, Math.min(26, span / (2 * Math.sqrt(n))));
}

function chain(n) {
  const g = new ForceGraph();
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: `n${i}`, x: 50 + i * 3, y: 50, mass: 1 });
  for (let i = 1; i < n; i++) edges.push({ a: `n${i - 1}`, b: `n${i}` });
  g.setGraph(nodes, edges);
  // Sized to the node count, as the real callers do. A fixed 22 over-constrains
  // anything past ~5 nodes in an 88-unit box.
  g.params.linkDistance = fitLinkDistance(n);
  return g;
}

// ── 1. it must actually settle, and in reasonable time, at every realistic size ─
// Sizes matter here: the first version settled at n=12 but sat in a permanent
// limit cycle at n=40, which is well inside the range a real ego graph reaches.
{
  for (const n of [3, 12, 40, 80]) {
    const g = chain(n);
    let frames = 0;
    while (g.step(REF) && frames < 20000) frames++;
    assert.ok(g.settled, `n=${n}: layout never settled — this is the bug that burns a CPU core`);
    assert.ok(frames < 6000, `n=${n}: took ${frames} frames to settle`);
    assert.equal(g.step(REF), false, `n=${n}: stepped again after settling`);
    for (const node of g.nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `n=${n}: NaN position`);
    }
  }
}

// ── 1b. a dense clump must not blow up ───────────────────────────────────────
// 30 nodes started at nearly the same point is the worst case for repulsion,
// which is unbounded as separation approaches zero.
{
  const g = new ForceGraph();
  const nodes = [];
  for (let i = 0; i < 30; i++) nodes.push({ id: `c${i}`, x: 50 + i * 1e-4, y: 50 });
  g.setGraph(nodes, []);
  g.params.linkDistance = fitLinkDistance(30);
  let maxSpeed = 0;
  for (let f = 0; f < 3000 && g.step(REF); f++) {
    for (const n of g.nodes) maxSpeed = Math.max(maxSpeed, Math.hypot(n.vx, n.vy));
  }
  assert.ok(
    maxSpeed <= MAX_SPEED + 1e-9,
    `speed reached ${maxSpeed} — terminal velocity not enforced`,
  );
  for (const n of g.nodes) {
    assert.ok(Number.isFinite(n.x), "coincident clump produced a non-finite position");
  }
  assert.ok(g.settled, "coincident clump never settled");
}

// ── 2. frame-rate independence ───────────────────────────────────────────────
// The same elapsed time at 60 Hz and at 144 Hz must land in nearly the same place.
{
  const a = chain(8);
  const b = chain(8);
  // 60 frames of 16.67ms  vs  144 frames of 6.94ms — both exactly 1 second.
  for (let i = 0; i < 60; i++) a.step(REF);
  for (let i = 0; i < 144; i++) b.step(1000 / 144);
  let worst = 0;
  for (const n of a.nodes) {
    const m = b.node(n.id);
    worst = Math.max(worst, Math.hypot(n.x - m.x, n.y - m.y));
  }
  // Different integration granularity will never match exactly; the point is that
  // the layouts stay comparable instead of diverging by tens of units.
  assert.ok(worst < 3.5, `60Hz vs 144Hz diverged by ${worst.toFixed(2)} world units`);
}

// ── 3. a huge dt must not explode the layout ─────────────────────────────────
{
  const g = chain(10);
  const before = g.nodes.map((n) => ({ ...n }));
  g.step(5000); // tab was backgrounded for 5 seconds
  for (const n of g.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), "NaN position after a long step");
    const was = before.find((b) => b.id === n.id);
    assert.ok(
      Math.hypot(n.x - was.x, n.y - was.y) < 40,
      "a single long frame flung a node across the canvas",
    );
  }
}

// ── 4. drag carries neighbours, with falloff, and leaves 3-hop nodes alone ───
{
  const g = chain(6); // n0 - n1 - n2 - n3 - n4 - n5
  for (let i = 0; i < 400 && g.step(REF); i++);
  const snap = new Map(g.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  g.dragStart("n0");
  const from = g.node("n0");
  g.dragTo(from.x + 10, from.y);

  const moved = (id) => Math.abs(g.node(id).x - snap.get(id).x);
  assert.ok(Math.abs(g.node("n0").x - (snap.get("n0").x + 10)) < 1e-6, "dragged node did not land");
  const h1 = moved("n1");
  const h2 = moved("n2");
  const h3 = moved("n3");
  assert.ok(h1 > 3.5, `1-hop neighbour barely moved (${h1.toFixed(2)}) — drag feels disconnected`);
  assert.ok(
    h2 > 1.0 && h2 < h1,
    `2-hop should follow less than 1-hop (h1=${h1.toFixed(2)} h2=${h2.toFixed(2)})`,
  );
  assert.ok(h3 < 0.001, `3-hop node moved ${h3.toFixed(3)} — falloff should stop at 2 hops`);

  // Releasing must unpin, so the layout can relax again.
  g.dragEnd();
  assert.equal(g.node("n0").fx, null, "node stayed pinned after dragEnd()");
  assert.ok(!g.settled, "dragging should have reheated the layout");

  // ...and dragEnd(true) must keep it where it was dropped.
  g.dragStart("n2");
  g.dragTo(70, 70);
  g.dragEnd(true);
  assert.equal(g.node("n2").fx, 70, "dragEnd(true) did not keep the pin");
}

// ── 5. pinned nodes never move, not even under drag or repulsion ─────────────
{
  const g = new ForceGraph();
  g.setGraph(
    [
      { id: "seed", x: 50, y: 50, mass: 4, pinned: true },
      { id: "a", x: 52, y: 50 },
      { id: "b", x: 48, y: 50 },
    ],
    [
      { a: "seed", b: "a" },
      { a: "seed", b: "b" },
    ],
  );
  for (let i = 0; i < 600 && g.step(REF); i++);
  const s = g.node("seed");
  assert.equal(s.x, 50, "pinned seed drifted in x");
  assert.equal(s.y, 50, "pinned seed drifted in y");

  // Dragging a neighbour must not drag the pinned seed along.
  g.dragStart("a");
  g.dragTo(g.node("a").x + 20, g.node("a").y + 20);
  assert.equal(g.node("seed").x, 50, "drag moved a pinned node");
}

// ── 6. positions survive a graph update (filter change must not reset layout) ─
{
  const g = chain(6);
  for (let i = 0; i < 400 && g.step(REF); i++);
  const keep = { x: g.node("n3").x, y: g.node("n3").y };
  // Re-set with one node dropped, as an edge filter would.
  g.setGraph(
    ["n0", "n1", "n2", "n3", "n4"].map((id) => ({ id, x: 0, y: 0 })),
    [
      { a: "n0", b: "n1" },
      { a: "n1", b: "n2" },
      { a: "n2", b: "n3" },
      { a: "n3", b: "n4" },
    ],
  );
  assert.ok(
    Math.hypot(g.node("n3").x - keep.x, g.node("n3").y - keep.y) < 1e-9,
    "existing node lost its position on graph update",
  );
  // Edges referencing dropped nodes must be filtered out, or the spring pass
  // dereferences undefined.
  g.setGraph([{ id: "n0", x: 1, y: 1 }], [{ a: "n0", b: "gone" }]);
  assert.equal(g.edges.length, 0, "edge to a missing node was not filtered");
  assert.doesNotThrow(() => g.step(REF), "stepping threw on a dangling edge");
}

// ── 7. bounds are respected ──────────────────────────────────────────────────
{
  const g = new ForceGraph();
  // Two nodes almost on top of each other repel hard; without clamping they leave.
  g.setGraph(
    [
      { id: "a", x: 50, y: 50 },
      { id: "b", x: 50.001, y: 50 },
    ],
    [],
  );
  for (let i = 0; i < 2000 && g.step(REF); i++);
  for (const n of g.nodes) {
    assert.ok(n.x >= 6 && n.x <= 94, `x out of bounds: ${n.x}`);
    assert.ok(n.y >= 6 && n.y <= 94, `y out of bounds: ${n.y}`);
  }
}

// ── 8. collision: bodies must not overlap once settled ───────────────────────
// Charge repulsion alone does not achieve this — it falls off as 1/d² while the
// spring pulling two linked nodes together does not, so connected nodes settle on
// top of each other. This is the check that catches a missing collision pass.
{
  const g = new ForceGraph();
  const R = 4;
  const nodes = [];
  const edges = [];
  // A star: five leaves all linked to one hub, so springs actively pull them in.
  nodes.push({ id: "hub", x: 50, y: 50, radius: R, mass: 2 });
  for (let i = 0; i < 5; i++) {
    nodes.push({ id: `l${i}`, x: 50 + Math.cos(i) * 2, y: 50 + Math.sin(i) * 2, radius: R });
    edges.push({ a: "hub", b: `l${i}` });
  }
  g.setGraph(nodes, edges);
  // Deliberately tighter than the bodies can fit: the springs want 6 units of
  // separation while collision needs 4 + 4 + 1.2 = 9.2. Without a collision pass
  // the springs win and the nodes sit inside each other, so this is what makes the
  // assertion below meaningful rather than trivially satisfied.
  g.params.linkDistance = 2;
  g.params.spring = 0.25; // strong: springs actively haul the leaves onto the hub
  g.params.repulsion = 1; // weak: charge must not do collision's job for it
  g.params.gravity = 0;
  for (let f = 0; f < 6000 && g.step(REF); f++);

  let worstOverlap = 0;
  for (let i = 0; i < g.nodes.length; i++) {
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i];
      const b = g.nodes[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const need = a.radius + b.radius;
      worstOverlap = Math.max(worstOverlap, need - d);
    }
  }
  // Allow a hair of tolerance: the pass is iterative, not a hard constraint solver.
  assert.ok(
    worstOverlap < 0.6,
    `nodes overlap by ${worstOverlap.toFixed(2)} world units — collision not resolving`,
  );
}

console.log("forceGraph self-check: all 9 groups passed");
