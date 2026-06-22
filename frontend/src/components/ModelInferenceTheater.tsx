import { useEffect, useMemo, useRef, useState } from "react";
import { Radar, Cpu, Activity, Database, Zap } from "lucide-react";
import type { ForecastCell, BacktestResponse } from "@/lib/api/intelligence";

// Risk-tier colours for the dark sensor viewport (fixed on purpose so a hot zone
// always reads as hot, independent of the active corporate theme).
const RISK_HEX: Record<string, string> = {
  Critical: "#FF4D50",
  High: "#FB923C",
  Medium: "#FACC00",
  Low: "#00C896",
};

function levelOf(c: ForecastCell): "Critical" | "High" | "Medium" | "Low" {
  const l = (c.risk_level || "").toLowerCase();
  if (l.startsWith("crit")) return "Critical";
  if (l.startsWith("high")) return "High";
  if (l.startsWith("med")) return "Medium";
  if (l.startsWith("low")) return "Low";
  const s = c.risk_score || 0;
  return s >= 75 ? "Critical" : s >= 55 ? "High" : s >= 30 ? "Medium" : "Low";
}

// Smooth count-up so the metrics feel "live".
function useCountUp(target: number, dur = 850) {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    let raf = 0;
    const from = ref.current;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(from + (target - from) * eased);
      ref.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

const SWEEP = 3.2; // seconds — scan beam + node ignite + bloom share this period
const FLOW = 2.4; // seconds — pipeline packet + checkpoint pulse share this period

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
  // Top cells, geo-projected into a normalised 0..1 field
  // (grid fallback when the cells have no spatial spread).
  const nodes = useMemo(() => {
    const top = [...cells].sort((a, b) => b.risk_score - a.risk_score).slice(0, 60);
    if (top.length === 0) return [];
    const lats = top.map((c) => c.lat);
    const lngs = top.map((c) => c.lng);
    const minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat,
      lngSpan = maxLng - minLng;
    const geo = latSpan > 1e-6 && lngSpan > 1e-6;
    const cols = Math.ceil(Math.sqrt(top.length));
    const rows = Math.ceil(top.length / cols);
    const pad = 0.07;
    const span = 1 - pad * 2;
    return top.map((c, i) => {
      let x: number, y: number;
      if (geo) {
        x = pad + ((c.lng - minLng) / lngSpan) * span;
        y = pad + (1 - (c.lat - minLat) / latSpan) * span;
      } else {
        const r = Math.floor(i / cols),
          cc = i % cols;
        x = pad + (cols <= 1 ? 0.5 : cc / (cols - 1)) * span;
        y = pad + (rows <= 1 ? 0.5 : r / (rows - 1)) * span;
      }
      return { ...c, x, y, level: levelOf(c) };
    });
  }, [cells]);

  const maxRisk = nodes.length ? Math.max(...nodes.map((n) => n.risk_score || 0), 1) : 1;
  const highCount = useMemo(
    () => nodes.filter((n) => n.level === "Critical" || n.level === "High").length,
    [nodes],
  );
  const pai = backtest ? Math.round(backtest.hit_rate_top_10_percent_cells * 100) : null;

  const scoredUp = useCountUp(nodes.length);
  const highUp = useCountUp(highCount);
  const paiUp = useCountUp(pai ?? 0);

  // Live "scoring" ticker cycling through the real cells.
  const [tickIdx, setTickIdx] = useState(0);
  useEffect(() => {
    if (loading || nodes.length === 0) return;
    const id = setInterval(() => setTickIdx((i) => i + 1), 1150);
    return () => clearInterval(id);
  }, [loading, nodes.length]);
  const ticker = nodes.length ? nodes[tickIdx % nodes.length] : null;

  const [hover, setHover] = useState<number | null>(null);

  const stages = [
    { key: "fir", label: t("FIR intake"), icon: Database },
    { key: "feat", label: t("Features"), icon: Activity },
    { key: "model", label: t("Risk model"), icon: Cpu },
    { key: "surface", label: t("Risk surface"), icon: Radar },
  ];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <style>{STYLE_BLOCK}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-70 mit-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" /> {t("Neural forecast engine")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {loading ? t("Acquiring signal…") : t("Live inference")}
              {asOf ? ` · ${asOf}` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Metric label={t("Cells scored")} value={scoredUp} />
          <Metric label={t("High risk")} value={highUp} tone="warn" />
          {pai !== null && <Metric label={t("PAI")} value={`${paiUp}%`} tone="ok" />}
        </div>
      </div>

      {/* ── Inference signal-flow rail ──────────────────────────────────── */}
      <div className="relative px-6 pt-3 pb-6 border-b border-border bg-muted/20">
        <div className="relative h-7">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 mit-track" />
          {!loading && (
            <div
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary mit-packet"
              style={{ boxShadow: "0 0 10px 2px var(--main)" }}
            />
          )}
          {stages.map((s, i) => {
            const pos = stages.length === 1 ? 0.5 : i / (stages.length - 1);
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
                style={{ left: `${pos * 100}%` }}
              >
                <div
                  className="mit-cp grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-primary"
                  style={{ animationDelay: `${-(pos * FLOW)}s` }}
                >
                  <Icon className="h-3 w-3" />
                </div>
                <span className="absolute top-7 whitespace-nowrap text-[9px] font-medium text-muted-foreground">
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Live threat surface (dark sensor viewport) ──────────────────── */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          height: 300,
          background: "radial-gradient(120% 120% at 50% 0%, #122036 0%, #0a1120 60%, #070c16 100%)",
        }}
      >
        <div className="absolute inset-0 mit-grid" />
        {!loading && nodes.length > 0 && <div className="absolute top-0 bottom-0 w-24 mit-scan" />}

        <div className="absolute left-3 top-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300/70">
          <Radar className="h-3.5 w-3.5 mit-spin" /> {t("Live threat surface")}
        </div>
        <div className="absolute right-3 top-2.5 font-mono text-[10px] text-cyan-300/60">
          {nodes.length} {t("cells")}
        </div>

        {nodes.map((n, i) => {
          const hex = RISK_HEX[n.level];
          const size = 12 + (n.risk_score / maxRisk) * 24;
          const delay = `${-(n.x * SWEEP)}s`;
          return (
            <div
              key={n.cell_id || i}
              className="absolute"
              style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
            >
              {/* bloom ring */}
              <div
                className="mit-bloom absolute rounded-full"
                style={{
                  width: size * 1.5,
                  height: size * 1.5,
                  left: 0,
                  top: 0,
                  border: `1.5px solid ${hex}`,
                  animationDelay: delay,
                }}
              />
              {/* node dot */}
              <div
                className="mit-node absolute rounded-full cursor-pointer"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                style={{
                  width: size,
                  height: size,
                  left: 0,
                  top: 0,
                  backgroundColor: hex,
                  boxShadow: `0 0 ${size * 0.7}px ${hex}, 0 0 4px ${hex}`,
                  animationDelay: delay,
                }}
              />
            </div>
          );
        })}

        {/* Hover tooltip */}
        {hover !== null && nodes[hover] && (
          <div
            className="pointer-events-none absolute z-10 w-52 rounded-lg border border-white/15 bg-[#0c1426]/95 p-2.5 shadow-xl backdrop-blur"
            style={{
              left: `${Math.min(82, Math.max(2, nodes[hover].x * 100))}%`,
              top: `${nodes[hover].y * 100}%`,
              transform: "translate(-50%, calc(-100% - 16px))",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-white truncate">
                {nodes[hover].crime_type}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-extrabold"
                style={{ backgroundColor: RISK_HEX[nodes[hover].level], color: "#0a0a0a" }}
              >
                {nodes[hover].risk_level}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-white/50">{t("Risk")}</span>
              <span className="font-mono text-[11px] font-bold text-cyan-300">
                {Math.round(nodes[hover].risk_score)}
              </span>
              <span className="text-[9px] text-white/40 truncate">· {nodes[hover].cell_id}</span>
            </div>
            {nodes[hover].why?.[0] && (
              <div className="mt-1 text-[9px] leading-snug text-white/60">
                {nodes[hover].why[0]}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-cyan-300/80">
              <Radar className="h-7 w-7 mit-spin" />
              <span className="text-xs font-medium">{t("Acquiring signal…")}</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="text-xs text-white/50">
              {t("No grid cells for the current filters.")}
            </span>
          </div>
        )}

        {/* Risk legend */}
        <div className="absolute bottom-2.5 left-3 flex items-center gap-2.5">
          {(["Critical", "High", "Medium", "Low"] as const).map((lv) => (
            <span key={lv} className="flex items-center gap-1 text-[9px] font-medium text-white/70">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: RISK_HEX[lv], boxShadow: `0 0 6px ${RISK_HEX[lv]}` }}
              />
              {t(lv)}
            </span>
          ))}
        </div>
      </div>

      {/* ── Footer: live scoring ticker + backtest PAI ──────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-border bg-muted/20">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success mit-ping" />
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {ticker
              ? `▸ ${t("scored")} ${ticker.cell_id} · ${ticker.crime_type} · ${t("risk")} ${Math.round(ticker.risk_score)} · ${ticker.risk_level.toUpperCase()}`
              : t("Standing by…")}
          </span>
        </div>
        {pai !== null && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{t("Backtest PAI")}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${Math.min(100, paiUp)}%` }}
              />
            </div>
            <span className="text-[11px] font-extrabold text-success tabular-nums">{paiUp}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Metric pill ───────────────────────────────────────────────────────────────
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn" | "ok";
}) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-primary";
  return (
    <div className="flex flex-col items-end rounded-lg border border-border bg-muted/30 px-2.5 py-1 leading-tight">
      <span className={`text-sm font-extrabold tabular-nums ${color}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

// ── CSS keyframes (injected once via <style>) ────────────────────────────────
const STYLE_BLOCK = `
.mit-ping{ animation: mit-ping 1.6s cubic-bezier(0,0,.2,1) infinite; }
@keyframes mit-ping{ 75%,100%{ transform: scale(2.2); opacity: 0; } }
.mit-spin{ animation: mit-spin 4s linear infinite; }
@keyframes mit-spin{ to{ transform: rotate(360deg); } }
.mit-grid{
  background-image:
    linear-gradient(rgba(120,180,255,.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120,180,255,.08) 1px, transparent 1px);
  background-size: 34px 34px;
}
.mit-scan{
  background: linear-gradient(90deg, transparent, rgba(94,234,212,.05), rgba(94,234,212,.18));
  border-right: 1.5px solid rgba(94,234,212,.55);
  box-shadow: 0 0 24px 4px rgba(94,234,212,.22);
  animation: mit-scan 3.2s linear infinite;
}
@keyframes mit-scan{
  0%{ left:-12%; opacity:0; }
  6%{ opacity:1; }
  94%{ opacity:1; }
  100%{ left:104%; opacity:0; }
}
.mit-node{
  transform: translate(-50%,-50%);
  animation: mit-ignite 3.2s linear infinite;
  will-change: transform, filter;
}
@keyframes mit-ignite{
  0%{ transform: translate(-50%,-50%) scale(1.9); filter: brightness(2.1); }
  13%{ transform: translate(-50%,-50%) scale(1); filter: brightness(1); }
  100%{ transform: translate(-50%,-50%) scale(1); filter: brightness(1); }
}
.mit-bloom{
  transform: translate(-50%,-50%);
  opacity: 0;
  animation: mit-bloom 3.2s linear infinite;
}
@keyframes mit-bloom{
  0%{ transform: translate(-50%,-50%) scale(.35); opacity:.75; }
  40%{ transform: translate(-50%,-50%) scale(2.6); opacity:0; }
  100%{ opacity:0; }
}
.mit-track{
  background: linear-gradient(90deg, transparent, var(--main), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: mit-track 2.4s linear infinite;
}
@keyframes mit-track{
  0%{ background-position: -40% 0; }
  100%{ background-position: 140% 0; }
}
.mit-packet{ animation: mit-packet 2.4s linear infinite; }
@keyframes mit-packet{
  0%{ left:-2%; opacity:0; }
  8%{ opacity:1; }
  92%{ opacity:1; }
  100%{ left:102%; opacity:0; }
}
.mit-cp{ animation: mit-cp 2.4s ease-out infinite; }
@keyframes mit-cp{
  0%{
    transform: scale(1.5);
    box-shadow: 0 0 0 5px rgba(145,197,253,.45);
    border-color: var(--main);
  }
  18%{ transform: scale(1); box-shadow: 0 0 0 0 rgba(145,197,253,0); }
  100%{ transform: scale(1); }
}
@media (prefers-reduced-motion: reduce){
  .mit-ping,.mit-spin,.mit-scan,.mit-node,.mit-bloom,.mit-track,.mit-packet,.mit-cp{
    animation: none !important;
  }
  .mit-node,.mit-bloom{ transform: translate(-50%,-50%); }
  .mit-bloom{ opacity: 0; }
}
`;
