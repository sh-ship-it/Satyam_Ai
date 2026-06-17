import { useEffect, useState } from "react";
import { intelligence, type RingsResponse, type RingSummary } from "@/lib/api/intelligence";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Users, Shield, Clock, ChevronRight } from "lucide-react";

function sevColor(score: number): string {
  if (score >= 75) return "bg-destructive text-destructive-foreground";
  if (score >= 50) return "bg-orange-500 text-white";
  if (score >= 25) return "bg-yellow-400 text-foreground";
  return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400";
}

function sevBorder(score: number): string {
  if (score >= 75) return "border-destructive/50";
  if (score >= 50) return "border-orange-400/50";
  if (score >= 25) return "border-yellow-400/50";
  return "border-emerald-400/30";
}

export function RingsPanel({ crimeType, district }: { crimeType?: string; district?: string }) {
  const [data, setData] = useState<RingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    intelligence
      .getNetworkRings(12, crimeType, district)
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setError("Could not load ring detection results. Clearance L2+ required."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [crimeType, district]);

  if (loading) return (
    <div className="flex items-center justify-center gap-3 h-full p-8 text-muted-foreground text-sm">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Detecting organised-crime rings…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 m-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
    </div>
  );

  if (!data || data.rings.length === 0) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full p-8 text-center">
      <Shield className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-semibold text-foreground">No rings detected</p>
        <p className="text-xs text-muted-foreground mt-1">No co-accused groups (≥3 shared cases) detected for the current filter.</p>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pb-2 border-b border-border">
        <Shield className="h-3.5 w-3.5" />
        <span className="font-semibold text-foreground">{data.rings.length} ring{data.rings.length !== 1 ? "s" : ""} detected</span>
        <span>— groups of co-accused appearing together across multiple FIRs</span>
        <span className="ml-auto italic">Investigative leads only — not proof of guilt</span>
      </div>

      {data.rings.map((ring: RingSummary) => (
        <div key={ring.ring_id}
          className={`rounded-xl border bg-card transition-all ${sevBorder(ring.severity_score)}`}>
          {/* Severity bar */}
          <div className={`h-1 rounded-t-xl ${
            ring.severity_score >= 75 ? "bg-destructive" :
            ring.severity_score >= 50 ? "bg-orange-500" :
            ring.severity_score >= 25 ? "bg-yellow-400" : "bg-emerald-500"
          }`} />

          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="font-bold text-sm text-foreground">{ring.label}</h3>
              <div className="flex items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${sevColor(ring.severity_score)}`}>
                  Severity {ring.severity_score}
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {ring.member_count} members
              </span>
              <span className="flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" /> {ring.case_count} shared cases
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> recency {ring.recency_score}
              </span>
            </div>

            {/* Crime type tags */}
            {ring.top_crime_types.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {ring.top_crime_types.map((c) => (
                  <span key={c} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">{c}</span>
                ))}
              </div>
            )}

            {/* Districts */}
            {ring.districts.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {ring.districts.map((d) => (
                  <span key={d} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{d}</span>
                ))}
              </div>
            )}

            {/* Why flagged — expandable */}
            {ring.why_flagged.length > 0 && (
              <button
                onClick={() => setExpanded(prev => prev === ring.ring_id ? null : ring.ring_id)}
                className="text-[11px] text-primary hover:underline flex items-center gap-1 mb-2"
              >
                {expanded === ring.ring_id ? "Hide" : "Why flagged"} ({ring.why_flagged.length})
                <ChevronRight className={`h-3 w-3 transition-transform ${expanded === ring.ring_id ? "rotate-90" : ""}`} />
              </button>
            )}
            {expanded === ring.ring_id && (
              <ul className="space-y-1 mb-3 pl-3 border-l-2 border-primary/30">
                {ring.why_flagged.map((w, i) => (
                  <li key={i} className="text-[11px] text-foreground/80">{w}</li>
                ))}
              </ul>
            )}

            {/* Kingpin link */}
            {ring.kingpin_person_id != null && (
              <button
                onClick={() => navigate({ to: "/profile/$personId", params: { personId: String(ring.kingpin_person_id) } })}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary px-3 py-1.5 text-xs font-semibold hover:bg-primary/20 transition"
              >
                <Users className="h-3.5 w-3.5" />
                View kingpin profile →
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
