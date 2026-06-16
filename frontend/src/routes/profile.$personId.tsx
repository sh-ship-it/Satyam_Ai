import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useState } from "react";
import { Network, Clock, AlertTriangle, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { intelligence, type OffenderProfileResponse, type PersonTimelineEvent } from "@/lib/api/intelligence";

export const Route = createFileRoute("/profile/$personId")({
  head: () => ({ meta: [{ title: "Profile · Satyam" }] }),
  component: ProfileScreen,
});

const RISK_COLORS: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-400 text-foreground",
  Low: "bg-success/20 text-success",
};

function ProfileScreen() {
  const { personId } = Route.useParams();
  const navigate = useNavigate();
  const t = useT();
  const [profile, setProfile] = useState<OffenderProfileResponse | null>(null);
  const [timeline, setTimeline] = useState<PersonTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pid = Number(personId);

  useEffect(() => {
    if (!pid) return;
    setLoading(true);
    Promise.all([
      intelligence.getPersonProfile(pid),
      intelligence.getPersonTimeline(pid),
    ]).then(([p, tl]) => {
      setProfile(p);
      setTimeline(tl.events.slice(0, 20));
      setError(null);
    }).catch(e => setError(e?.status === 403 ? "Insufficient clearance to view this profile." : "Could not load profile."))
      .finally(() => setLoading(false));
  }, [pid]);

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto">
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider opacity-60">PS5 · Offender Profile</div>
            <h1 className="text-xl font-extrabold tracking-tight">{profile?.display_name || `Person #${pid}`}</h1>
          </div>
          <button onClick={() => navigate({ to: "/network", search: { person: pid } as any })}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
            <Network className="h-3.5 w-3.5" /> View Network
          </button>
        </div>

        <div className="flex-1 p-6 space-y-5">
          {loading && <div className="text-muted-foreground text-sm">Loading profile…</div>}
          {error && <div className="rounded-[5px] border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {profile && (
            <>
              {/* Risk gauge */}
              <div className="rounded-[5px] border-2 border-foreground bg-card p-5 nb-shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Risk Score</div>
                    <div className="text-4xl font-extrabold tabular-nums">{profile.risk.score}</div>
                    <span className={`inline-block mt-2 rounded-[5px] px-3 py-1 text-sm font-bold ${RISK_COLORS[profile.risk.label] || "bg-muted"}`}>{profile.risk.label}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {profile.risk.breakdown.map(f => (
                      <div key={f.factor} className="flex items-center gap-2">
                        <span className="w-32 text-xs text-muted-foreground">{f.factor}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden border border-border">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${(f.score / 30) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right text-xs tabular-nums font-bold">{f.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground italic flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />{profile.risk.notice}
                </p>
              </div>

              {/* MO Fingerprint */}
              <div className="rounded-[5px] border-2 border-foreground bg-card p-4 nb-shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide mb-3">MO Fingerprint</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Crime Types", items: profile.mo_fingerprint.top_crime_types },
                    { label: "Sections", items: profile.mo_fingerprint.top_sections },
                    { label: "Motives", items: profile.mo_fingerprint.top_motives },
                    { label: "Time of Day", items: profile.mo_fingerprint.time_of_day ? [profile.mo_fingerprint.time_of_day] : [] },
                  ].map(g => (
                    <div key={g.label}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{g.label}</div>
                      <div className="flex flex-wrap gap-1">
                        {g.items.map(i => <span key={i} className="rounded-[3px] bg-muted px-2 py-0.5 text-xs font-medium">{i}</span>)}
                        {g.items.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ring membership */}
              {profile.ring_membership && (
                <div className="flex items-center gap-3 rounded-[5px] border-2 border-orange-400 bg-orange-50 dark:bg-orange-950 p-3">
                  <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-orange-700 dark:text-orange-300">{profile.ring_membership.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">· {profile.ring_membership.ring_id}</span>
                  </div>
                </div>
              )}

              {/* Associates */}
              {profile.known_associates.length > 0 && (
                <div className="rounded-[5px] border-2 border-foreground bg-card p-4 nb-shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-wide mb-3">Known Associates</div>
                  <div className="space-y-1.5">
                    {profile.known_associates.map(a => (
                      <div key={a.person_id} className="flex items-center justify-between hover:bg-muted/30 rounded-[3px] px-2 py-1 cursor-pointer"
                        onClick={() => navigate({ to: "/profile/$personId", params: { personId: String(a.person_id) } })}>
                        <span className="text-xs font-medium">Person #{a.person_id}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{a.shared_case_count} shared cases</span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {timeline.length > 0 && (
                <div className="rounded-[5px] border-2 border-foreground bg-card p-4 nb-shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide mb-3">
                    <Clock className="h-4 w-4" /> Crime History Timeline
                  </div>
                  <div className="space-y-2">
                    {timeline.map((e, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-20 text-[10px] text-muted-foreground shrink-0 mt-0.5">{e.date?.slice(0, 10) || "—"}</div>
                        <div className="flex-1 border-l-2 border-border pl-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] rounded-[3px] bg-muted px-1.5 py-0.5 font-medium">{e.role}</span>
                            <span className="text-xs font-medium">{e.crime_type || "Unknown"}</span>
                          </div>
                          {e.status && <div className="text-[10px] text-muted-foreground mt-0.5">{e.status}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
