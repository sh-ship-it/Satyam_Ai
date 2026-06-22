import { useState } from "react";
import { intelligence, type SimilarCasesResponse } from "@/lib/api/intelligence";
import { Search, Loader2, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";

interface Props {
  onOpenCase?: (caseId: number) => void;
}

export function SimilarCaseSearch({ onOpenCase }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SimilarCasesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setRes(await intelligence.searchSimilarCases(q.trim(), 8));
    } catch {
      setError("Search failed. Check clearance and that the API is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-foreground flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        {t("Find similar cases by description")}
      </h3>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder={t("e.g. chain snatching near bus stand at night")}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={run}
          disabled={loading || !q.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? t("Searching…") : t("Search")}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {res && res.matches.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          {t("No similar cases found.")}
        </p>
      )}

      {res && res.matches.length > 0 && (
        <ul className="space-y-2">
          {res.matches.map((m) => (
            <li
              key={m.case_id}
              className={`rounded-xl border border-border bg-muted/20 p-3 transition hover:bg-muted/40 ${onOpenCase ? "cursor-pointer" : ""}`}
              onClick={() => onOpenCase?.(m.case_id)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-foreground font-mono">
                  {m.fir_number ?? `Case #${m.case_id}`}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    m.similarity_percent >= 80
                      ? "bg-primary/20 text-primary"
                      : m.similarity_percent >= 60
                        ? "bg-orange-500/20 text-orange-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {m.similarity_percent}% match
                </span>
              </div>
              <div className="text-xs text-muted-foreground mb-1.5">
                {m.crime_type} · {m.district}
              </div>
              {m.why_similar.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.why_similar.map((w, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
