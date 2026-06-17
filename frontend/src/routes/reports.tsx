import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect, useRef } from "react";
import {
  X, FileDown, MapPin, Table2, FileText, Sparkles, Search,
  Loader2, User, Hash, Printer, ChevronDown, Plus, ShieldAlert,
  TrendingUp, BarChart3, AlertTriangle,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { api, type StationRow } from "@/lib/api/client";
import { intelligence, type SearchResult } from "@/lib/api/intelligence";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · Satyam" },
      { name: "description", content: "Build and export official intelligence reports." },
    ],
  }),
  component: Reports,
});

// ── Types ─────────────────────────────────────────────────────────────────────
type ItemType = "table" | "map" | "case" | "person" | "alert";
type ReportItem = {
  id: string;
  type: ItemType;
  title: string;
  meta: string;
  data?: Record<string, unknown>;
};

type Template = "brief" | "court" | "digest" | "person";

const TEMPLATES: Record<Template, { label: string; sections: string[] }> = {
  brief:  { label: "KSP Intelligence Brief",  sections: ["executive_summary", "station_distribution", "top_crimes", "items", "citations"] },
  court:  { label: "Court Submission",         sections: ["executive_summary", "items", "legal_notice", "citations"] },
  digest: { label: "Daily Digest",             sections: ["executive_summary", "station_distribution", "items", "citations"] },
  person: { label: "Person Dossier",           sections: ["executive_summary", "items", "citations"] },
};

// ── Inject print styles once ──────────────────────────────────────────────────
function injectPrintStyles() {
  if (document.getElementById("report-print-styles")) return;
  const s = document.createElement("style");
  s.id = "report-print-styles";
  s.textContent = `
    @media print {
      body > * { display: none !important; }
      #report-print-area { display: block !important; }
      .no-print { display: none !important; }
      @page { margin: 18mm 16mm; size: A4; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; background: white; }
    }
    #report-print-area { display: none; }
  `;
  document.head.appendChild(s);
}

