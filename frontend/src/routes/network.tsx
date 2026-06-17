import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { FinancialLinksPanel } from "@/components/FinancialLinksPanel";
import { RingsPanel } from "@/components/RingsPanel";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ChevronDown, Maximize2, Download, FileJson, ImageDown, Save, Trash2, Sliders } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { createPortal } from "react-dom";

type SimParams = { repulsion: number; spring: number; gravity: number; damping: number };
const SIM_DEFAULTS: SimParams = { repulsion: 18, spring: 0.012, gravity: 0.0020, damping: 0.82 };
const SIM_PRESETS: Record<string, SimParams> = {
  Default: SIM_DEFAULTS,
  Spread:  { repulsion: 36, spring: 0.008, gravity: 0.0010, damping: 0.85 },
  Tight:   { repulsion: 10, spring: 0.020, gravity: 0.0040, damping: 0.75 },
};
const SLIDER_META = [
  { key: "repulsion", label: "Repulsion", min: 0,  max: 60,   step: 1 },
  { key: "spring",    label: "Spring",    min: 0,  max: 0.05, step: 0.001 },
  { key: "gravity",   label: "Gravity",   min: 0,  max: 0.01, step: 0.0001 },
  { key: "damping",   label: "Damping",   min: 0,  max: 1,    step: 0.01 },
] as const;

export const Route = createFileRoute("/network")({
  head: () => ({
    meta: [
      { title: "Network · Satyam" },
      { name: "description", content: "Criminal network and ego-graph exploration." },
    ],
  }),
  component: NetworkScreen,
});

// Demo nodes and edges removed. Graph starts empty.

const GROUP_COLOR = ["oklch(0.546 0.215 262)", "oklch(0.65 0.17 150)", "oklch(0.7 0.18 50)", "oklch(0.58 0.22 27)"];
const GROUP_SHAPE = ["circle", "square", "diamond", "triangle"];

type PosMap = Record<string, { x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null }>;

