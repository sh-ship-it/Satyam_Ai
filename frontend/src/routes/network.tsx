import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { FinancialLinksPanel } from "@/components/FinancialLinksPanel";
import { RingsPanel } from "@/components/RingsPanel";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ChevronDown,
  Maximize2,
  Download,
  FileJson,
  ImageDown,
  Save,
  Trash2,
  Sliders,
  Search,
  User,
  Hash,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData, tAuto } from "@/lib/tData";
import { api } from "@/lib/api/client";
import { intelligence, type SearchResult, type OffenderListItem } from "@/lib/api/intelligence";
import { createPortal } from "react-dom";

type SimParams = { repulsion: number; spring: number; gravity: number; damping: number };
const SIM_DEFAULTS: SimParams = { repulsion: 18, spring: 0.012, gravity: 0.002, damping: 0.82 };
const SIM_PRESETS: Record<string, SimParams> = {
  Default: SIM_DEFAULTS,
  Spread: { repulsion: 36, spring: 0.008, gravity: 0.001, damping: 0.85 },
  Tight: { repulsion: 10, spring: 0.02, gravity: 0.004, damping: 0.75 },
};
const SLIDER_META = [
  { key: "repulsion", label: "Repulsion", min: 0, max: 60, step: 1 },
  { key: "spring", label: "Spring", min: 0, max: 0.05, step: 0.001 },
  { key: "gravity", label: "Gravity", min: 0, max: 0.01, step: 0.0001 },
  { key: "damping", label: "Damping", min: 0, max: 1, step: 0.01 },
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

// Group colours: 0=seed(blue), 1=accused(orange), 2=victim(green), 3=case(purple)
const GROUP_COLOR = [
  "oklch(0.546 0.215 262)", // 0 seed — blue
  "oklch(0.65 0.18 50)", // 1 accused — orange
  "oklch(0.60 0.17 150)", // 2 victim/complainant — green
  "oklch(0.55 0.15 300)", // 3 case node — purple
];
const GROUP_SHAPE = ["circle", "circle", "circle", "diamond"];

// Lighter tint per group for the radial-gradient highlight (glossy 3D look).
const GROUP_COLOR_LIGHT = [
  "oklch(0.74 0.16 262)", // blue light
  "oklch(0.80 0.15 50)", // orange light
  "oklch(0.78 0.14 150)", // green light
  "oklch(0.74 0.13 300)", // purple light
];

// White icon glyph drawn inside each node (24×24 source coords).
// Person silhouette for people (groups 0/1/2), document for case (group 3).
const ICON_PERSON =
  "M12 12.6a3.4 3.4 0 100-6.8 3.4 3.4 0 000 6.8zm0 1.7c-3.4 0-6.2 1.8-6.2 4.1v1.3h12.4v-1.3c0-2.3-2.8-4.1-6.2-4.1z";
const ICON_DOC =
  "M7 3.5h6.5L18 8v12.5H7zM13 3.7V8h4.3";
function groupIcon(group: number): { path: string; filled: boolean } {
  return group === 3 ? { path: ICON_DOC, filled: false } : { path: ICON_PERSON, filled: true };
}

type PosMap = Record<
  string,
  { x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null }
>;

// ── Seed entity autocomplete ──────────────────────────────────────────────────
function SeedSearch({
  value,
  onChange,
  onSelect,
  loading,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (name: string) => void;
  loading: boolean;
  t: (s: string) => string;
}) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [popular, setPopular] = useState<OffenderListItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-load top offenders shown before user types
  useEffect(() => {
    const p = new URLSearchParams({ limit: "8", min_offenses: "1" });
    intelligence
      .listOffenders(p)
      .then((r) => setPopular(r.offenders.slice(0, 8)))
      .catch(() => {});
  }, [lang]);

  // Live search while typing (Google-style: fires from the first character)
  useEffect(() => {
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSearching(true);
      intelligence
        .searchPersonsAndCases(value.trim(), 10)
        .then((r) => {
          setResults(r);
          setActiveIdx(-1);
        })
        .catch((err) => {
          console.error("[seed search] failed:", err);
          setResults([]);
        })
        .finally(() => setSearching(false));
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [value, lang]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showDropdown =
    open && (value.trim().length < 1 ? popular.length > 0 : results.length > 0 || searching);

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setResults([]);
    onSelect(name);
  }

  function handleKey(e: React.KeyboardEvent) {
    const items =
      value.trim().length < 1 ? popular.map((p) => p.display_name) : results.map((r) => r.label);
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      if (activeIdx >= 0 && items[activeIdx]) {
        pick(items[activeIdx]);
      } else if (value.trim()) {
        setOpen(false);
        onSelect(value.trim());
      }
    }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-1 rounded-md border bg-card transition-all ${open ? "border-primary ring-1 ring-primary/20" : "border-input"}`}
      >
        {searching ? (
          <Loader2 className="ml-2 h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <Search className="ml-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={t("Enter name or ID…")}
          className="w-44 bg-transparent px-1 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {value && (
          <button
            onClick={() => {
              onChange("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="mr-1 text-muted-foreground hover:text-foreground transition"
          >
            <span className="text-xs">✕</span>
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full z-[500] mt-1.5 w-72 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl divide-y divide-border/50">
          {/* Pre-type: show popular offenders */}
          {value.trim().length < 1 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" /> {t("Top offenders")}
              </div>
              {popular.map((p) => (
                <button
                  key={p.person_id}
                  onClick={() => pick(p.display_name)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-left transition"
                >
                  <div className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                    <User className="h-3.5 w-3.5 text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">
                      {p.display_name}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {p.offense_count} {t("cases")} · {p.top_crime_type || "—"}
                      {p.district ? ` · ${p.district}` : ""}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                      p.risk_label === "Critical"
                        ? "bg-destructive/15 text-destructive"
                        : p.risk_label === "High"
                          ? "bg-orange-500/15 text-orange-600"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.risk_label}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* While typing: live search results */}
          {value.trim().length >= 1 && searching && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {value.trim().length >= 1 && !searching && results.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No results for "<strong>{value}</strong>"
            </div>
          )}
          {value.trim().length >= 1 &&
            !searching &&
            results.length > 0 &&
            (() => {
              const persons = results.filter((r) => r.type === "person");
              const cases = results.filter((r) => r.type === "case");
              return (
                <>
                  {persons.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 flex items-center gap-1.5">
                        <User className="h-3 w-3" /> {t("Persons")}
                      </div>
                      {persons.map((r, i) => (
                        <button
                          key={r.id}
                          onClick={() => pick(r.label)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-left transition ${activeIdx === i ? "bg-muted/50" : ""}`}
                        >
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate">
                              {r.label}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {r.sub}
                            </div>
                          </div>
                          {(r.case_count ?? 0) > 0 && (
                            <span className="text-[10px] font-bold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full shrink-0">
                              {r.case_count} {t("cases")}
                            </span>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                  {cases.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 flex items-center gap-1.5">
                        <Hash className="h-3 w-3" /> {t("Cases / FIRs")}
                      </div>
                      {cases.map((r, i) => (
                        <button
                          key={r.id}
                          onClick={() => pick(r.label)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-left transition ${activeIdx === persons.length + i ? "bg-muted/50" : ""}`}
                        >
                          <div className="h-7 w-7 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                            <Hash className="h-3.5 w-3.5 text-orange-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold font-mono text-foreground truncate">
                              {r.label}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {r.sub}
                            </div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </>
              );
            })()}
        </div>
      )}
    </div>
  );
}

function NetworkScreen() {
  const t = useT();
  const { lang } = useI18n();
  const [selected, setSelected] = useState("");
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set());
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [taskMsg, setTaskMsg] = useState<string | null>(null);

  // Live graph data
  const [NODES, setNODES] = useState<any[]>([]);
  const [EDGES, setEDGES] = useState<{ a: string; b: string; label: string }[]>([]);
  const [seedInput, setSeedInput] = useState("");
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphEmpty, setGraphEmpty] = useState(true);
  const [depth, setDepth] = useState(2);
  const [linkMode, setLinkMode] = useState<"people" | "financial" | "rings">("people");
  const [ringCtx, setRingCtx] = useState<{ district?: string; crime_type?: string } | null>(null);
  // Dynamic filter state — derived from live graph data, never hardcoded
  const [edgeTypeFilter, setEdgeTypeFilter] = useState("All");
  const [communityFilter, setCommunityFilter] = useState("All");

  const fetchGraph = useCallback(
    async (seedName: string, queryDepth: number = depth) => {
      setGraphLoading(true);
      setGraphEmpty(false);
      setPos({}); // clear old positions so new nodes animate in
      try {
        const res: any = await api.network({ entity_name: seedName, depth: queryDepth });

        if (!res?.nodes?.length) {
          setNODES([]);
          setEDGES([]);
          setGraphEmpty(true);
          return;
        }

        // Translate node labels dynamically at runtime if language is Kannada
        if (lang === "KN" || lang === "kn") {
          try {
            const { translateOnTheFly } = await import("@/lib/api/intelligence");
            const stringsToTranslate: string[] = [];
            res.nodes.forEach((n: any) => {
              if (n.label) stringsToTranslate.push(n.label);
              if (n.name) stringsToTranslate.push(n.name);
            });
            const translations = await translateOnTheFly(stringsToTranslate);
            res.nodes = res.nodes.map((n: any) => ({
              ...n,
              label: translations[n.label] ?? translations[n.name] ?? n.label ?? n.name,
              name: translations[n.name] ?? translations[n.label] ?? n.name ?? n.label,
            }));
          } catch (e) {
            console.warn("[network] dynamic translation failed:", e);
          }
        }

        const seedId = String(res.seed_id ?? res.root ?? "");

        // Map API nodes — backend returns `kind` not `entity_type`
        const mappedNodes = res.nodes.map((n: any, idx: number) => {
          const nid = String(n.id ?? idx);
          const isSeed = nid === seedId;
          const kind = (n.kind || n.entity_type || "person").toLowerCase();
          const isCase = kind === "case";
          const role = n.role || (isSeed ? "seed" : undefined);

          // Colour group:
          //   0 = seed person (blue)
          //   1 = co-accused person (orange)
          //   2 = victim/complainant (green)
          //   3 = case node (purple)
          let group = 3;
          if (isCase) {
            group = 3;
          } else if (isSeed) {
            group = 0;
          } else {
            const r = (role || "").toLowerCase();
            if (r.includes("accused")) group = 1;
            else if (r.includes("victim") || r.includes("complainant")) group = 2;
            else group = 1; // default co-involved = orange
          }

          // Spread nodes in a circle around center
          const angle = (idx / Math.max(res.nodes.length - 1, 1)) * 2 * Math.PI;
          const radius = isSeed ? 0 : isCase ? 18 : 28;
          const cx = 50,
            cy = 50;

          return {
            id: nid,
            x: isSeed ? cx : cx + radius * Math.cos(angle) + (Math.random() - 0.5) * 4,
            y: isSeed ? cy : cy + radius * Math.sin(angle) + (Math.random() - 0.5) * 4,
            r: isSeed ? 24 : isCase ? 7 : 10 + Math.min(n.degree ?? 1, 6),
            group,
            label: n.label ?? n.name ?? nid,
            role: isSeed ? "seed" : role,
            kind,
            crime_type: n.crime_type,
            caseIds: n.case_ids ?? [],
          };
        });

        const mappedEdges = (res.edges ?? []).map((e: any) => ({
          a: String(e.source),
          b: String(e.target),
          label: (e.label ?? "co-accused").toLowerCase(),
        }));

        setNODES(mappedNodes);
        setEDGES(mappedEdges);
        setEdgeTypeFilter("All");
        setCommunityFilter("All");
        setSelected(seedId);
        setSelectedSet(new Set(seedId ? [seedId] : []));
        setGraphEmpty(mappedNodes.length === 0);
      } catch (err) {
        console.error("[network] fetchGraph error:", err);
        setNODES([]);
        setEDGES([]);
        setEdgeTypeFilter("All");
        setCommunityFilter("All");
        setGraphEmpty(true);
      } finally {
        setGraphLoading(false);
      }
    },
    [depth, lang],
  );

  const handleDepthChange = (newDepth: number) => {
    setDepth(newDepth);
    if (seedInput.trim()) {
      fetchGraph(seedInput.trim(), newDepth);
    }
  };

  // Re-fetch and translate graph reactively when language changes
  useEffect(() => {
    if (seedInput.trim()) {
      fetchGraph(seedInput.trim());
    }
  }, [lang]);

  // Voice command "open network for suspect …" lands here.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/network") return;
      // Structured actions from the Voice Screen Agent
      const actions = Array.isArray(d.actions) ? d.actions : [];
      if (actions.length > 0) {
        for (const a of actions) {
          if (a.screen !== "/network") continue;
          const p = a.params || {};
          if (a.action === "search_seed" && p.entity) {
            setSeedInput(String(p.entity));
            fetchGraph(String(p.entity));
          } else if (a.action === "set_depth" && p.depth) {
            handleDepthChange(Number(p.depth));
          } else if (a.action === "set_link_mode" && p.mode) {
            setLinkMode(p.mode as "people" | "financial" | "rings");
          } else if (a.action === "filter_edge" && p.value) {
            setEdgeTypeFilter(String(p.value));
          } else if (a.action === "filter_community" && p.value) {
            setCommunityFilter(String(p.value));
          }
        }
        return;
      }
      // Legacy free-text task fallback
      setTaskMsg(d.task || d.query || null);
      if (d.task) {
        setSeedInput(d.task);
        fetchGraph(d.task);
      }
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

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("satyam:network-context");
    } catch {}
    if (!raw) return;
    try {
      sessionStorage.removeItem("satyam:network-context");
    } catch {}
    let ctx: { district?: string; crime_type?: string } = {};
    try {
      ctx = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ctx.district && !ctx.crime_type) return;
    setRingCtx({ district: ctx.district || undefined, crime_type: ctx.crime_type || undefined });
    setLinkMode("rings");
  }, []);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<null | "png" | "json">(null);
  const [exportScope, setExportScope] = useState<"selection" | "all">("selection");
  const graphSvgRef = useRef<SVGSVGElement>(null);
  const node = useMemo(() => {
    return (
      NODES.find((n) => n.id === selected) || {
        id: "",
        label: t("No selection"),
        group: 0,
        role: "",
        caseIds: [],
      }
    );
  }, [NODES, selected, t]);

  // ---- Dynamic filter options (derived from live graph data, never hardcoded) ----
  const edgeTypeOptions = useMemo(() => {
    const labels = new Set<string>();
    EDGES.forEach(({ label }) => { if (label) labels.add(label); });
    return ["All", ...Array.from(labels).sort()];
  }, [EDGES]);

  const communityOptions = useMemo(() => {
    const types = new Set<string>();
    NODES.forEach((n) => { if (n.crime_type) types.add(n.crime_type); });
    return ["All", ...Array.from(types).sort()];
  }, [NODES]);

  // ---- Filtered graph (what the SVG actually renders) ----
  const visEdges = useMemo(() => {
    let out = EDGES;
    if (edgeTypeFilter !== "All") out = out.filter((e) => e.label === edgeTypeFilter);
    if (communityFilter !== "All") {
      // Keep only edges where at least one endpoint has the matching crime_type
      const keep = new Set(
        NODES.filter((n) => n.crime_type === communityFilter).map((n) => n.id),
      );
      out = out.filter((e) => keep.has(e.a) || keep.has(e.b));
    }
    return out;
  }, [EDGES, NODES, edgeTypeFilter, communityFilter]);

  const visNodes = useMemo(() => {
    if (communityFilter === "All") return NODES;
    const visIds = new Set<string>();
    visEdges.forEach(({ a, b }) => { visIds.add(a); visIds.add(b); });
    // Always keep the seed node visible
    NODES.forEach((n) => { if (n.role === "seed") visIds.add(n.id); });
    return NODES.filter((n) => visIds.has(n.id));
  }, [NODES, visEdges, communityFilter]);

  // ---- Physics tuning state ----
  const PRESETS_KEY = "fq-network-presets";
  const ACTIVE_KEY = "network.physics.active.v1";
  const [userPresets, setUserPresets] = useState<Record<string, SimParams>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}");
    } catch {
      return {};
    }
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
    try {
      localStorage.setItem(ACTIVE_KEY, name);
    } catch {}
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
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(rest));
    } catch {}
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
  nodesRef.current = visNodes;
  const edgesRef = useRef(EDGES);
  edgesRef.current = visEdges;

  const [pos, setPos] = useState<PosMap>({});
  const posRef = useRef(pos);
  posRef.current = pos;
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [frameMs, setFrameMs] = useState(16);
  const dragRef = useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number }>({
    id: null,
    panning: false,
    lastX: 0,
    lastY: 0,
  });

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
      edgesRef.current.forEach(({ a, b }) => {
        const A = p[a];
        const B = p[b];
        if (!A || !B) return;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const isSeedA = nodesRef.current.find((n) => n.id === a)?.role === "seed";
        const isSeedB = nodesRef.current.find((n) => n.id === b)?.role === "seed";
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
      setPos((prev) => ({
        ...prev,
        [d.id!]: { ...prev[d.id!], x, y, fx: x, fy: y, vx: 0, vy: 0 },
      }));
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

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(3, v.scale * factor)) }));
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
    const edges = EDGES.filter(({ a, b }) => ids.has(a) && ids.has(b));
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
      edges: edges.map(({ a: source, b: target }) => ({ source, target })),
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
      .map(({ a, b }) => {
        const A = nodeMap.get(a)!;
        const B = nodeMap.get(b)!;
        const isSeedA = nodes.find((n) => n.id === a)?.role === "seed";
        const isSeedB = nodes.find((n) => n.id === b)?.role === "seed";
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
        if (shape === "circle")
          shapeXml = `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${color}" stroke="#1a1f2e" stroke-width="${isSeed ? 0.7 : 0.45}"/>`;
        else if (shape === "square")
          shapeXml = `<rect x="${n.x - r}" y="${n.y - r}" width="${r * 2}" height="${r * 2}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
        else if (shape === "diamond")
          shapeXml = `<polygon points="${n.x},${n.y - r} ${n.x + r},${n.y} ${n.x},${n.y + r} ${n.x - r},${n.y}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
        else
          shapeXml = `<polygon points="${n.x},${n.y - r} ${n.x + r},${n.y + r} ${n.x - r},${n.y + r}" fill="${color}" stroke="#1a1f2e" stroke-width="0.45"/>`;
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
                    linkMode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "people"
                    ? t("People & Cases")
                    : m === "financial"
                      ? t("Financial links")
                      : t("Rings")}
                </button>
              ))}
            </div>
          </div>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-5 py-3 text-foreground">
            <Control label={t("Seed entity")}>
              <div className="flex items-center gap-1">
                <SeedSearch
                  value={seedInput}
                  onChange={setSeedInput}
                  onSelect={(name) => fetchGraph(name)}
                  loading={graphLoading}
                  t={t}
                />
                <button
                  onClick={() => seedInput.trim() && fetchGraph(seedInput.trim())}
                  disabled={graphLoading}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {graphLoading ? "…" : "▶"}
                </button>
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
              <Select
                options={edgeTypeOptions}
                value={edgeTypeFilter}
                onChange={setEdgeTypeFilter}
              />
            </Control>
            <Control label={t("Community")}>
              <Select
                options={communityOptions}
                value={communityFilter}
                onChange={setCommunityFilter}
              />
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
                {presetsOpen &&
                  createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9999]"
                        onClick={() => setPresetsOpen(false)}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: `${coords.top + 4}px`,
                          left: `${coords.left}px`,
                        }}
                        className="z-[10000] w-56 max-h-[60vh] overflow-y-auto rounded-[5px] border-2 border-foreground bg-secondary-background p-1 nb-shadow"
                      >
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                          {t("Built-in")}
                        </div>
                        {Object.keys(SIM_PRESETS).map((name) => (
                          <button
                            key={name}
                            onClick={() => applyPreset(name)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted whitespace-nowrap ${activePreset === name ? "bg-muted" : ""}`}
                          >
                            <span className="truncate">{t(name)}</span>
                            {activePreset === name && (
                              <span className="ml-2 text-[10px] text-muted-foreground shrink-0">
                                ✓
                              </span>
                            )}
                          </button>
                        ))}
                        {Object.keys(userPresets).length > 0 && (
                          <>
                            <div className="mt-1 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                              {t("Saved")}
                            </div>
                            {Object.keys(userPresets).map((name) => (
                              <div
                                key={name}
                                className={`group flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted whitespace-nowrap ${activePreset === name ? "bg-muted" : ""}`}
                              >
                                <button
                                  onClick={() => applyPreset(name)}
                                  className="flex-1 text-left truncate mr-1"
                                >
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
                    document.body,
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
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("Scope")}
                        </div>
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
                          <span className="text-[10px] text-muted-foreground">
                            {t("Rendered graph snapshot")}
                          </span>
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
                          <span className="text-[10px] text-muted-foreground">
                            {t("Nodes, edges, metadata")}
                          </span>
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
              <RingsPanel crimeType={ringCtx?.crime_type} district={ringCtx?.district} />
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
                    <h3 className="text-lg font-extrabold uppercase tracking-wide mb-2">
                      {t("Seed Entity Link Graph")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t(
                        "Enter a suspect, victim, case, or vehicle in the search bar above to build and explore the criminal relationship network.",
                      )}
                    </p>
                    <div className="flex justify-center">
                      <input
                        value={seedInput}
                        onChange={(e) => setSeedInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && seedInput.trim()) fetchGraph(seedInput.trim());
                        }}
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
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
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
                <defs>
                  {/* Soft outer glow for nodes */}
                  <filter id="nodeGlow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="1.1" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  {/* Glossy radial gradient per group (light highlight top-left) */}
                  {GROUP_COLOR.map((c, gi) => (
                    <radialGradient
                      key={gi}
                      id={`nodeGrad${gi}`}
                      cx="35%"
                      cy="30%"
                      r="75%"
                    >
                      <stop offset="0%" stopColor={GROUP_COLOR_LIGHT[gi]} />
                      <stop offset="100%" stopColor={c} />
                    </radialGradient>
                  ))}
                </defs>
                {visEdges.map(({ a, b }, i) => {
                  const A = pos[a];
                  const B = pos[b];
                  if (!A || !B) return null;
                  const nodeA = visNodes.find((n) => n.id === a);
                  const nodeB = visNodes.find((n) => n.id === b);
                  const isSeedA = nodeA?.role === "seed";
                  const isSeedB = nodeB?.role === "seed";
                  const isCore = isSeedA || isSeedB;
                  const inSelection =
                    selectedSet.size > 1 && selectedSet.has(a) && selectedSet.has(b);
                  const dimmed = selectedSet.size > 1 && !inSelection;
                  // Curve the edge: control point offset perpendicular to the midpoint.
                  const mx = (A.x + B.x) / 2;
                  const my = (A.y + B.y) / 2;
                  const dx = B.x - A.x;
                  const dy = B.y - A.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const curve = Math.min(len * 0.12, 4); // gentle bow
                  const cx = mx + (-dy / len) * curve;
                  const cy = my + (dx / len) * curve;
                  // Edge colour follows the non-seed end's group for a typed look.
                  const edgeGroup = (isSeedA ? nodeB?.group : nodeA?.group) ?? nodeB?.group ?? 0;
                  const edgeColor = GROUP_COLOR[edgeGroup];
                  return (
                    <path
                      key={i}
                      d={`M ${A.x} ${A.y} Q ${cx} ${cy} ${B.x} ${B.y}`}
                      fill="none"
                      stroke={edgeColor}
                      strokeOpacity={dimmed ? 0.07 : isCore ? 0.55 : 0.28}
                      strokeWidth={isCore ? 0.34 : 0.2}
                      strokeLinecap="round"
                      strokeDasharray={isCore ? undefined : "0.7 0.7"}
                    />
                  );
                })}

                {visNodes.map((n) => {
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
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r + 1.4}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={sel ? 0.45 : 0.3}
                          strokeDasharray="0.5 0.5"
                        />
                      )}
                      {isSeed && (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r + 2.4}
                          fill={color}
                          opacity="0.18"
                          className="animate-pulse"
                        />
                      )}
                      {GROUP_SHAPE[n.group] === "circle" && (
                        <>
                          {/* Soft colour glow halo */}
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={r + 0.9}
                            fill={color}
                            opacity={0.22}
                            filter="url(#nodeGlow)"
                          />
                          {/* Glossy gradient body */}
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={r}
                            fill={`url(#nodeGrad${n.group})`}
                            stroke="#ffffff"
                            strokeWidth={isSeed ? 0.5 : 0.32}
                            strokeOpacity={0.85}
                          />
                          {/* White icon glyph centred in the node */}
                          <g
                            transform={`translate(${p.x - r * 0.62}, ${p.y - r * 0.62}) scale(${(r * 1.24) / 24})`}
                            pointerEvents="none"
                          >
                            <path
                              d={groupIcon(n.group).path}
                              fill={groupIcon(n.group).filled ? "#ffffff" : "none"}
                              stroke="#ffffff"
                              strokeWidth={groupIcon(n.group).filled ? 0 : 1.6}
                              strokeLinejoin="round"
                              opacity={0.95}
                            />
                          </g>
                        </>
                      )}
                      {GROUP_SHAPE[n.group] === "square" && (
                        <rect
                          x={p.x - r}
                          y={p.y - r}
                          width={r * 2}
                          height={r * 2}
                          fill={color}
                          stroke="currentColor"
                          strokeWidth="0.45"
                        />
                      )}
                      {GROUP_SHAPE[n.group] === "diamond" && (
                        <>
                          <polygon
                            points={`${p.x},${p.y - r - 0.7} ${p.x + r + 0.7},${p.y} ${p.x},${p.y + r + 0.7} ${p.x - r - 0.7},${p.y}`}
                            fill={color}
                            opacity={0.22}
                            filter="url(#nodeGlow)"
                          />
                          <polygon
                            points={`${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`}
                            fill={`url(#nodeGrad${n.group})`}
                            stroke="#ffffff"
                            strokeWidth="0.4"
                            strokeOpacity={0.85}
                          />
                          <g
                            transform={`translate(${p.x - r * 0.52}, ${p.y - r * 0.52}) scale(${(r * 1.04) / 24})`}
                            pointerEvents="none"
                          >
                            <path
                              d={ICON_DOC}
                              fill="none"
                              stroke="#ffffff"
                              strokeWidth={1.6}
                              strokeLinejoin="round"
                              opacity={0.95}
                            />
                          </g>
                        </>
                      )}
                      {GROUP_SHAPE[n.group] === "triangle" && (
                        <polygon
                          points={`${p.x},${p.y - r} ${p.x + r},${p.y + r} ${p.x - r},${p.y + r}`}
                          fill={color}
                          stroke="currentColor"
                          strokeWidth="0.45"
                        />
                      )}
                      {/* Label pill */}
                      <g
                        transform={`translate(${p.x}, ${p.y + r + 2.6})`}
                        className="text-foreground"
                      >
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
                <span className="font-mono">
                  {NODES.length} NODES · {EDGES.length} EDGES
                </span>
                <span className="h-3 w-px bg-background/30 hidden sm:inline-block" />
                <span className="font-mono opacity-60 hidden sm:inline">
                  Δ {frameMs.toFixed(1)}ms
                </span>
                <span className="h-3 w-px bg-background/30 hidden md:inline-block" />
                <span className="font-mono opacity-60 hidden md:inline">
                  {(view.scale * 100).toFixed(0)}%
                </span>
              </div>

              {/* Zoom HUD (bottom-right) */}
              <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
                <button
                  onClick={() => zoomBy(0.83)}
                  className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition"
                  aria-label="Zoom in"
                >
                  <span className="text-base font-black leading-none">+</span>
                </button>
                <button
                  onClick={() => zoomBy(1.2)}
                  className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition"
                  aria-label="Zoom out"
                >
                  <span className="text-base font-black leading-none">−</span>
                </button>
                <button
                  onClick={recenter}
                  className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-card text-[11px] font-black text-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition"
                  aria-label="Recenter"
                >
                  ⊙
                </button>
              </div>
            </div>
          )}{" "}
          {/* end linkMode === "financial" ternary */}
        </section>

        {/* Node inspector */}
        <aside className="w-80 shrink-0 border-l border-border bg-card overflow-auto">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("Node inspector")}
            </div>
            <h3 className="text-sm font-semibold text-foreground">{node.label}</h3>
          </div>
          <div className="p-4 space-y-4">
            {(() => {
              const selNode = NODES.find((n) => n.id === selected) as any;
              const edgeCount = visEdges.filter(({ a, b }) => a === selected || b === selected).length;
              const isSeed = selNode?.role === "seed";
              const kind = selNode?.kind || "person";
              const isCase = kind === "case";
              const roleLabel = selNode?.role
                ? selNode.role.charAt(0).toUpperCase() + selNode.role.slice(1)
                : isCase
                  ? "FIR / Case"
                  : "—";
              const crimeType = selNode?.crime_type;
              const groupLabel =
                ["Seed Person", "Accused", "Victim / Complainant", "Case / FIR"][
                  selNode?.group ?? 0
                ] || "—";

              return (
                <>
                  {/* Role badge */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        isSeed
                          ? "bg-primary text-primary-foreground"
                          : selNode?.group === 1
                            ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
                            : selNode?.group === 2
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                      }`}
                    >
                      {t(groupLabel)}
                    </span>
                    {isSeed && (
                      <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold">
                        {t("SEED")}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={t("Connections")} value={String(edgeCount)} />
                    <Stat label={t("Node type")} value={isCase ? t("FIR/Case") : t("Person")} />
                    <Stat
                      label={t("Role")}
                      value={t(roleLabel)}
                      tone={selNode?.group === 1 ? "red" : undefined}
                    />
                    {crimeType && <Stat label={t("Crime type")} value={tData("crime_type", crimeType, lang)} />}
                  </div>

                  {/* Linked cases */}
                  {(selNode?.caseIds?.length ?? 0) > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("Linked cases")}
                      </div>
                      <div className="space-y-1.5">
                        {(selNode?.caseIds ?? []).slice(0, 5).map((cid: number) => (
                          <button
                            key={cid}
                            onClick={() => setDrawerCaseId(cid)}
                            className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            <span className="font-mono text-foreground">#{cid}</span>
                            <span className="text-[10px] text-primary hover:underline">
                              {t("Open")} →
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Case node: open directly */}
                  {isCase && selected.startsWith("case:") && (
                    <button
                      onClick={() => setDrawerCaseId(parseInt(selected.replace("case:", ""), 10))}
                      className="w-full flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-bold hover:bg-primary/90 transition"
                    >
                      {t("Open case")} →
                    </button>
                  )}

                  {(selNode?.caseIds?.length ?? 0) === 0 && !isCase && (
                    <p className="text-xs text-muted-foreground">
                      {t("No linked cases found for this node.")}
                    </p>
                  )}

                  {/* Network summary */}
                  {isSeed && NODES.length > 1 && (
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1">
                      <div className="font-bold text-foreground mb-2">{t("Network summary")}</div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t("Total nodes")}</span>
                        <span className="font-bold text-foreground">{visNodes.length}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t("Accused")}</span>
                        <span className="font-bold text-orange-600">
                          {visNodes.filter((n: any) => n.group === 1).length}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t("Victims")}</span>
                        <span className="font-bold text-emerald-600">
                          {visNodes.filter((n: any) => n.group === 2).length}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t("Cases / FIRs")}</span>
                        <span className="font-bold text-purple-600">
                          {visNodes.filter((n: any) => n.group === 3).length}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </aside>
      </div>

      <CaseDrawer
        open={drawerCaseId != null}
        caseId={drawerCaseId ?? undefined}
        onClose={() => setDrawerCaseId(null)}
      />
    </Shell>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
function Select({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange?: (v: string) => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="appearance-none rounded-md border border-input bg-card px-2.5 py-1.5 pr-7 text-sm text-foreground"
      >
        {options.map((o) => {
          let display = o;
          if (o === "All") {
            display = t("All");
          } else {
            display = tAuto(o, lang);
            if (display === o) {
              display = tAuto(o.toUpperCase(), lang);
            }
            if (display === o) {
              const cap = o.charAt(0).toUpperCase() + o.slice(1);
              const trans = t(cap);
              if (trans !== cap) display = trans;
            }
          }
          return (
            <option key={o} value={o}>
              {display}
            </option>
          );
        })}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-semibold ${tone === "red" ? "text-destructive" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
function Legend() {
  const t = useT();
  const items = [
    { l: t("Seed person"), c: GROUP_COLOR[0], s: "●" },
    { l: t("Accused / co-accused"), c: GROUP_COLOR[1], s: "●" },
    { l: t("Victim / complainant"), c: GROUP_COLOR[2], s: "●" },
    { l: t("Case / FIR"), c: GROUP_COLOR[3], s: "◆" },
  ];
  return (
    <div className="hidden lg:flex items-center gap-3 text-[10px]">
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-1">
          <span style={{ color: i.c }} className="text-sm">
            {i.s}
          </span>
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
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
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
