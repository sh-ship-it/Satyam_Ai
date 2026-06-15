import { X, Lock, FileDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";

export function CaseDrawer({
  open, onClose, caseId,
}: { open: boolean; onClose: () => void; caseId?: number | string }) {
  const t = useT();
  const [tab, setTab] = useState<"summary" | "persons" | "map">("summary");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || caseId == null) return;
    let active = true;
    setLoading(true);
    setData(null);
    api.caseById(String(caseId))
      .then((d: any) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, caseId]);

  // Reset tab when opening a new case
  useEffect(() => {
    if (open) setTab("summary");
  }, [open, caseId]);

  if (!open) return null;
  const persons: any[] = data?.persons ?? [];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-card shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Case")}</div>
            <h2 className="text-lg font-semibold text-foreground">
              {data?.fir_number ?? (loading ? t("Loading…") : "—")}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border bg-muted/40 px-3">
          {(["summary", "persons", "map"] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition ${
                tab === tb ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(tb)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {loading && <div className="text-sm text-muted-foreground">{t("Loading…")}</div>}

          {!loading && !data && caseId != null && (
            <div className="text-sm text-muted-foreground">{t("Could not load case data.")}</div>
          )}

          {!loading && data && tab === "summary" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Crime type")} value={data.crime_type} />
                <Field label={t("Date")} value={data.report_date} />
                <Field label={t("Status")} value={data.status} status="warning" />
                <Field label={t("Station")} value={data.station_name ?? "—"} />
                <Field label={t("District")} value={data.district} />
                <Field label={t("Legal code")} value={data.legal_code} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Sections")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {String(data.sections ?? "").split("|").filter(Boolean).map((s: string) => (
                    <span key={s} className="rounded-md bg-accent px-2 py-1 text-xs font-mono font-semibold text-accent-foreground">
                      § {s}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Narrative")}</div>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {data.narrative ?? "—"}
                </p>
              </div>
              {data.masked && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <Lock className="h-4 w-4 text-warning" />
                  {t("Some fields masked for your clearance level.")}
                </div>
              )}
            </>
          )}

          {!loading && data && tab === "persons" && (
            <div className="space-y-2">
              {persons.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                  <div>
                    <div className={`text-sm font-medium ${p.masked ? "font-mono text-foreground/60" : "text-foreground"}`}>
                      {p.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t(p.role ?? "")}{p.age ? ` · ${p.age}` : ""}
                    </div>
                  </div>
                  {p.masked && <Lock className="h-4 w-4 text-warning" />}
                </div>
              ))}
              {persons.length === 0 && (
                <div className="text-sm text-muted-foreground">{t("No person records.")}</div>
              )}
            </div>
          )}

          {!loading && data && tab === "map" && (
            <div className="text-sm text-foreground/80">
              <div className="font-medium">{data.place_of_offence ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {data.latitude != null && data.longitude != null
                  ? `${data.latitude}° N, ${data.longitude}° E`
                  : t("Coordinates unavailable")} · {data.district}
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

function Field({ label, value, status }: { label: string; value?: string; status?: "warning" | "success" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${
        status === "warning" ? "text-warning-foreground" : status === "success" ? "text-success" : "text-foreground"
      }`}>{value ?? "—"}</div>
    </div>
  );
}