function NetworkScreen() {
  const t = useT();
  const [selected, setSelected] = useState("");
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set());
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [taskMsg, setTaskMsg] = useState<string | null>(null);

  // Live graph data
  const [NODES, setNODES] = useState<any[]>([]);
  const [EDGES, setEDGES] = useState<[string,string][]>([]);
  const [seedInput, setSeedInput] = useState("");
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphEmpty, setGraphEmpty] = useState(true);
  const [depth, setDepth] = useState(2);
  const [linkMode, setLinkMode] = useState<"people" | "financial" | "rings">("people");

  const fetchGraph = useCallback(async (seedName: string, queryDepth: number = depth) => {
    setGraphLoading(true);
    setGraphEmpty(false);
    try {
      const res: any = await api.network({ entity_name: seedName, depth: queryDepth });
      if (!res?.nodes?.length) {
        setNODES([]);
        setEDGES([]);
        setGraphEmpty(true);
        return;
      }
      // Map API nodes to our internal format
      const mappedNodes = res.nodes.map((n: any, idx: number) => ({
        id: String(n.id ?? idx),
        x: 20 + (idx % 8) * 9 + Math.random() * 6,
        y: 20 + Math.floor(idx / 8) * 14 + Math.random() * 6,
        r: n.id === res.seed_id ? 22 : 8 + Math.min(n.degree ?? 1, 8),
        group: n.entity_type === "person" ? (idx === 0 ? 0 : 1) : n.entity_type === "location" ? 2 : 3,
        label: n.label ?? n.name ?? String(n.id),
        role: n.id === res.seed_id ? "seed" : undefined,
        caseIds: n.case_ids ?? [],
      }));
      const mappedEdges: [string,string][] = (res.edges ?? []).map((e: any) => [String(e.source), String(e.target)] as [string,string]);
      setNODES(mappedNodes);
      setEDGES(mappedEdges);
      const newSeedId = String(res.seed_id ?? mappedNodes[0]?.id ?? "");
      setSelected(newSeedId);
      setSelectedSet(new Set(newSeedId ? [newSeedId] : []));
      setGraphEmpty(mappedNodes.length === 0);
    } catch {
      setNODES([]);
      setEDGES([]);
      setGraphEmpty(true);
    } finally {
      setGraphLoading(false);
    }
  }, [depth]);

  const handleDepthChange = (newDepth: number) => {
    setDepth(newDepth);
    if (seedInput.trim()) {
      fetchGraph(seedInput.trim(), newDepth);
    }
  };

  // Voice command "open network for suspect …" lands here.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/network") return;
      setTaskMsg(d.task || d.query || null);
      if (d.task) fetchGraph(d.task);
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [fetchGraph]);
  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get("seed");
    if (seed) {
      setSeedInput(seed);
      fetchGraph(seed);
    }
  }, [fetchGraph]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<null | "png" | "json">(null);
  const [exportScope, setExportScope] = useState<"selection" | "all">("selection");
  const graphSvgRef = useRef<SVGSVGElement>(null);
  const node = useMemo(() => {
    return NODES.find((n) => n.id === selected) || {
      id: "",
      label: t("No selection"),
      group: 0,
      role: "",
      caseIds: [],
    };
  }, [NODES, selected, t]);

  // ---- Physics tuning state ----
  const PRESETS_KEY = "fq-network-presets";
  const ACTIVE_KEY = "network.physics.active.v1";
  const [userPresets, setUserPresets] = useState<Record<string, SimParams>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}"); } catch { return {}; }
  });
  const [activePreset, setActivePreset] = useState<string>(() => {
    if (typeof window === "undefined") return "Default";
    return localStorage.getItem(ACTIVE_KEY) || "Default";
  });

  const allPresets = useMemo(() => ({ ...SIM_PRESETS, ...userPresets }), [userPresets]);

  const [sim, setSim] = useState<SimParams>(() => {
    if (typeof window === "undefined") return SIM_DEFAULTS;
    try {
      const active = localStorage.getItem(ACTIVE_KEY) || "Default";
      const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}");
      const combined = { ...SIM_PRESETS, ...saved };
      if (combined[active]) return combined[active];
    } catch {}
    return SIM_DEFAULTS;
  });

  const physicsRef = useRef<SimParams>(sim);
  physicsRef.current = sim;

  // ---- Physics presets menu and coordinates ----
  const [presetsOpen, setPresetsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updateCoords = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }
  }, []);

  useEffect(() => {
    if (!presetsOpen) return;
    updateCoords();
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresetsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    
    return () => {
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [presetsOpen, updateCoords]);

  const applyPreset = (name: string) => {
    const p = allPresets[name];
    if (!p) return;
    setSim(p);
    setActivePreset(name);
    try { localStorage.setItem(ACTIVE_KEY, name); } catch {}
    setPresetsOpen(false);
  };
  const saveCurrentAsPreset = () => {
    const name = (typeof window !== "undefined" ? window.prompt(t("Preset name"), "") : "")?.trim();
    if (!name) return;
    if (name in SIM_PRESETS) {
      if (typeof window !== "undefined") window.alert(t("That name is reserved"));
      return;
    }
    const next = { ...userPresets, [name]: sim };
    setUserPresets(next);
    setActivePreset(name);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_KEY, name);
    } catch {}
  };
  const deletePreset = (name: string) => {
    if (name in SIM_PRESETS) return;
    const { [name]: _, ...rest } = userPresets;
    setUserPresets(rest);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(rest)); } catch {}
    if (activePreset === name) applyPreset("Default");
  };
  // Mark active as "Custom" when sliders drift from the named preset
  useEffect(() => {
    const p = allPresets[activePreset];
    if (!p) return;
    const drift =
      p.repulsion !== sim.repulsion ||
      p.spring !== sim.spring ||
      p.gravity !== sim.gravity ||
      p.damping !== sim.damping;
    if (drift && activePreset !== "Custom") setActivePreset("Custom");
  }, [sim, allPresets, activePreset]);

  // ---- Dynamic simulation state ----
  const nodesRef = useRef(NODES);
  nodesRef.current = NODES;
  const edgesRef = useRef(EDGES);
  edgesRef.current = EDGES;

  const [pos, setPos] = useState<PosMap>({});
  const posRef = useRef(pos);
  posRef.current = pos;
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [frameMs, setFrameMs] = useState(16);
  const dragRef = useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number }>({ id: null, panning: false, lastX: 0, lastY: 0 });

  // Force simulation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      setFrameMs(dt);
      const ph = physicsRef.current;
      const p = { ...posRef.current };

      // Ensure all nodes have a position
      nodesRef.current.forEach((n) => {
        if (!p[n.id]) {
          p[n.id] = {
            x: n.x,
            y: n.y,
            vx: 0,
            vy: 0,
            fx: n.role === "seed" ? n.x : null,
            fy: n.role === "seed" ? n.y : null,
          };
        }
      });

      const ids = nodesRef.current.map((n) => n.id);
      // Repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = p[ids[i]];
          const b = p[ids[j]];
          if (!a || !b) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) d2 = 0.01;
          const f = ph.repulsion / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      // Edge springs
      edgesRef.current.forEach(([a, b]) => {
        const A = p[a];
        const B = p[b];
        if (!A || !B) return;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const isSeedA = nodesRef.current.find(n => n.id === a)?.role === "seed";
        const isSeedB = nodesRef.current.find(n => n.id === b)?.role === "seed";
        const rest = isSeedA || isSeedB ? 26 : 22;
        const k = ph.spring * (d - rest);
        const fx = (dx / d) * k;
        const fy = (dy / d) * k;
        A.vx += fx;
        A.vy += fy;
        B.vx -= fx;
        B.vy -= fy;
      });
      // Center gravity + integration
      ids.forEach((id) => {
        const n = p[id];
        if (!n) return;
        n.vx += (50 - n.x) * ph.gravity;
        n.vy += (50 - n.y) * ph.gravity;
        n.vx *= ph.damping;
        n.vy *= ph.damping;
        if (n.fx != null && n.fy != null) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
        } else {
          n.x += n.vx;
          n.y += n.vy;
          n.x = Math.max(6, Math.min(94, n.x));
          n.y = Math.max(6, Math.min(94, n.y));
        }
      });
      setPos({ ...p });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Convert client coords to SVG viewBox coords
  const clientToSvg = (cx: number, cy: number) => {
    const svg = graphSvgRef.current;
    if (!svg) return { x: 50, y: 50 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 50, y: 50 };
    const r = pt.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  };

  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, panning: false, lastX: e.clientX, lastY: e.clientY };
    setPos((prev) => ({ ...prev, [id]: { ...prev[id], fx: prev[id].x, fy: prev[id].y } }));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.id) {
      const { x, y } = clientToSvg(e.clientX, e.clientY);
      setPos((prev) => ({ ...prev, [d.id!]: { ...prev[d.id!], x, y, fx: x, fy: y, vx: 0, vy: 0 } }));
    } else if (d.panning) {
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x - dx * 0.15 * v.scale, y: v.y - dy * 0.15 * v.scale }));
    }
  };
  const onPointerUp = (id?: string) => (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.id && id !== "S1") {
      // release fixed unless seed
      const did = d.id;
      setPos((prev) => ({ ...prev, [did]: { ...prev[did], fx: null, fy: null } }));
    }
    dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0 };
  };
  const onBgPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { id: null, panning: true, lastX: e.clientX, lastY: e.clientY };
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const s = Math.max(0.4, Math.min(3, v.scale * factor));
      return { ...v, scale: s };
    });
  };

  const zoomBy = (factor: number) => setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(3, v.scale * factor)) }));
  const recenter = () => setView({ x: 0, y: 0, scale: 1 });

  const viewBox = useMemo(() => {
    const size = 100 * view.scale;
    const cx = 50 + view.x;
    const cy = 50 + view.y;
    return `${cx - size / 2} ${cy - size / 2} ${size} ${size}`;
  }, [view]);

  const handleNodeClick = (id: string, e: React.MouseEvent) => {
    setSelected(id);
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (next.has(id) && next.size > 1) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getScopedData = (scope: "selection" | "all") => {
    if (scope === "all" || selectedSet.size === 0) {
      return { nodes: NODES, edges: EDGES };
    }
    const ids = selectedSet;
    const nodes = NODES.filter((n) => ids.has(n.id));
    const edges = EDGES.filter(([a, b]) => ids.has(a) && ids.has(b));
    return { nodes, edges };
  };

  const exportJson = () => {
    setExporting("json");
    const { nodes, edges } = getScopedData(exportScope);
    const snapshot = {
      generatedAt: new Date().toISOString(),
      seedEntity: NODES.find((n) => (n as any).role === "seed")?.label ?? seedInput ?? selected,
      depth: depth,
      scope: exportScope,
      selection: Array.from(selectedSet),
      primarySelection: selected,
      stats: { nodes: nodes.length, edges: edges.length },
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        role: (n as any).role ?? null,
        group: n.group,
        position: { x: n.x, y: n.y },
        radius: n.r,
      })),
      edges: edges.map(([source, target]) => ({ source, target })),
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const suffix = exportScope === "selection" ? "selection" : "full";
    triggerDownload(blob, `satyam-network-${suffix}-${stamp()}.json`);
    setTimeout(() => {
      setExporting(null);
      setExportOpen(false);
    }, 300);
  };

  const buildExportSvg = (scope: "selection" | "all") => {
    const { nodes, edges } = getScopedData(scope);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeXml = edges
      .map(([a, b]) => {
        const A = nodeMap.get(a)!;
        const B = nodeMap.get(b)!;
        const isSeedA = nodes.find(n => n.id === a)?.role === "seed";
        const isSeedB = nodes.find(n => n.id === b)?.role === "seed";
        const isCore = isSeedA || isSeedB;
        return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="#1a1f2e" stroke-opacity="${isCore ? 0.6 : 0.25}" stroke-width="${isCore ? 0.32 : 0.18}" ${isCore ? "" : 'stroke-dasharray="0.6 0.6"'}/>`;
      })
      .join("");
    const nodeXml = nodes
      .map((n) => {
        const r = n.r / 10;
        const color = GROUP_COLOR[n.group];
        const shape = GROUP_SHAPE[n.group];
        const isSeed = (n as any).role === "seed";
        let shapeXml = "";
        if (shape === "circle") shapeXml = `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${color}" stroke="#1a1f2e" stroke-width="${isSeed ? 0.7 : 0.45}"/>`;
        else if (shape === "square") shapeXml = `<rect x="${n.x - r}" y="${n.y - r}" width="${r * 2}" height="${r * 2}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
        else if (shape === "diamond") shapeXml = `<polygon points="${n.x},${n.y - r} ${n.x + r},${n.y} ${n.x},${n.y + r} ${n.x - r},${n.y}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
        else shapeXml = `<polygon points="${n.x},${n.y - r} ${n.x + r},${n.y + r} ${n.x - r},${n.y + r}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
        const labelW = Math.max(n.label.length * 0.88, 6);
        const labelBg = isSeed ? "#1a1f2e" : "#ffffff";
        const labelFg = isSeed ? "#ffffff" : "#1a1f2e";
        const label = `<g transform="translate(${n.x},${n.y + r + 2.6})"><rect x="${-labelW / 2}" y="-1.2" width="${labelW}" height="2.5" fill="${labelBg}" stroke="#1a1f2e" stroke-width="0.18"/><text x="0" y="0.65" text-anchor="middle" font-size="1.35" font-weight="700" fill="${labelFg}" font-family="ui-monospace,monospace" letter-spacing="0.03em">${n.label.toUpperCase().replace(/[<>&]/g, "")}</text></g>`;
        return shapeXml + label;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1600" height="1600">${edgeXml}${nodeXml}</svg>`;
  };

  const exportPng = async () => {
    setExporting("png");
    try {
      const W = 1600;
      const H = 1600;
      const { nodes, edges } = getScopedData(exportScope);
      const xml = buildExportSvg(exportScope);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("svg load failed"));
        img.src = `data:image/svg+xml;base64,${svg64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f5f6f8";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(120,130,150,0.35)";
      for (let x = 0; x < W; x += 56) {
        for (let y = 0; y < H; y += 56) {
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.drawImage(img, 0, 0, W, H);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 22px ui-monospace, monospace";
      const scopeLabel = exportScope === "selection" ? "SELECTION" : "FULL";
      ctx.fillText(
        `SATYAM · ${scopeLabel} · ${nodes.length} NODES · ${edges.length} EDGES · ${new Date().toLocaleString()}`,
        32,
        H - 28,
      );
      await new Promise<void>((res) =>
        canvas.toBlob((b) => {
          if (b) triggerDownload(b, `satyam-network-${exportScope}-${stamp()}.png`);
          res();
        }, "image/png"),
      );
    } finally {
      setExporting(null);
      setExportOpen(false);
    }
  };

  const scopedCounts = (() => {
    const { nodes, edges } = getScopedData(exportScope);
    return { nodes: nodes.length, edges: edges.length };
  })();



  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)]">
        <section className="flex-1 min-w-0 flex flex-col">
          {taskMsg && (
            <div className="border-b border-border bg-primary/10 px-5 py-2 text-xs font-medium text-foreground">
              {t("Voice task")}: {taskMsg}
            </div>
          )}
          {/* People / Financial link-mode toggle */}
          <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-card">
            <div className="inline-flex rounded-lg border border-input bg-background p-0.5 text-xs font-semibold">
              {(["people", "financial", "rings"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLinkMode(m)}
                  className={`rounded-md px-3 py-1.5 transition ${
                    linkMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "people" ? t("People & Cases") : m === "financial" ? t("Financial links") : t("Rings")}
                </button>
              ))}
            </div>
          </div>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-5 py-3 text-foreground">
            <Control label={t("Seed entity")}>
              <div className="flex items-center gap-1">
                <input
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && seedInput.trim()) fetchGraph(seedInput.trim()); }}
                  placeholder={t("Enter name or ID…")}
                  className="w-40 rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
                />
                <button
                  onClick={() => seedInput.trim() && fetchGraph(seedInput.trim())}
                  disabled={graphLoading}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >{graphLoading ? "…" : "▶"}</button>
              </div>
            </Control>
            <Control label={t("Depth")}>
              <div className="relative">
                <select
                  value={depth}
                  onChange={(e) => handleDepthChange(Number(e.target.value))}
                  className="appearance-none rounded-md border border-input bg-card px-2.5 py-1.5 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Control>
            <Control label={t("Edge type")}>
              <Select options={[t("All"), t("Co-accused"), t("Phone"), t("Vehicle"), t("Location")]} />
            </Control>
            <Control label={t("Community")}>
              <Select options={[t("All"), "C-01 (Theft ring)", "C-02 (Cyber)", "C-03 (Narcotics)"]} />
            </Control>
            <div className="hidden xl:flex items-center gap-3 border-l border-border pl-3">
              <div className="relative">
                <button
                  ref={triggerRef}
                  onClick={() => setPresetsOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] font-medium hover:bg-muted"
                  title={t("Physics presets")}
                >
                  <Sliders className="size-3.5" />
                  <span className="max-w-[90px] truncate">{t(activePreset)}</span>
                  <ChevronDown className="size-3" />
                </button>
                {presetsOpen && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9999]" onClick={() => setPresetsOpen(false)} />
                    <div
                      style={{
                        position: "absolute",
                        top: `${coords.top + 4}px`,
                        left: `${coords.left}px`,
                      }}
                      className="z-[10000] w-56 max-h-[60vh] overflow-y-auto rounded-[5px] border-2 border-foreground bg-secondary-background p-1 nb-shadow"
                    >
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{t("Built-in")}</div>
                      {Object.keys(SIM_PRESETS).map((name) => (
                        <button
                          key={name}
                          onClick={() => applyPreset(name)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted whitespace-nowrap ${activePreset === name ? "bg-muted" : ""}`}
                        >
                          <span className="truncate">{t(name)}</span>
                          {activePreset === name && <span className="ml-2 text-[10px] text-muted-foreground shrink-0">✓</span>}
                        </button>
                      ))}
                      {Object.keys(userPresets).length > 0 && (
                        <>
                          <div className="mt-1 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{t("Saved")}</div>
                          {Object.keys(userPresets).map((name) => (
                            <div key={name} className={`group flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted whitespace-nowrap ${activePreset === name ? "bg-muted" : ""}`}>
                              <button onClick={() => applyPreset(name)} className="flex-1 text-left truncate mr-1">
                                {t(name)}
                              </button>
                              <button
                                onClick={() => deletePreset(name)}
                                className="ml-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-card hover:text-destructive shrink-0"
                                title={t("Delete preset")}
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                      <div className="my-1 h-px bg-border" />
                      <button
                        onClick={saveCurrentAsPreset}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted whitespace-nowrap"
                      >
                        <Save className="size-3.5 shrink-0" />
                        <span>{t("Save current as preset…")}</span>
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
              {SLIDER_META.map(({ key, label, min, max, step }) => {
                let fmt: ((v: number) => string) | undefined;
                if (key === "spring") fmt = (v) => v.toFixed(3);
                else if (key === "gravity") fmt = (v) => v.toFixed(4);
                else if (key === "damping") fmt = (v) => v.toFixed(2);
                
                return (
                  <Slider
                    key={key}
                    label={t(label)}
                    min={min}
                    max={max}
                    step={step}
                    value={sim[key]}
                    onChange={(val) => setSim((s) => ({ ...s, [key]: val }))}
                    fmt={fmt}
                  />
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium">
                <span className="font-mono text-foreground">{selectedSet.size}</span>
                <span className="text-muted-foreground">{t("selected")}</span>
                {selectedSet.size > 1 && (
                  <button
                    onClick={() => {
                      setSelectedSet(new Set([selected]));
                    }}
                    className="ml-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted"
                  >
                    {t("Clear")}
                  </button>
                )}
              </div>
              <Legend />
              <div className="relative">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> {t("Export")}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-card shadow-lg">
                      <div className="border-b border-border p-2">
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Scope")}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => setExportScope("selection")}
                            className={`rounded border px-2 py-1 text-[11px] font-medium transition ${exportScope === "selection" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
                          >
                            {t("Selection")} ({selectedSet.size})
                          </button>
                          <button
                            onClick={() => setExportScope("all")}
                            className={`rounded border px-2 py-1 text-[11px] font-medium transition ${exportScope === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
                          >
                            {t("All")} ({NODES.length})
                          </button>
                        </div>
                        <div className="mt-2 text-[10px] text-muted-foreground">
                          {scopedCounts.nodes} {t("nodes")} · {scopedCounts.edges} {t("edges")}
                        </div>
                      </div>
                      <button
                        onClick={exportPng}
                        disabled={exporting !== null || scopedCounts.nodes === 0}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        <ImageDown className="h-3.5 w-3.5" />
                        <div className="flex flex-col">
                          <span>{exporting === "png" ? t("Exporting…") : t("PNG image")}</span>
                          <span className="text-[10px] text-muted-foreground">{t("Rendered graph snapshot")}</span>
                        </div>
                      </button>
                      <button
                        onClick={exportJson}
                        disabled={exporting !== null || scopedCounts.nodes === 0}
                        className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        <FileJson className="h-3.5 w-3.5" />
                        <div className="flex flex-col">
                          <span>{exporting === "json" ? t("Exporting…") : t("JSON snapshot")}</span>
                          <span className="text-[10px] text-muted-foreground">{t("Nodes, edges, metadata")}</span>
                        </div>
                      </button>
                      <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
                        {t("Tip: Shift-click nodes to add to selection")}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Maximize2 className="h-3.5 w-3.5" /> {t("Fullscreen")}
              </button>
            </div>


          </div>

          {/* Graph / Financial panel */}
          {linkMode === "financial" ? (
            <div className="flex-1 overflow-hidden">
              <FinancialLinksPanel seed={seedInput} />
            </div>
          ) : linkMode === "rings" ? (
            <div className="flex-1 overflow-hidden">
              <RingsPanel />
            </div>
          ) : (
          <div
            className="relative flex-1 overflow-hidden bg-background text-foreground/20"
            style={{
              backgroundImage: "radial-gradient(currentColor 1.2px, transparent 1.2px)",
              backgroundSize: "28px 28px",
            }}
          >
            {graphEmpty && !graphLoading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/85 p-6 text-center">
                <div className="max-w-md rounded-[5px] border-2 border-foreground bg-secondary-background p-6 nb-shadow-md text-foreground">
                  <h3 className="text-lg font-extrabold uppercase tracking-wide mb-2">{t("Seed Entity Link Graph")}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("Enter a suspect, victim, case, or vehicle in the search bar above to build and explore the criminal relationship network.")}
                  </p>
                  <div className="flex justify-center">
                    <input
                      value={seedInput}
                      onChange={(e) => setSeedInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && seedInput.trim()) fetchGraph(seedInput.trim()); }}
                      placeholder={t("Enter suspect name…")}
                      className="w-48 rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      onClick={() => seedInput.trim() && fetchGraph(seedInput.trim())}
                      className="ml-2 rounded-[5px] border-2 border-foreground bg-primary px-4 py-1.5 text-sm font-extrabold text-primary-foreground nb-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                    >
                      {t("Build")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {graphLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
                <div className="rounded-[5px] border-2 border-foreground bg-secondary-background px-6 py-4 nb-shadow-md text-foreground font-extrabold flex items-center gap-3">
                  <span className="animate-spin">🌀</span> {t("Building Network Graph…")}
                </div>
              </div>
            )}

            {/* Coordinate labels */}
            <div className="pointer-events-none absolute left-3 top-3 z-10 space-y-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground/40">
              <div>SECTOR · 04-B</div>
              <div>EGO · DEPTH {depth}</div>
            </div>

            {/* Range rings */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
              <g stroke="currentColor" className="text-foreground/10" fill="none">
                <circle cx="50%" cy="50%" r="110" strokeWidth="1.5" strokeDasharray="3 5" />
                <circle cx="50%" cy="50%" r="200" strokeWidth="1.5" strokeDasharray="3 5" />
                <circle cx="50%" cy="50%" r="300" strokeWidth="1.5" strokeDasharray="3 5" />
              </g>
            </svg>

            {/* Graph SVG */}
            <svg
              ref={graphSvgRef}
              viewBox={viewBox}
              className="absolute inset-0 h-full w-full touch-none select-none text-foreground"
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={onBgPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp()}
              onPointerLeave={onPointerUp()}
              onWheel={onWheel}
              style={{ cursor: dragRef.current.panning ? "grabbing" : "grab" }}
            >
              {EDGES.map(([a, b], i) => {
                const A = pos[a];
                const B = pos[b];
                if (!A || !B) return null;
                const isSeedA = NODES.find(n => n.id === a)?.role === "seed";
                const isSeedB = NODES.find(n => n.id === b)?.role === "seed";
                const isCore = isSeedA || isSeedB;
                const inSelection = selectedSet.size > 1 && selectedSet.has(a) && selectedSet.has(b);
                const dimmed = selectedSet.size > 1 && !inSelection;
                return (
                  <line
                    key={i}
                    x1={A.x}
                    y1={A.y}
                    x2={B.x}
                    y2={B.y}
                    stroke="currentColor"
                    strokeOpacity={dimmed ? 0.08 : isCore ? 0.6 : 0.22}
                    strokeWidth={isCore ? 0.32 : 0.18}
                    strokeDasharray={isCore ? undefined : "0.6 0.6"}
                  />
                );
              })}

              {NODES.map((n) => {
                const p = pos[n.id];
                if (!p) return null;
                const sel = n.id === selected;
                const inSet = selectedSet.has(n.id);
                const color = GROUP_COLOR[n.group];
                const r = n.r / 10;
                const isSeed = n.role === "seed";
                const labelW = Math.max(n.label.length * 0.88, 6);
                return (
                  <g
                    key={n.id}
                    onClick={(e) => handleNodeClick(n.id, e)}
                    onPointerDown={(e) => onNodePointerDown(n.id, e)}
                    onPointerUp={onPointerUp(n.id)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    {inSet && (
                      <circle cx={p.x} cy={p.y} r={r + 1.4} fill="none" stroke="currentColor" strokeWidth={sel ? 0.45 : 0.3} strokeDasharray="0.5 0.5" />
                    )}
                    {isSeed && (
                      <circle cx={p.x} cy={p.y} r={r + 2.4} fill={color} opacity="0.18" className="animate-pulse" />
                    )}
                    {GROUP_SHAPE[n.group] === "circle" && (
                      <circle cx={p.x} cy={p.y} r={r} fill={color} stroke="currentColor" strokeWidth={isSeed ? 0.7 : 0.45} />
                    )}
                    {GROUP_SHAPE[n.group] === "square" && (
                      <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} fill={color} stroke="currentColor" strokeWidth="0.45" />
                    )}
                    {GROUP_SHAPE[n.group] === "diamond" && (
                      <polygon points={`${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`} fill={color} stroke="currentColor" strokeWidth="0.45" />
                    )}
                    {GROUP_SHAPE[n.group] === "triangle" && (
                      <polygon points={`${p.x},${p.y - r} ${p.x + r},${p.y + r} ${p.x - r},${p.y + r}`} fill={color} stroke="currentColor" strokeWidth="0.45" />
                    )}
                    {/* Label pill */}
                    <g transform={`translate(${p.x}, ${p.y + r + 2.6})`} className="text-foreground">
                      <rect
                        x={-labelW / 2}
                        y={-1.2}
                        width={labelW}
                        height="2.5"
                        fill={isSeed ? "var(--foreground)" : "var(--secondary-background)"}
                        stroke="currentColor"
                        strokeWidth="0.18"
                      />
                      <text
                        x="0"
                        y="0.65"
                        textAnchor="middle"
                        fontSize="1.35"
                        fontWeight={sel || isSeed ? 800 : 700}
                        fill={isSeed ? "var(--background)" : "currentColor"}
                        style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.03em" }}
                      >
                        {n.label.toUpperCase()}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Live status HUD (bottom-left) */}
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-[5px] border-2 border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-background nb-shadow-sm">
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {graphLoading && <span className="animate-pulse">…</span>}
                {t("Live")}
              </span>
              <span className="h-3 w-px bg-background/30" />
              <span className="font-mono">{NODES.length} NODES · {EDGES.length} EDGES</span>
              <span className="h-3 w-px bg-background/30 hidden sm:inline-block" />
              <span className="font-mono opacity-60 hidden sm:inline">Δ {frameMs.toFixed(1)}ms</span>
              <span className="h-3 w-px bg-background/30 hidden md:inline-block" />
              <span className="font-mono opacity-60 hidden md:inline">{(view.scale * 100).toFixed(0)}%</span>
            </div>

            {/* Zoom HUD (bottom-right) */}
            <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
              <button onClick={() => zoomBy(0.83)} className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition" aria-label="Zoom in">
                <span className="text-base font-black leading-none">+</span>
              </button>
              <button onClick={() => zoomBy(1.2)} className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition" aria-label="Zoom out">
                <span className="text-base font-black leading-none">−</span>
              </button>
              <button onClick={recenter} className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-[11px] font-black text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition" aria-label="Recenter">
                ⊙
              </button>
            </div>
          </div>
          )} {/* end linkMode === "financial" ternary */}
        </section>


        {/* Node inspector */}
        <aside className="w-80 shrink-0 border-l border-border bg-card overflow-auto">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Node inspector")}</div>
            <h3 className="text-sm font-semibold text-foreground">{node.label}</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t("Degree")} value={String(EDGES.filter(([a,b]) => a === selected || b === selected).length)} />
              <Stat label={t("Group")} value={`G-${(NODES.find(n => n.id === selected)?.group ?? 0) + 1}`} />
              <Stat label={t("Type")} value={(NODES.find(n => n.id === selected) as any)?.role === "seed" ? t("Seed") : `${t("Depth")} 1`} />
              <Stat label={t("Role")} value={(NODES.find(n => n.id === selected) as any)?.role === "seed" ? t("Hub") : t("Associate")} tone="red" />
            </div>

            {((NODES.find(n => n.id === selected) as any)?.caseIds?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Linked cases")}</div>
                <div className="space-y-1.5">
                  {((NODES.find(n => n.id === selected) as any)?.caseIds ?? []).slice(0, 5).map((cid: number) => (
                    <button
                      key={cid}
                      onClick={() => setDrawerCaseId(cid)}
                      className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-mono text-foreground">#{cid}</span>
                      <span className="text-[10px] text-primary hover:underline">{t("Open")} →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {((NODES.find(n => n.id === selected) as any)?.caseIds?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">{t("No linked cases found for this node.")}</p>
            )}
          </div>
        </aside>
      </div>

      <CaseDrawer open={drawerCaseId != null} caseId={drawerCaseId ?? undefined} onClose={() => setDrawerCaseId(null)} />
    </Shell>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function Select({ options, value }: { options: string[]; value?: string }) {
  return (
    <div className="relative">
      <select defaultValue={value} className="appearance-none rounded-md border border-input bg-card px-2.5 py-1.5 pr-7 text-sm text-foreground">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone === "red" ? "text-destructive" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
function Legend() {
  const t = useT();
  const items = [
    { l: t("Person (C-01)"), c: GROUP_COLOR[0], s: "●" },
    { l: t("Co-accused"), c: GROUP_COLOR[1], s: "■" },
    { l: t("Location"), c: GROUP_COLOR[2], s: "◆" },
    { l: t("Asset"), c: GROUP_COLOR[3], s: "▲" },
  ];
  return (
    <div className="hidden lg:flex items-center gap-3 text-[10px]">
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-1">
          <span style={{ color: i.c }} className="text-sm">{i.s}</span>
          <span className="text-muted-foreground">{i.l}</span>
        </div>
      ))}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  fmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-0.5 w-28">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-[9px] font-mono text-foreground">{fmt ? fmt(value) : value}</span>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="absolute left-0 right-0 h-[3px] rounded-full bg-muted" />
        <div
          className="absolute h-[3px] rounded-full bg-primary"
          style={{ left: 0, width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
        <div
          className="absolute h-3 w-3 rounded-full border-2 border-primary bg-card shadow-sm pointer-events-none"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
    </div>
  );
}
