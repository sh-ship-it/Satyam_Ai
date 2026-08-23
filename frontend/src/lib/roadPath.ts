/** Dijkstra over an OpenStreetMap arterial road graph.
 *
 *  Why the search runs in the browser
 *  ----------------------------------
 *  The Dispatch screen animates the search itself, so it needs the order in which
 *  nodes were settled — not just the winning path. A routing engine like OSRM
 *  returns the path only and discards its frontier, so no amount of asking OSRM
 *  nicely can produce this animation. Running the search here keeps every
 *  intermediate step available to render.
 *
 *  This is genuine Dijkstra with a binary heap, over real OSM geometry fetched by
 *  `/api/ops/roadgraph`. Edge cost is metres.
 *
 *  What it is NOT
 *  --------------
 *  Not a traffic-aware router. The graph carries no one-way flags, no turn
 *  restrictions and no signal timing, so the result is the shortest *distance*
 *  along arterial roads — not the fastest drive. Any UI built on this must say so
 *  rather than presenting the number as an ETA.
 */
import { API_BASE, getAuthToken } from "./api/client";

export type LatLng = { lat: number; lng: number };

export type RoadGraph = {
  provider: string;
  nodes: [number, number][];
  /** `[fromIndex, toIndex, metres]`, undirected. */
  edges: [number, number, number][];
  cached?: boolean;
  ways?: number;
  note?: string | null;
};

export type SearchResult = {
  /** The shortest path, as coordinates ready for Leaflet. */
  path: [number, number][];
  /** Total path length in metres along roads. */
  distanceM: number;
  /** Edges in the order the search settled them — the animation timeline. */
  explored: [number, number][][];
  /** How many nodes the search settled before reaching the target. */
  settled: number;
};

/** Padding around the origin/scene box, in degrees (~2.2 km).
 *
 *  Needed because the shortest road route routinely leaves the rectangle spanned
 *  by its two endpoints — a bypass or a flyover can bow well outside it. Too
 *  small and the search is boxed in and finds a worse path (or none); too large
 *  and the payload grows for nothing. */
const BBOX_PAD_DEG = 0.02;

export function graphBbox(a: LatLng, b: LatLng) {
  return {
    west: Math.min(a.lng, b.lng) - BBOX_PAD_DEG,
    south: Math.min(a.lat, b.lat) - BBOX_PAD_DEG,
    east: Math.max(a.lng, b.lng) + BBOX_PAD_DEG,
    north: Math.max(a.lat, b.lat) + BBOX_PAD_DEG,
  };
}

export async function fetchRoadGraph(a: LatLng, b: LatLng): Promise<RoadGraph> {
  const { west, south, east, north } = graphBbox(a, b);
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/ops/roadgraph?bbox=${west},${south},${east},${north}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`road graph unavailable (${res.status})`);
  return (await res.json()) as RoadGraph;
}

/** Squared-degree distance. Fine for "which node is closest": comparing squares
 *  avoids a sqrt per node, and over a few km the latitude distortion cannot change
 *  which of two candidates wins. */
