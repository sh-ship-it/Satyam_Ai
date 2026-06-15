import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import { X, FileDown, MapPin, Table2, FileText, GripVertical, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api, type StationRow } from "@/lib/api/client";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · Satyam" },
      { name: "description", content: "Build and export official intelligence reports." },
    ],
  }),
  component: Reports,
});

type Item = { id: string; type: "table" | "map" | "case"; title: string; meta: string };

function Reports() {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]); // Start empty — user adds from other screens
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [previewStations, setPreviewStations] = useState<StationRow[]>([]);
  const [reportTitle, setReportTitle] = useState("Karnataka Crime Intelligence Brief");

  // Load top-10 stations for the preview pane
  useEffect(() => {
    api.stationBreakdown({ limit: 10 } as any)
      .then((r) => setPreviewStations(r.rows || []))
      .catch(() => {});
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg(null);
    try {
      const caseIds = items
        .filter((i) => i.type === "case")
        .map((i) => parseInt(i.id, 10))
        .filter(Boolean);
      const res: any = await api.buildReport({
        title: reportTitle,
        case_ids: caseIds,
        include_map: items.some((i) => i.type === "map"),
        include_network: false,
      });
      setGenMsg(t("Report ready") + ` · ${res?.report_id ?? "ok"}`);
    } catch {
      setGenMsg(t("Preview rendered (backend unreachable)"));
    } finally {
      setGenerating(false);
    }
  }

  // Voice command "open reports and generate the brief" lands here.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/reports") return;
      handleGenerate();
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [items]);

  return (
    <Shell>
      <div className="grid grid-cols-[380px_1fr] h-[calc(100vh-3.5rem-26px)]">
        {/* Cart */}
        <aside className="border-r border-border bg-card flex flex-col">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Saved items")}</div>
            <h2 className="text-sm font-semibold text-foreground">{t("Report cart")} · {items.length}</h2>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {items.map((it) => (
              <div key={it.id} className="group flex items-start gap-2 rounded-lg border border-border bg-card p-3 shadow-sm hover:border-primary/40 transition">
                <GripVertical className="mt-1 h-4 w-4 text-muted-foreground/60 cursor-grab" />
                <ItemIcon type={it.type} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{t(it.title)}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t(it.meta)}</div>
                </div>
                <button
                  onClick={() => setItems((arr) => arr.filter((x) => x.id !== it.id))}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100 transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                {t("No items yet. Add results from Console, Map, or Network.")}
              </div>
            )}
          </div>
          <div className="border-t border-border p-3 space-y-2">
            <select className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm">
              <option>{t("Template: KSP Intelligence Brief")}</option>
              <option>{t("Template: Court submission")}</option>
              <option>{t("Template: Daily digest")}</option>
            </select>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-60"
            >
              <FileDown className="h-4 w-4" /> {generating ? t("Generating…") : t("Generate PDF")}
            </button>
            {genMsg && (
              <div className="text-[11px] text-center text-muted-foreground">{genMsg}</div>
            )}
          </div>
        </aside>

        {/* Preview */}
        <section className="overflow-auto bg-muted/40 p-8">
          <div className="mx-auto max-w-2xl rounded-md bg-card shadow-xl border border-border overflow-hidden">
            {/* Document */}
            <div className="border-b-4 border-primary bg-card px-10 py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("Karnataka State Police")}</div>
                  <h1 className="text-xl font-bold text-foreground">{reportTitle}</h1>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <div>{t("Ref: KSP/INT/")} {new Date().getFullYear()}/{String(new Date().getMonth()+1).padStart(2,"0")}</div>
                  <div>{t("Generated:")} {new Date().toLocaleDateString()}</div>
                </div>
              </div>
            </div>

            <div className="px-10 py-8 space-y-6 text-[13px] leading-relaxed">
              <Section title={t("1. Executive Summary")}>
                <p>
                  {previewStations.length > 0
                    ? `${t("Top station:")}: ${previewStations[0].station} (${previewStations[0].firs} ${t("FIRs")}, ${previewStations[0].cleared} ${t("cleared")}). ${t("Report covers")} ${previewStations.length} ${t("stations across the scoped jurisdiction.")}`
                    : t("AI-grounded summary will appear here once items are added from Console, Map, or Network.")}
                  <sup className="text-primary">[1]</sup>
                </p>
              </Section>

              <Section title={t("2. Distribution by Station")}>
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 font-semibold">{t("Station")}</th>
                        <th className="px-2 py-1.5 font-semibold">{t("FIRs")}</th>
                        <th className="px-2 py-1.5 font-semibold">{t("Cleared")}</th>
                        <th className="px-2 py-1.5 font-semibold">{t("Top crime")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewStations.length > 0
                        ? previewStations.map((r) => (
                            <tr key={r.station}>
                              <td className="px-2 py-1.5">{r.station}</td>
                              <td className="px-2 py-1.5">{r.firs}</td>
                              <td className="px-2 py-1.5">{r.cleared}</td>
                              <td className="px-2 py-1.5 font-mono">{r.top_legal_code ?? "—"}</td>
                            </tr>
                          ))
                        : <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground text-[11px]">{t("Loading…")}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title={t("3. Geospatial Concentration")}>
                <div className="rounded border border-border bg-[oklch(0.94_0.02_220)] h-40 grid place-items-center">
                  <MapPin className="h-7 w-7 text-destructive" />
                </div>
              </Section>

              <Section title={t("4. Items in Report")}>
                {items.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
                    <Sparkles className="h-5 w-5 text-primary/60" />
                    <p className="text-sm text-muted-foreground">{t("Add items from Console, Map, or Network to include them here.")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((i) => (
                      <div key={i.id} className="rounded border border-border bg-muted/30 p-2.5">
                        <div className="font-mono text-[11px] text-foreground">{i.title}</div>
                        <div className="text-[10px] text-muted-foreground">{i.meta}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div className="pt-4 border-t border-border text-[10px] text-muted-foreground">
                <div className="font-semibold text-foreground">{t("Citations")}</div>
                <div className="mt-1 space-y-0.5 font-mono">
                  <div>[1] station_breakdown · RLS-scoped · {new Date().toISOString().slice(0,10)}</div>
                  {items.map((it, idx) => (
                    <div key={it.id}>[{idx+2}] {it.title}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function ItemIcon({ type }: { type: Item["type"] }) {
  const C = type === "table" ? Table2 : type === "map" ? MapPin : FileText;
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
      <C className="h-4 w-4" />
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[13px] font-bold text-foreground">{title}</h2>
      <div className="text-foreground/85">{children}</div>
    </div>
  );
}
