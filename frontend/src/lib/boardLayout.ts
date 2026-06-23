/**
 * boardLayout.ts — production-grade diagram layout for the Investigation Board.
 *
 * Uses two engines:
 *   • dagre  — hierarchical / tree / flowchart / timeline layouts
 *   • elkjs  — force-layered / radial / force-directed layouts
 *
 * Plus colourHarmony() which generates aesthetically-correct palettes from
 * entity kinds, so every diagram looks visually designed.
 *
 * Pipeline:
 *   1. SceneGraph arrives from the backend (nodes + edges, no x/y)
 *   2. detectLayout() picks dagre vs elk based on diagram intent
 *   3. The chosen engine returns perfect x/y for every node
 *   4. colourHarmony() applies harmonious, role-aware colors
 *   5. applySceneToEditor() places the result into tldraw
 */

import dagre from "@dagrejs/dagre";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { SceneNode, SceneEdge } from "@/lib/api/board";

// ── Canvas dimensions (must match backend constants) ───────────────────────
const CW = 1600;
const CH = 900;

// ── elk instance (shared, thread-safe in browser) ─────────────────────────
const elk = new ELK();

// ── Types ──────────────────────────────────────────────────────────────────
export type LayoutNode = SceneNode & { x: number; y: number };
export type LayoutResult = { nodes: LayoutNode[]; edges: SceneEdge[] };

// ── Diagram intent → layout strategy ─────────────────────────────────────
type LayoutStrategy =
  | "dagre-tb"      // top-to-bottom tree (org chart, flowchart)
  | "dagre-lr"      // left-to-right (timeline, pipeline)
  | "elk-layered"   // elk hierarchical (complex flowcharts)
  | "elk-force"     // elk force-directed (networks)
  | "elk-radial"    // elk radial (mind maps, crime networks)
  | "elk-box"       // elk box-packing (evidence boards, grids)
  | "ring"          // simple ring (generic / small graphs)
  ;

function detectStrategy(
  nodes: SceneNode[],
  edges: SceneEdge[],
): LayoutStrategy {
  const n = nodes.length;
  const e = edges.length;

  // Classify entity_kinds present
  const kinds = new Set(nodes.map((nd) => nd.entity_kind ?? ""));
  const hasTimeline = kinds.has("event") || nodes.some((nd) =>
    /\b(morning|evening|day|date|\d{2}[-/]\d{2})\b/i.test(nd.label));
  const hasHierarchy = kinds.has("decision") || kinds.has("start") || kinds.has("end");
  const hasMoney = kinds.has("account") || kinds.has("transaction");
  const hasOrg = kinds.has("officer") || kinds.has("organization");
  const hasLocation = kinds.has("location");
  const hasPeople = nodes.filter((nd) =>
    ["person","suspect","victim","witness"].includes(nd.entity_kind ?? "")
  ).length > 3;

  // Avg degree: dense = force, sparse = hierarchical
  const avgDeg = n > 0 ? (e * 2) / n : 0;

  if (hasTimeline && !hasHierarchy) return "dagre-lr";
  if (hasHierarchy)                 return "elk-layered";
  if (hasOrg)                       return "dagre-tb";
  if (hasMoney)                     return "elk-layered";
  if (hasPeople && avgDeg > 2.5)    return "elk-force";
  if (hasPeople && hasLocation)     return "elk-radial";
  if (hasLocation && !hasPeople)    return "elk-box";
  if (n <= 8)                       return "ring";
  if (avgDeg > 3)                   return "elk-force";
  return "elk-layered";
}

// ── Colour harmony ────────────────────────────────────────────────────────
// Maps entity_kind → a carefully chosen, perceptually-distinct hex color.
// Grouped by role so reading the diagram is immediate.
const KIND_PALETTE: Record<string, string> = {
  // People — warm/cool distinction
  suspect:      "#ef4444",   // bold red
  accused:      "#dc2626",
  victim:       "#16a34a",   // green
  witness:      "#2563eb",   // blue
  officer:      "#0891b2",   // cyan
  person:       "#7c3aed",   // violet
  unknown:      "#6b7280",   // grey

  // Places — warm amber family
  location:     "#d97706",
  place:        "#b45309",

  // Objects
  vehicle:      "#1d4ed8",
  weapon:       "#b91c1c",
  evidence:     "#92400e",
  document:     "#78350f",
  phone:        "#4338ca",

  // Finance — teal family
  account:      "#0e7490",
  transaction:  "#065f46",
  organization: "#0f766e",

  // Events + flow
  event:        "#6d28d9",
  case:         "#5b21b6",
  decision:     "#7c3aed",
  start:        "#16a34a",
  end:          "#dc2626",
  note:         "#92400e",

  // Flags
  warning:      "#ef4444",
};

// tldraw color token closest to each hex
const HEX_TO_TL: [string, string][] = [
  ["#ef4444","red"],  ["#dc2626","red"],   ["#b91c1c","red"],
  ["#16a34a","green"],["#065f46","green"],
  ["#2563eb","blue"], ["#1d4ed8","blue"],  ["#0891b2","light-blue"],
  ["#7c3aed","violet"],["#4338ca","violet"],["#5b21b6","violet"],
  ["#6d28d9","violet"],["#0e7490","light-blue"],
  ["#d97706","yellow"],["#b45309","yellow"],["#92400e","yellow"],
  ["#f97316","orange"],["#6b7280","grey"],
];

export function hexToTlColor(hex: string): string {
  const h = hex.toLowerCase();
  for (const [src, tl] of HEX_TO_TL) if (src === h) return tl;
  return "blue";
}

