import { X, Lock, FileDown, Plus, Clock, Sparkles, Network } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { api } from "@/lib/api/client";
import { intelligence, type SimilarCaseMatch, type TimelineEvent } from "@/lib/api/intelligence";

export function CaseDrawer({
  open, onClose, caseId,
}: { open: boolean; onClose: () => void; caseId?: number | string }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"summary" | "persons" | "similar" | "timeline" | "map">("summary");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [similar, setSimilar] = useState<SimilarCaseMatch[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    if (!open || caseId == null) return;
    let active = true;
    setLoading(true);
    setData(null);
    api.caseById(String(caseId), lang === "KN" ? "kn" : "en")
      .then((d: any) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, caseId]);

  // Load similar cases + timeline lazily when tab selected
  useEffect(() => {
    if (!open || caseId == null) return;
    const id = Number(caseId);
    if (isNaN(id)) return;
    if (tab === "similar" && similar.length === 0) {
      setSimilarLoading(true);
      intelligence.getSimilarCases(id).then(r => setSimilar(r.matches)).catch(() => {}).finally(() => setSimilarLoading(false));
    }
    if (tab === "timeline" && timeline.length === 0) {
      setTimelineLoading(true);
      intelligence.getCaseTimeline(id).then(r => setTimeline(r.events)).catch(() => {}).finally(() => setTimelineLoading(false));
    }
  }, [tab, open, caseId]);

  useEffect(() => {
    if (open) { setTab("summary"); setSimilar([]); setTimeline([]); }
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
          <div className="flex items-center gap-2">
            <button onClick={() => caseId && navigate({ to: "/network", search: { case: Number(caseId) } as any })}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-1">
              <Network className="h-3 w-3" /> Network
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex gap-0.5 border-b border-border bg-muted/40 px-3 overflow-x-auto">
          {(["summary", "persons", "timeline", "similar", "map"] as const).map((tb) => (
            <button key={tb} onClick={() => setTab(tb)}
              className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap capitalize border-b-2 transition ${
                tab === tb ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {tb === "similar" ? "Similar Cases" : tb === "timeline" ? "Timeline" : t(tb)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {loading && <div className="text-sm text-muted-foreground">{t("Loading…")}</div>}
          {!loading && !data && caseId != null && <div className="text-sm text-muted-foreground">{t("Could not load case data.")}</div>}

          {!loading && data && tab === "summary" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Crime type")} value={tData("crime_type", data.crime_type, lang)} />
                <Field label={t("Date")} value={data.report_date} />
                <Field label={t("Status")} value={tData("status", data.status, lang)} status="warning" />
                <Field label={t("Station")} value={data.station_name ?? "—"} />
                <Field label={t("District")} value={tData("district", data.district, lang)} />
                <Field label={t("Legal code")} value={data.legal_code} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Sections")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {String(data.sections ?? "").split("|").filter(Boolean).map((s: string) => (
                    <span key={s} className="rounded-md bg-accent px-2 py-1 text-xs font-mono font-semibold text-accent-foreground">§ {s}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Narrative")}</div>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{data.narrative ?? "—"}</p>
              </div>
              {data.masked && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <Lock className="h-4 w-4 text-warning" />{t("Some fields masked for your clearance level.")}
                </div>
              )}
            </>
          )}

          {!loading && data && tab === "persons" && (
            <div className="space-y-2">
              {persons.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                  <div>
                    <div className={`text-sm font-medium ${p.masked ? "font-mono text-foreground/60" : "text-foreground"}`}>{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{tData("role", p.role ?? "", lang)}{p.age ? ` · ${p.age}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.masked && <Lock className="h-4 w-4 text-warning" />}
                    {p.person_id && (
                      <button onClick={() => navigate({ to: "/profile/$personId", params: { personId: String(p.person_id) } })}
                        className="text-[10px] text-primary hover:underline">Profile</button>
                    )}
                  </div>
                </div>
              ))}
              {persons.length === 0 && <div className="text-sm text-muted-foreground">{t("No person records.")}</div>}
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-2">
              {timelineLoading && <div className="text-sm text-muted-foreground">Loading timeline…</div>}
              {timeline.map((e, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-20 text-[10px] text-muted-foreground shrink-0 mt-1">{e.date?.slice(0, 10) || "—"}</div>
                  <div className="flex-1 border-l-2 border-border pl-3 pb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium">{e.title}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{e.type}</div>
                  </div>
                </div>
              ))}
              {!timelineLoading && timeline.length === 0 && <div className="text-sm text-muted-foreground">No timeline events found.</div>}
            </div>
          )}

          {tab === "similar" && (
            <div className="space-y-3">
              {similarLoading && <div className="text-sm text-muted-foreground">Finding similar cases…</div>}
              {similar.map(m => (
                <div key={m.case_id} className="rounded-[5px] border-2 border-foreground bg-card p-3 nb-shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <span className="text-xs font-bold">{m.fir_number || `Case #${m.case_id}`}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{m.crime_type}</span>
                    </div>
                    <span className="text-xs font-bold text-primary">{m.similarity_percent}% match</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-1.5">{m.district}</div>
                  <div className="flex flex-wrap gap-1">
                    {m.why_similar.map(w => <span key={w} className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[10px]">{w}</span>)}
                  </div>
                </div>
              ))}
              {!similarLoading && similar.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />No similar cases found.
                </div>
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