function nearestNode(nodes: [number, number][], p: LatLng): number {
  let best = Infinity;
  let bi = -1;
  for (let i = 0; i < nodes.length; i++) {
    const dLat = nodes[i][0] - p.lat;
    const dLng = nodes[i][1] - p.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return bi;
}

/** Minimal binary min-heap. Hand-rolled rather than pulled from a package: it is
 *  ~30 lines and a new dependency for a priority queue is not worth it. */
class MinHeap {
  private d: number[] = [];
  private n: number[] = [];

  get size() {
    return this.n.length;
  }

  push(dist: number, node: number) {
    this.d.push(dist);
    this.n.push(node);
    let i = this.n.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): [number, number] {
    const topD = this.d[0];
    const topN = this.n[0];
    const lastD = this.d.pop()!;
    const lastN = this.n.pop()!;
    if (this.n.length) {
      this.d[0] = lastD;
      this.n[0] = lastN;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n.length && this.d[l] < this.d[m]) m = l;
        if (r < this.n.length && this.d[r] < this.d[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return [topD, topN];
  }

  private swap(a: number, b: number) {
    [this.d[a], this.d[b]] = [this.d[b], this.d[a]];
    [this.n[a], this.n[b]] = [this.n[b], this.n[a]];
  }
}

/** Shortest path from the node nearest `from` to the node nearest `to`.
 *
 *  Records `explored`: for every node settled, the edge used to reach it. That is
 *  the search frontier in settle order, which is what the animation replays.
 *  Returns null when the two points are not connected within the fetched graph —
 *  a real possibility if the bbox clipped the only link, and the caller must say
 *  so rather than falling back to a straight line.
 */
export function shortestPath(graph: RoadGraph, from: LatLng, to: LatLng): SearchResult | null {
  const { nodes, edges } = graph;
  if (nodes.length < 2 || !edges.length) return null;

  // Adjacency as flat arrays (CSR-style). An array of arrays allocates one object
  // per node, which at ~20k nodes is measurable churn on a mid-range tablet.
  const deg = new Int32Array(nodes.length);
  for (const [a, b] of edges) {
    deg[a]++;
    deg[b]++;
  }
  const head = new Int32Array(nodes.length + 1);
  for (let i = 0; i < nodes.length; i++) head[i + 1] = head[i] + deg[i];
  const cursor = head.slice(0, nodes.length);
  const adjTo = new Int32Array(edges.length * 2);
  const adjW = new Float64Array(edges.length * 2);
  for (const [a, b, w] of edges) {
    adjTo[cursor[a]] = b;
    adjW[cursor[a]++] = w;
    adjTo[cursor[b]] = a;
    adjW[cursor[b]++] = w;
  }

  const src = nearestNode(nodes, from);
  const dst = nearestNode(nodes, to);
  if (src < 0 || dst < 0 || src === dst) return null;

  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const done = new Uint8Array(nodes.length);
  const explored: [number, number][][] = [];

  dist[src] = 0;
  const heap = new MinHeap();
  heap.push(0, src);
  let settled = 0;

  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue; // stale heap entry, already settled by a shorter path
    done[u] = 1;
    settled++;
    if (prev[u] >= 0) {
      explored.push([nodes[prev[u]], nodes[u]]);
    }
    if (u === dst) break;
    for (let e = head[u]; e < head[u + 1]; e++) {
      const v = adjTo[e];
      if (done[v]) continue;
      const nd = d + adjW[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd, v);
      }
    }
  }

  if (!done[dst] || dist[dst] === Infinity) return null;

  const path: [number, number][] = [];
  for (let cur = dst; cur !== -1; cur = prev[cur]) path.push(nodes[cur]);
  path.reverse();

  return { path, distanceM: dist[dst], explored, settled };
}

/** Resample a path so the car advances by roughly equal distance per frame.
 *
 *  Road paths have wildly uneven vertex spacing — a long straight stretch is two
 *  points, a roundabout is thirty. Stepping vertex-to-vertex therefore makes the
 *  car crawl through junctions and teleport down highways. Interpolating by
 *  distance is what makes the motion read as driving.
 */
export function resampleByDistance(path: [number, number][], steps: number): [number, number][] {
  if (path.length < 2 || steps < 2) return path;
  const M_PER_DEG = 111_320;
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dLat = (path[i][0] - path[i - 1][0]) * M_PER_DEG;
    const dLng = (path[i][1] - path[i - 1][1]) * M_PER_DEG * Math.cos((path[i][0] * Math.PI) / 180);
    const len = Math.hypot(dLat, dLng);
    segLen.push(len);
    total += len;
  }
  if (total <= 0) return path;

  const out: [number, number][] = [path[0]];
  const stepLen = total / (steps - 1);
  let seg = 0;
  let along = 0;
  for (let s = 1; s < steps - 1; s++) {
    let target = s * stepLen;
    while (seg < segLen.length && along + segLen[seg] < target) {
      along += segLen[seg];
      seg++;
    }
    if (seg >= segLen.length) break;
    const t = segLen[seg] > 0 ? (target - along) / segLen[seg] : 0;
    const a = path[seg];
    const b = path[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(path[path.length - 1]);
  return out;
}
