import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import { X, FileDown, MapPin, Table2, FileText, GripVertical } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";

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
  const [items, setItems] = useState<Item[]>([
    { id: "1", type: "table", title: "Theft FIRs · Whitefield zone (30d)", meta: "142 rows · 6 stations" },
    { id: "2", type: "map", title: "Hotspot snapshot · Whitefield", meta: "Heat layer · 14 Aug 2024" },
    { id: "3", type: "case", title: "Case FIR-2024-08842", meta: "Motor vehicle theft · ITPL Main Rd" },
  ]);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg(null);
    try {
      const caseIds = items
        .filter((i) => i.type === "case")
        .map((i) => i.title.match(/FIR-[0-9-]+/)?.[0] ?? i.title);
      const res: any = await api.buildReport({
        title: "Intelligence Brief — Whitefield Zone",
        case_ids: caseIds,
        include_map: items.some((i) => i.type === "map"),
        include_network: false,
      });
      setGenMsg(t("Report ready") + ` · ${res?.report_id ?? "ok"}`);
    } catch {
      setGenMsg(t("Preview ready (offline demo)"));
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
                  <h1 className="text-xl font-bold text-foreground">{t("Intelligence Brief — Whitefield Zone")}</h1>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <div>{t("Ref: KSP/INT/2024/0814")}</div>
                  <div>{t("Generated: 14 Aug 2024")}</div>
                </div>
              </div>
            </div>

            <div className="px-10 py-8 space-y-6 text-[13px] leading-relaxed">
              <Section title={t("1. Executive Summary")}>
                <p>
                  {t("Reported theft incidents in the Whitefield police zone increased 12% over the trailing 30-day period (n=142), led by Whitefield PS (47 cases) and Mahadevapura PS (38). Investigation has identified a probable organized cluster (community C-01) of 8 linked individuals operating along ITPL Main Road.")}
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
                        <th className="px-2 py-1.5 font-semibold">{t("Top §")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[["Whitefield PS", 47, 14, 379], ["Mahadevapura", 38, 11, 379], ["KR Puram", 22, 6, 411], ["Marathahalli", 18, 4, 379]].map((r) => (
                        <tr key={r[0] as string}>
                          <td className="px-2 py-1.5">{r[0]}</td>
                          <td className="px-2 py-1.5">{r[1]}</td>
                          <td className="px-2 py-1.5">{r[2]}</td>
                          <td className="px-2 py-1.5 font-mono">§{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title={t("3. Geospatial Concentration")}>
                <div className="rounded border border-border bg-[oklch(0.94_0.02_220)] h-40 grid place-items-center">
                  <MapPin className="h-7 w-7 text-destructive" />
                </div>
              </Section>

              <Section title={t("4. Key Case")}>
                <div className="rounded border border-border bg-muted/30 p-3">
                  <div className="font-mono text-[11px] text-foreground">FIR-2024-08842</div>
                  <div className="text-[11px] text-muted-foreground">{t("Motor vehicle theft · ITPL Main Rd")} · 14 Aug 2024</div>
                  <div className="mt-1 flex gap-1">
                    {["379","411","34"].map(s => <span key={s} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-mono">§{s}</span>)}
                  </div>
                </div>
              </Section>

              <div className="pt-4 border-t border-border text-[10px] text-muted-foreground">
                <div className="font-semibold text-foreground">{t("Citations")}</div>
                <div className="mt-1 space-y-0.5 font-mono">
                  <div>[1] network.community_id = C-01 · centrality.hub = S1</div>
                  <div>[2] fir_records WHERE zone='Whitefield' AND date BETWEEN '2024-07-15' AND '2024-08-14'</div>
                  <div>[3] geo.hotspots(layer='heat', view='by_crime', zone='Whitefield')</div>
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
