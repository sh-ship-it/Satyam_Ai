import { useEffect, useState } from "react";
import { Database, Cpu, CheckCircle2 } from "lucide-react";
import type { ForecastCell, BacktestResponse } from "@/lib/api/intelligence";

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
};

export function ModelInferenceTheater({
  cells,
  backtest,
  loading,
  asOf,
  t,
}: {
  cells: ForecastCell[];
  backtest: BacktestResponse | null;
  loading: boolean;
  asOf: string | null;
  t: (s: string) => string;
}) {
  const stages: Stage[] = [
    { key: "ingest",  label: t("Ingesting FIR signals"),   icon: Database, detail: t("Spatio-temporal events") },
    { key: "feature", label: t("Engineering features"),    icon: Database, detail: t("KDE · recency · seasonality") },
    { key: "infer",   label: t("Running risk model"),      icon: Cpu,      detail: t("Self-exciting hotspot model") },
    { key: "surface", label: t("Projecting risk surface"), icon: Cpu,      detail: t("Grid cell scoring") },
  ];

  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) { setDone(false); setActive(0); return; }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i >= stages.length) { clearInterval(id); setDone(true); setActive(stages.length); }
      else setActive(i);
    }, 420);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cells.length]);

  const pai = backtest ? Math.round(backtest.hit_rate_top_10_percent_cells * 100) : null;
  const top = [...cells].sort((a, b) => b.risk_score - a.risk_score).slice(0, 48);
  const max = top.length ? top[0].risk_score || 1 : 1;

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-xs font-bold text-foreground">{t("Model live inference")}</span>
          {asOf && (
            <span className="text-[10px] text-muted-foreground">
              {t("as of")} {asOf}
            </span>
          )}
        </div>
        {pai !== null && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{t("PAI hit rate")}</span>
            <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{pai}%</span>
          </div>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        {/* Pipeline stepper */}
        <div className="p-4 space-y-2 border-b md:border-b-0 md:border-r border-border/60">
          {stages.map((s, i) => {
            const state = done || i < active ? "done" : i === active ? "running" : "pending";
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all ${
                  state === "running"
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : state === "done"
                    ? "bg-emerald-500/5"
                    : "opacity-40"
                }`}
              >
                <div
                  className={`grid h-8 w-8 place-items-center rounded-lg shrink-0 ${
                    state === "done"
                      ? "bg-emerald-500/15 text-emerald-600"
                      : state === "running"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className={`h-4 w-4 ${state === "running" ? "animate-pulse" : ""}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.detail}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live risk surface grid */}
        <div className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {t("Projected risk surface")}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {top.map((c, i) => {
              const intensity = Math.max(0.08, (c.risk_score || 0) / max);
              return (
                <div
                  key={c.cell_id || i}
                  title={`${c.crime_type} · ${Math.round((c.risk_score || 0))}%`}
                  className="aspect-square rounded-[4px] transition-all duration-500"
                  style={{
                    backgroundColor: `rgba(239, 68, 68, ${intensity})`,
                    transform: done ? "scale(1)" : "scale(0.6)",
                    transitionDelay: `${i * 12}ms`,
                  }}
                />
              );
            })}
            {top.length === 0 && (
              <div className="col-span-8 text-center text-xs text-muted-foreground py-6">
                {t("Awaiting grid…")}
              </div>
            )}
          </div>
          {/* Gradient legend */}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{t("Low")}</span>
            <div
              className="h-2 flex-1 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.08), rgba(239,68,68,1))" }}
            />
            <span>{t("High")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