export function kindColor(kind: string | null | undefined): string {
  return KIND_PALETTE[kind ?? ""] ?? "#3b82f6";
}

// Apply harmonious colours to all nodes — respects LLM color if set,
// otherwise derives from entity_kind
export function applyColorHarmony(nodes: SceneNode[]): SceneNode[] {
  return nodes.map((n) => ({
    ...n,
    color: n.color ?? kindColor(n.entity_kind),
  }));
}

// ── Dagre layout ──────────────────────────────────────────────────────────
async function layoutDagre(
  nodes: SceneNode[],
  edges: SceneEdge[],
  direction: "TB" | "LR",
): Promise<LayoutNode[]> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 60,
    marginy: 60,
    align: "UL",
  });

  for (const n of nodes) {
    g.setNode(n.id, { width: n.w ?? 220, height: n.h ?? 100 });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      x: pos ? Math.round(pos.x - (n.w ?? 220) / 2) : n.x ?? 100,
      y: pos ? Math.round(pos.y - (n.h ?? 100) / 2) : n.y ?? 100,
    };
  });
}

// ── ELK layout ───────────────────────────────────────────────────────────
async function layoutElk(
  nodes: SceneNode[],
  edges: SceneEdge[],
  algorithm: "layered" | "force" | "radial" | "box",
): Promise<LayoutNode[]> {
  const algMap: Record<string, string> = {
    layered: "layered",
    force:   "force",
    radial:  "radial",
    box:     "box",
  };

  const elkNodes: ElkNode["children"] = nodes.map((n) => ({
    id: n.id,
    width:  n.w  ?? 220,
    height: n.h  ?? 100,
  }));

  const elkEdges = edges
    .filter((e) => nodes.find((n) => n.id === e.source) && nodes.find((n) => n.id === e.target))
    .map((e, i) => ({
      id:      `e${i}`,
      sources: [e.source],
      targets: [e.target],
    }));

  const layoutOptions: Record<string, string> = {
    "elk.algorithm":                algMap[algorithm],
    "elk.padding":                  "[top=50,left=50,bottom=50,right=50]",
    "elk.spacing.nodeNode":         "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    "elk.force.repulsivePower":     "2",
    "elk.radial.radius":            "320",
    "elk.box.packingMode":          "GROUP_DEC",
  };

  try {
    const graph = await elk.layout({
      id: "root",
      layoutOptions,
      children: elkNodes,
      edges: elkEdges,
    });

    const posMap = new Map(
      (graph.children ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])
    );

    // ELK coordinates start at 0; centre on canvas
    const all = [...posMap.values()];
    const minX = Math.min(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxX = Math.max(...all.map((p) => p.x + (nodes.find((n) => posMap.get(n.id) === p)?.w ?? 220)));
    const maxY = Math.max(...all.map((p) => p.y + (nodes.find((n) => posMap.get(n.id) === p)?.h ?? 100)));
    const offsetX = (CW - (maxX - minX)) / 2 - minX;
    const offsetY = (CH - (maxY - minY)) / 2 - minY;

    return nodes.map((n) => {
      const pos = posMap.get(n.id);
      return {
        ...n,
        x: pos ? Math.round(pos.x + offsetX) : n.x ?? 100,
        y: pos ? Math.round(pos.y + offsetY) : n.y ?? 100,
      };
    });
  } catch {
    // ELK failed — fall back to dagre layered
    return layoutDagre(nodes, edges, "TB");
  }
}

// ── Simple ring (tiny graphs, no layout needed) ───────────────────────────
function layoutRing(nodes: SceneNode[]): LayoutNode[] {
  const n = nodes.length;
  const r = Math.min(CW, CH) * 0.33;
  return nodes.map((nd, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    return {
      ...nd,
      x: Math.round(CW / 2 + r * Math.cos(angle) - (nd.w ?? 220) / 2),
      y: Math.round(CH / 2 + r * Math.sin(angle) - (nd.h ?? 100) / 2),
    };
  });
}

// ── Main export: layout + colour harmony ─────────────────────────────────
/**
 * Run the best layout engine for this scene and apply colour harmony.
 * Returns nodes with correct x, y, and color set.
 */
export async function layoutScene(
  rawNodes: SceneNode[],
  rawEdges: SceneEdge[],
): Promise<LayoutResult> {
  if (rawNodes.length === 0) return { nodes: [], edges: rawEdges };

  // 1. Apply colour harmony first (pure synchronous)
  const colouredNodes = applyColorHarmony(rawNodes);

  // 2. Detect the best strategy
  const strategy = detectStrategy(colouredNodes, rawEdges);

  // 3. Run layout
  let laidOut: LayoutNode[];
  try {
    if (strategy === "dagre-tb") {
      laidOut = await layoutDagre(colouredNodes, rawEdges, "TB");
    } else if (strategy === "dagre-lr") {
      laidOut = await layoutDagre(colouredNodes, rawEdges, "LR");
    } else if (strategy === "elk-layered") {
      laidOut = await layoutElk(colouredNodes, rawEdges, "layered");
    } else if (strategy === "elk-force") {
      laidOut = await layoutElk(colouredNodes, rawEdges, "force");
    } else if (strategy === "elk-radial") {
      laidOut = await layoutElk(colouredNodes, rawEdges, "radial");
    } else if (strategy === "elk-box") {
      laidOut = await layoutElk(colouredNodes, rawEdges, "box");
    } else {
      laidOut = layoutRing(colouredNodes);
    }
  } catch {
    // Ultimate fallback
    laidOut = layoutRing(colouredNodes);
  }

  return { nodes: laidOut, edges: rawEdges };
}