// ── Search + Add to Cart bar ──────────────────────────────────────────────────
function AddItemBar({ onAdd }: { onAdd: (item: ReportItem) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setLoading(true);
      intelligence.searchPersonsAndCases(q.trim(), 10)
        .then(r => { setResults(r); setOpen(true); })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  function addItem(r: SearchResult) {
    setQ(""); setResults([]); setOpen(false);
    onAdd({
      id: `${r.type}-${r.id}-${Date.now()}`,
      type: r.type === "person" ? "person" : "case",
      title: r.label,
      meta: r.sub,
      data: { id: r.id, type: r.type, label: r.label, sub: r.sub, gender: r.gender, age: r.age, district: r.district, case_count: r.case_count } as unknown as Record<string, unknown>,
    });
  }

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-xl border bg-background px-3 py-2 transition-all
        ${open ? "border-primary ring-1 ring-primary/20" : "border-input"}`}>
        {loading ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
          : <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder={t("Search and add person, FIR, crime type…")}
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {q && <button onClick={() => { setQ(""); setResults([]); setOpen(false); }}
          className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden divide-y divide-border/40 max-h-64 overflow-y-auto">
          {results.map(r => (
            <button key={`${r.type}-${r.id}`} onClick={() => addItem(r)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-left transition">
              <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${r.type === "person" ? "bg-primary/10" : "bg-orange-500/10"}`}>
                {r.type === "person" ? <User className="h-3.5 w-3.5 text-primary" /> : <Hash className="h-3.5 w-3.5 text-orange-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{r.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{r.sub}</div>
              </div>
              <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function Reports() {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();

  const [items, setItems] = useState<ReportItem[]>([]);
  const [template, setTemplate] = useState<Template>("brief");
  const [reportTitle, setReportTitle] = useState("Karnataka Crime Intelligence Brief");
  const [officerName, setOfficerName] = useState("");
  const [reportRef, setReportRef] = useState(`KSP/INT/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}`);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);

  // Live data
  const [stations, setStations] = useState<StationRow[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);

  useEffect(() => {
    injectPrintStyles();
    setStationsLoading(true);
    api.stationBreakdown({ limit: 10 } as any)
      .then((r) => setStations(r.rows || []))
      .catch(() => {})
      .finally(() => setStationsLoading(false));
  }, []);

  // Voice command hook
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/reports") return;
      handlePrint();
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  function addItem(item: ReportItem) {
    setItems(prev => {
      if (prev.some(x => x.id === item.id || (x.type === item.type && x.title === item.title))) return prev;
      return [...prev, item];
    });
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(x => x.id !== id));
  }

  function addStation(station: string, firs: number, cleared: number) {
    addItem({ id: `table-${station}`, type: "table", title: station, meta: `${firs} FIRs · ${cleared} cleared` });
  }

  function selectTemplate(t: Template) {
    setTemplate(t);
    setReportTitle(TEMPLATES[t].label);
    setTemplateOpen(false);
  }

  async function handlePrint() {
    // Populate the hidden print div with the current report content, then print
    const printEl = document.getElementById("report-print-area");
    const previewEl = document.getElementById("report-preview-content");
    if (printEl && previewEl) {
      printEl.innerHTML = previewEl.innerHTML;
    }
    window.print();
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg(null);
    try {
      const caseIds = items.filter(i => i.type === "case").map(i => Number((i.data as any)?.id)).filter(Boolean);
      const res: any = await api.buildReport({ title: reportTitle, case_ids: caseIds, include_map: items.some(i => i.type === "map") });
      setGenMsg(`Report ready · ${res?.report_id ?? "ok"}`);
    } catch {
      // Fall back to client-side print
      handlePrint();
    } finally {
      setGenerating(false);
    }
  }

  const totalFirs = stations.reduce((s, r) => s + r.firs, 0);
  const totalCleared = stations.reduce((s, r) => s + r.cleared, 0);
  const clearRate = totalFirs ? Math.round((totalCleared / totalFirs) * 100) : 0;
  const topStation = stations[0];
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Shell>
      {/* Hidden print target */}
      <div id="report-print-area" aria-hidden="true" />

      <div className="grid grid-cols-[320px_1fr] h-[calc(100vh-3.5rem-26px)]">

        {/* ── LEFT PANEL — cart + controls ─────────────────────────────── */}
        <aside className="border-r border-border bg-card flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b border-border px-4 py-3 bg-card">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">{t("Report Builder")}</div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">{t("Report cart")} · {items.length}</h2>
              {items.length > 0 && (
                <button onClick={() => setItems([])} className="text-[10px] text-muted-foreground hover:text-destructive transition">
                  {t("Clear all")}
                </button>
              )}
            </div>
          </div>

          {/* Search add */}
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <AddItemBar onAdd={addItem} />
          </div>

          {/* Quick add from live data */}
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t("Quick add — Top Stations")}</div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {stationsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("Loading…")}
                </div>
              ) : stations.slice(0, 5).map(r => (
                <button key={r.station} onClick={() => addStation(r.station, r.firs, r.cleared)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left hover:bg-muted/50 transition group">
                  <span className="text-xs text-foreground truncate flex-1">{r.station}</span>
                  <span className="text-[10px] text-muted-foreground mr-2">{r.firs} FIRs</span>
                  <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center mt-2">
                <Sparkles className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">{t("Search above to add persons, FIRs, or use quick add")}</p>
              </div>
            ) : (
              items.map(it => (
                <div key={it.id} className="group flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2.5 hover:border-primary/30 transition">
                  <ItemIcon type={it.type} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{it.title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{it.meta}</div>
                  </div>
                  <button onClick={() => removeItem(it.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Settings + actions */}
          <div className="border-t border-border p-3 space-y-2.5 bg-muted/20">
            {/* Report title */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1">{t("Report Title")}</label>
              <input value={reportTitle} onChange={e => setReportTitle(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>

            {/* Officer / Prepared by */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1">{t("Prepared by")}</label>
              <input value={officerName} onChange={e => setOfficerName(e.target.value)}
                placeholder={t("Officer name / rank")}
                className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>

            {/* Template picker */}
            <div className="relative">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1">{t("Template")}</label>
              <button onClick={() => setTemplateOpen(v => !v)}
                className="w-full flex items-center justify-between rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs hover:bg-muted transition">
                <span>{TEMPLATES[template].label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {templateOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTemplateOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {(Object.entries(TEMPLATES) as [Template, typeof TEMPLATES[Template]][]).map(([key, val]) => (
                      <button key={key} onClick={() => selectTemplate(key)}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-muted transition ${template === key ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}`}>
                        {val.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Generate buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handlePrint}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-input bg-background py-2 text-xs font-semibold hover:bg-muted transition">
                <Printer className="h-3.5 w-3.5" /> {t("Print PDF")}
              </button>
              <button onClick={handleGenerate} disabled={generating}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground py-2 text-xs font-bold hover:bg-primary/90 transition disabled:opacity-60">
                <FileDown className="h-3.5 w-3.5" /> {generating ? t("Generating…") : t("Generate PDF")}
              </button>
            </div>
            {genMsg && <p className="text-[10px] text-center text-muted-foreground">{genMsg}</p>}
          </div>
        </aside>

        {/* ── RIGHT PANEL — live report preview ───────────────────────── */}
        <section className="overflow-auto bg-muted/30 p-6">
          <div id="report-preview-content" className="mx-auto max-w-[780px] bg-white dark:bg-card rounded-2xl shadow-2xl border border-border overflow-hidden"
            style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>

            {/* ── KSP Letterhead ─────────────────────────────────────── */}
            <div className="bg-[#1a1a2e] text-white px-10 py-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-blue-200/80 mb-1">Karnataka State Police</div>
                  <h1 className="text-[22px] font-extrabold tracking-tight leading-tight">{reportTitle}</h1>
                  <div className="text-[11px] text-blue-100/70 mt-1.5 flex items-center gap-3">
                    <span>Ref: {reportRef}</span>
                    <span>·</span>
                    <span>Generated: {today}</span>
                    {officerName && <><span>·</span><span>By: {officerName}</span></>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[9px] text-blue-200/60 uppercase tracking-wider">Classification</div>
                  <div className="text-sm font-bold text-yellow-300 mt-0.5">CONFIDENTIAL</div>
                  <div className="text-[9px] text-blue-200/60 mt-2">Synthetic data only</div>
                </div>
              </div>
              {/* Stats bar */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: "Total FIRs", val: stationsLoading ? "—" : totalFirs.toLocaleString(), icon: BarChart3 },
                  { label: "Cleared",    val: stationsLoading ? "—" : `${totalCleared.toLocaleString()} (${clearRate}%)`, icon: TrendingUp },
                  { label: "Stations",   val: stationsLoading ? "—" : stations.length.toString(), icon: MapPin },
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-white/10 px-4 py-2.5 flex items-center gap-3">
                    <s.icon className="h-4 w-4 text-blue-200/70 shrink-0" />
                    <div>
                      <div className="text-[10px] text-blue-200/60">{s.label}</div>
                      <div className="text-base font-bold text-white tabular-nums">{s.val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-10 py-8 space-y-8 text-[13px] text-[#1a1a2e] dark:text-foreground leading-relaxed">

              {/* ── 1. Executive Summary ─────────────────────────────── */}
              <DocSection num="1" title={t("Executive Summary")} icon={<FileText className="h-4 w-4" />}>
                <div className="bg-muted/30 rounded-xl p-4 text-sm leading-relaxed">
                  {topStation ? (
                    <p>
                      Top performing station: <strong>{topStation.station}</strong> with{" "}
                      <strong>{topStation.firs.toLocaleString()}</strong> FIRs registered,{" "}
                      <strong>{topStation.cleared}</strong> cases cleared.{" "}
                      Report covers <strong>{stations.length}</strong> stations in the scoped jurisdiction.{" "}
                      Overall clearance rate: <strong>{clearRate}%</strong>.
                      {items.length > 0 && ` Report includes ${items.length} selected item${items.length > 1 ? "s" : ""}.`}
                      <sup className="text-primary ml-0.5">[1]</sup>
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      {t("Loading station data…")}
                    </p>
                  )}
                </div>
              </DocSection>

              {/* ── 2. Station Distribution ─────────────────────────── */}
              <DocSection num="2" title={t("Distribution by Station")} icon={<BarChart3 className="h-4 w-4" />}>
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full">
                    <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold">#</th>
                        <th className="px-4 py-2.5 text-left font-semibold">{t("Station")}</th>
                        <th className="px-4 py-2.5 text-right font-semibold">{t("FIRs")}</th>
                        <th className="px-4 py-2.5 text-right font-semibold">{t("Cleared")}</th>
                        <th className="px-4 py-2.5 text-right font-semibold">{t("Clearance Rate")}</th>
                        <th className="px-4 py-2.5 text-left font-semibold">{t("Top Crime")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {stationsLoading ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-sm">
                          <Loader2 className="h-4 w-4 animate-spin mx-auto" /></td></tr>
                      ) : stations.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-sm">{t("No data")}</td></tr>
                      ) : stations.map((r, i) => {
                        const rate = r.firs ? Math.round((r.cleared / r.firs) * 100) : 0;
                        return (
                          <tr key={r.station} className={`${i % 2 === 0 ? "" : "bg-muted/20"} hover:bg-primary/5 transition`}>
                            <td className="px-4 py-2.5 text-muted-foreground text-[11px] tabular-nums">{i + 1}</td>
                            <td className="px-4 py-2.5 font-medium text-sm">{r.station}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-bold">{r.firs.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.cleared}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-[11px] font-bold ${rate >= 60 ? "text-emerald-600 dark:text-emerald-400" : rate >= 30 ? "text-yellow-600" : "text-destructive"}`}>
                                {rate}%
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {r.top_legal_code
                                ? <span className="rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-mono">{tData("crime_type", r.top_legal_code, lang)}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {stations.length > 0 && (
                      <tfoot className="bg-muted/40 border-t-2 border-border text-[11px] font-bold text-muted-foreground">
                        <tr>
                          <td className="px-4 py-2" colSpan={2}>{t("Total")}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground">{totalFirs.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground">{totalCleared.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-foreground">{clearRate}%</td>
                          <td className="px-4 py-2" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </DocSection>

              {/* ── 3. Items in Report ───────────────────────────────── */}
              <DocSection num="3" title={t("Selected Items")} icon={<FileText className="h-4 w-4" />}>
                {items.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 text-center">
                    <Sparkles className="h-6 w-6 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">{t("Add persons or cases from the search bar on the left.")}</p>
                    <p className="text-xs text-muted-foreground/70">{t("Items will appear here and be included in the exported PDF.")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div key={item.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold ${
                          item.type === "person" ? "bg-primary" : item.type === "case" ? "bg-orange-500" : "bg-muted-foreground"}`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-foreground">{item.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{item.meta}</div>
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5 uppercase tracking-wide">{item.type}</div>
                        </div>
                        {item.type === "person" && (
                          <button
                            onClick={() => navigate({ to: "/profile/$personId", params: { personId: String((item.data as any)?.id) } })}
                            className="shrink-0 text-[10px] text-primary hover:underline">{t("View profile")}</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </DocSection>

              {/* ── 4. Ethics notice ─────────────────────────────────── */}
              <DocSection num="4" title={t("Compliance Notice")} icon={<ShieldAlert className="h-4 w-4" />}>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("This report is generated for law enforcement use only. All data shown is synthetic and does not represent real individuals, cases, or incidents. Risk scores are decision-support tools — not predictive policing instruments. Human review is required before any operational action.")}
                  </p>
                </div>
              </DocSection>

              {/* ── Citations ─────────────────────────────────────────── */}
              <div className="pt-6 border-t border-border">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t("Citations")}</div>
                <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  <div>[1] station_breakdown · RLS-scoped · {new Date().toISOString().slice(0, 10)}</div>
                  {items.map((it, idx) => (
                    <div key={it.id}>[{idx + 2}] {it.type} · {it.title} · {it.meta}</div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="bg-muted/30 rounded-xl px-5 py-3 text-[10px] text-muted-foreground flex items-center justify-between">
                <span>Karnataka State Police · Satyam Intelligence System</span>
                <span className="font-mono">{reportRef}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────
function ItemIcon({ type }: { type: ItemType }) {
  const configs: Record<ItemType, { icon: React.ComponentType<{ className?: string }>; bg: string }> = {
    table:  { icon: Table2,   bg: "bg-blue-500/10 text-blue-600" },
    map:    { icon: MapPin,   bg: "bg-emerald-500/10 text-emerald-600" },
    case:   { icon: Hash,     bg: "bg-orange-500/10 text-orange-600" },
    person: { icon: User,     bg: "bg-primary/10 text-primary" },
    alert:  { icon: AlertTriangle, bg: "bg-destructive/10 text-destructive" },
  };
  const { icon: Icon, bg } = configs[type] || configs.case;
  return (
    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${bg}`}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

function DocSection({ num, title, icon, children }: {
  num: string; title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-[10px] font-extrabold shrink-0">{num}</div>
        <h2 className="text-[13px] font-bold text-foreground flex items-center gap-1.5">{icon}{title}</h2>
      </div>
      {children}
    </div>
  );
}
