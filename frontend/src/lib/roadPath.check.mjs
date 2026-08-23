/** Self-check for the Dijkstra + resampling logic in roadPath.ts.
 *
 *  Run: node src/lib/roadPath.check.mjs
 *
 *  No framework and no fixtures on purpose. The graph search is the one piece of
 *  non-trivial logic in the dispatch feature that can be wrong *silently* — a
 *  subtly broken heap still returns a path, just not the shortest one, and on a
 *  map that looks plausible. So the checks below assert against hand-computed
 *  answers on tiny graphs where the true shortest path is obvious.
 *
 *  Mirrors the implementation rather than importing it, because the module imports
 *  the browser API layer. Kept adjacent so the two are edited together; if this
 *  drifts from roadPath.ts the numbers below stop matching reality, which is
 *  exactly the failure a reviewer should notice.
 */
import assert from "node:assert/strict";

// ── the algorithm under check (kept in step with roadPath.ts) ────────────────
class MinHeap {
  d = [];
  n = [];
  get size() {
    return this.n.length;
  }
  push(dist, node) {
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
  pop() {
    const topD = this.d[0];
    const topN = this.n[0];
    const lastD = this.d.pop();
    const lastN = this.n.pop();
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
  swap(a, b) {
    [this.d[a], this.d[b]] = [this.d[b], this.d[a]];
    [this.n[a], this.n[b]] = [this.n[b], this.n[a]];
  }
}

function dijkstra(nodeCount, edges, src, dst) {
  const deg = new Int32Array(nodeCount);
  for (const [a, b] of edges) {
    deg[a]++;
    deg[b]++;
  }
  const head = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) head[i + 1] = head[i] + deg[i];
  const cursor = head.slice(0, nodeCount);
  const adjTo = new Int32Array(edges.length * 2);
  const adjW = new Float64Array(edges.length * 2);
  for (const [a, b, w] of edges) {
    adjTo[cursor[a]] = b;
    adjW[cursor[a]++] = w;
    adjTo[cursor[b]] = a;
    adjW[cursor[b]++] = w;
  }
  const dist = new Float64Array(nodeCount).fill(Infinity);
  const prev = new Int32Array(nodeCount).fill(-1);
  const done = new Uint8Array(nodeCount);
  const explored = [];
  dist[src] = 0;
  const heap = new MinHeap();
  heap.push(0, src);
  let settled = 0;
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    settled++;
    if (prev[u] >= 0) explored.push([prev[u], u]);
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
  if (!done[dst]) return null;
  const path = [];
  for (let cur = dst; cur !== -1; cur = prev[cur]) path.push(cur);
  path.reverse();
  return { path, distance: dist[dst], explored, settled };
}

// ── 1. the heap must actually order ──────────────────────────────────────────
{
  const h = new MinHeap();
  const input = [5, 3, 9, 1, 7, 1, 8, 2, 6, 0, 4];
  input.forEach((v, i) => h.push(v, i));
  const out = [];
  while (h.size) out.push(h.pop()[0]);
  assert.deepEqual(out, [...input].sort((a, b) => a - b), "heap did not pop in order");
}

// ── 2. the cheaper detour must win over the tempting direct edge ─────────────
// 0--10--1 direct, or 0-1-1-1->1 via 2,3,4. A greedy or broken heap takes the 10.
{
  const edges = [
    [0, 1, 10],
    [0, 2, 1],
    [2, 3, 1],
    [3, 4, 1],
    [4, 1, 1],
  ];
  const r = dijkstra(5, edges, 0, 1);
  assert.ok(r, "no path found on a connected graph");
  assert.equal(r.distance, 4, `expected 4 via the detour, got ${r.distance}`);
  assert.deepEqual(r.path, [0, 2, 3, 4, 1], "did not take the cheaper multi-hop path");
}

// ── 3. disconnected must return null, never a straight-line guess ────────────
{
  const r = dijkstra(4, [[0, 1, 1], [2, 3, 1]], 0, 3);
  assert.equal(r, null, "returned a path across a disconnected graph");
}

// ── 4. explored order is the settle order, and every settled node has an edge ─
{
  const edges = [
    [0, 1, 1],
    [1, 2, 1],
    [0, 3, 5],
    [3, 2, 5],
  ];
  const r = dijkstra(4, edges, 0, 2);
  assert.equal(r.distance, 2, "wrong shortest distance");
  // Node 1 is settled before node 2, so its edge is recorded first.
  assert.deepEqual(r.explored[0], [0, 1], "first explored edge should be 0->1");
  assert.ok(r.settled >= 3, `expected >= 3 settled, got ${r.settled}`);
  assert.ok(
    r.explored.length <= r.settled,
    "cannot explore more edges than nodes settled",
  );
}

// ── 5. resampling must give near-uniform spacing ─────────────────────────────
function resampleByDistance(path, steps) {
  if (path.length < 2 || steps < 2) return path;
  const M_PER_DEG = 111_320;
  const segLen = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dLat = (path[i][0] - path[i - 1][0]) * M_PER_DEG;
    const dLng =
      (path[i][1] - path[i - 1][1]) * M_PER_DEG * Math.cos((path[i][0] * Math.PI) / 180);
    const len = Math.hypot(dLat, dLng);
    segLen.push(len);
    total += len;
  }
  if (total <= 0) return path;
  const out = [path[0]];
  const stepLen = total / (steps - 1);
  let seg = 0;
  let along = 0;
  for (let s = 1; s < steps - 1; s++) {
    const target = s * stepLen;
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

{
  // Deliberately lopsided: one very long leg then a tiny one, which is what a
  // highway-then-junction road path looks like.
  const path = [
    [12.9, 77.6],
    [12.95, 77.6],
    [12.9505, 77.6005],
  ];
  const out = resampleByDistance(path, 40);
  assert.equal(out.length, 40, `expected 40 samples, got ${out.length}`);
  assert.deepEqual(out[0], path[0], "first sample must be the start");
  assert.deepEqual(out[out.length - 1], path[path.length - 1], "last must be the end");

  const M_PER_DEG = 111_320;
  const gaps = [];
  for (let i = 1; i < out.length; i++) {
    const dLat = (out[i][0] - out[i - 1][0]) * M_PER_DEG;
    const dLng =
      (out[i][1] - out[i - 1][1]) * M_PER_DEG * Math.cos((out[i][0] * Math.PI) / 180);
    gaps.push(Math.hypot(dLat, dLng));
  }
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // Uneven input, near-even output: that is the whole point of resampling.
  assert.ok(max / min < 1.5, `spacing too uneven: min ${min.toFixed(1)}m max ${max.toFixed(1)}m`);
}

console.log("roadPath self-check: all 5 groups passed");
