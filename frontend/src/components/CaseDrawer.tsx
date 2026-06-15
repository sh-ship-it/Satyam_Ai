import { X, Lock, MapPin, FileDown, Plus } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";

export function CaseDrawer({
  open,
  onClose,
  firNo = "FIR-2024-08842",
}: {
  open: boolean;
  onClose: () => void;
  firNo?: string;
}) {
  const t = useT();
  const [tab, setTab] = useState<"summary" | "persons" | "map">("summary");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-card shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Case")}</div>
            <h2 className="text-lg font-semibold text-foreground">{firNo}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border bg-muted/40 px-3">
          {(["summary", "persons", "map"] as const).map((tab2) => (
            <button
              key={tab2}
              onClick={() => setTab(tab2)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition ${
                tab === tab2
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(tab2)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {tab === "summary" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Crime type")} value={t("Theft (Motor vehicle)")} />
                <Field label={t("Date")} value={t("14 Aug 2024")} />
                <Field label={t("Status")} value={t("Under investigation")} status="warning" />
                <Field label={t("Station")} value={t("Whitefield PS")} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("IPC sections")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {["379", "411", "34"].map((s) => (
                    <span key={s} className="rounded-md bg-accent px-2 py-1 text-xs font-mono font-semibold text-accent-foreground">
                      § {s}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Complainant")}</div>
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <Lock className="h-4 w-4 text-warning" />
                  <span className="font-mono text-foreground/70">●●●●●●●● ●. ●●●●●●</span>
                  <span className="ml-auto text-[11px] text-warning-foreground/80">{t("Masked — authorized roles only")}</span>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Narrative")}</div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {t("Vehicle reported missing from parking lot near ITPL Main Road between 22:30 and 04:00. CCTV footage retrieved. Linked to 2 other theft FIRs in same zone (see Persons tab).")}
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Citations")}</div>
                <div className="space-y-1 text-xs font-mono text-primary">
                  <div>↳ fir_records.row_id = 88421</div>
                  <div>↳ cctv_evidence.case_ref = FIR-2024-08842</div>
                </div>
              </div>
            </>
          )}

          {tab === "persons" && (
            <div className="space-y-2">
              {[
                { role: "Accused", name: "●●●●●●●●", masked: true, status: "denied" },
                { role: "Accused", name: "S. Manjunath", masked: false, status: "allowed" },
                { role: "Victim", name: "●●●●●●●●", masked: true, status: "denied" },
                { role: "Witness", name: "P. Rao", masked: false, status: "allowed" },
              ].map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${
                      p.role === "Accused" ? "bg-destructive/15 text-destructive" :
                      p.role === "Victim" ? "bg-warning/20 text-warning-foreground" :
                      "bg-success/15 text-success"
                    }`}>
                      {(p.role ?? "?")[0]}
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${p.masked ? "font-mono text-foreground/60" : "text-foreground"}`}>
                        {p.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t(p.role ?? "")}</div>
                    </div>
                  </div>
                  {p.masked && <Lock className="h-4 w-4 text-warning" />}
                </div>
              ))}
            </div>
          )}

          {tab === "map" && (
            <div className="space-y-3">
              <div className="aspect-video rounded-lg border border-border bg-[linear-gradient(135deg,#e2e8f0_25%,transparent_25%),linear-gradient(225deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(315deg,#e2e8f0_25%,#f8fafc_25%)] bg-[length:20px_20px] relative grid place-items-center">
                <div className="flex flex-col items-center gap-1">
                  <MapPin className="h-8 w-8 text-destructive drop-shadow" />
                  <span className="rounded bg-card px-2 py-0.5 text-[11px] font-medium shadow">{t("Incident location")}</span>
                </div>
              </div>
              <div className="text-sm text-foreground/80">
                <div className="font-medium">{t("ITPL Main Road, Whitefield")}</div>
                <div className="text-xs text-muted-foreground">12.9849° N, 77.7370° E · Bengaluru Urban</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition">
            <Plus className="h-4 w-4" /> {t("Add to report")}
          </button>
          <button className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition">
            <FileDown className="h-4 w-4" /> {t("Export")}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, status }: { label: string; value: string; status?: "warning" | "success" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${
        status === "warning" ? "text-warning-foreground" : status === "success" ? "text-success" : "text-foreground"
      }`}>{value}</div>
    </div>
  );
}
