# Satyam — “Incident Trend” Visualization Redesign

**Screen:** Trends & Patterns → *Time Series* tab → **Incident Trend** card
**File:** `frontend/src/routes/trends.tsx`
**What changed:** the old `TrendChart` rendered `flex-1` bars with `height: %`. With a single period it stretched into one giant full-width red/blue block (exactly the screenshot). Replaced with a proper **area + line trend chart** and a dedicated **single-period spotlight** so one data point looks intentional, not broken.

---

## Why this design

| Problem (old) | Fix (new) |
|---|---|
| 1 period → full-width solid block | **Spotlight mode**: big count-up number + “Peak period” pill + proportion bar |
| Flat bars, no trend readability | **Smooth area + line** with gradient fill that animates in (`stroke-dashoffset` draw) |
| No peak emphasis | **Peak marker** dot (red, pulsing ring) with inline value label |
| No values without hovering each bar | **Hover guide + tooltip** (period + incidents) and y-axis gridlines |
| Off-brand colors | Uses theme tokens (`--main`, `destructive`, `muted`, `card`, `border`) |

**No new dependencies** — pure SVG + CSS keyframes. Respects `prefers-reduced-motion`.

---

## How to apply (2 edits)

### 1. Replace the entire `TrendChart` function
In `frontend/src/routes/trends.tsx`, replace the old `function TrendChart({ series }: { series: TrendPoint[] }) { ... }` (the bars version) with the code below. It also defines a `TREND_STYLE` constant — keep it right after the function.

### 2. Update the call site
The component now takes a `t` prop for i18n (EN/Kannada). In the Time Series tab, change:
```tsx
<TrendChart series={series} />
```
to:
```tsx
<TrendChart series={series} t={t} />
```
(`t` is already in scope via `const t = useT();`.)

> Bonus: also aligned `DeltaCard`’s down-trend color from off-brand `text-emerald-500` → `text-success` for brand consistency.

---

## Full code — replace `TrendChart` with this

```tsx
function TrendChart({ series, t }: { series: TrendPoint[]; t: (s: string) => string }) {
  const byPeriod = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => { m[s.period] = (m[s.period] || 0) + s.count; });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [series]);

  const [hover, setHover] = useState<number | null>(null);

  if (byPeriod.length === 0)
    return <div className="text-xs text-muted-foreground text-center py-10">{t("No trend data")}</div>;

  const max = Math.max(1, ...byPeriod.map(([, v]) => v));
  const peakIdx = byPeriod.reduce((b, [, v], i, a) => (v > a[b][1] ? i : b), 0);
  const fmt = (p: string) => (p.length > 7 ? p.slice(2) : p);

  // ── Single period → spotlight (no degenerate full-width block) ──
  if (byPeriod.length === 1) {
    const [period, v] = byPeriod[0];
    return (
      <div className="relative flex h-56 flex-col items-center justify-center gap-3">
        <style>{TREND_STYLE}</style>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{fmt(period)}</span>
        <div className="flex items-end gap-2 tc-fade">
          <span className="text-6xl font-extrabold leading-none tabular-nums text-primary">{v}</span>
          <span className="mb-1.5 text-xs text-muted-foreground">{t("incidents")}</span>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-[10px] font-bold text-destructive">
          <TrendingUp className="h-3 w-3" /> {t("Peak period")}
        </span>
        <div className="mt-1 w-full max-w-md px-2">
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="tc-grow h-full rounded-full bg-gradient-to-r from-primary/60 to-primary" />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
            <span>0</span>
            <span>{t("max")} {max}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Multi period → smooth area + line chart ──
  const n = byPeriod.length;
  const TOP = 16, BOT = 84, PADX = 4;
  const pts = byPeriod.map(([, v], i) => ({
    x: PADX + (i / (n - 1)) * (100 - 2 * PADX),
    y: BOT - (v / max) * (BOT - TOP),
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${pts[0].x.toFixed(2)},${BOT} ${line} ${pts[n - 1].x.toFixed(2)},${BOT}`;
  const showLabel = (i: number) => n <= 10 || i === 0 || i === n - 1 || i === peakIdx;

  return (
    <div className="relative h-56 w-full">
      <style>{TREND_STYLE}</style>

      {/* gridlines + y scale */}
      {[0, 0.5, 1].map((g) => (
        <div
          key={g}
          className="absolute left-0 right-0 border-t border-dashed border-border/60"
          style={{ top: `${TOP + (1 - g) * (BOT - TOP)}%` }}
        >
          <span className="absolute -top-1.5 left-0 bg-card pr-1 text-[8px] tabular-nums text-muted-foreground">
            {Math.round(max * g)}
          </span>
        </div>
      ))}

      {/* area + line */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="tc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--main)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--main)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon className="tc-area" points={area} fill="url(#tc-fill)" />
        <polyline
          className="tc-line"
          points={line}
          fill="none"
          stroke="var(--main)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
        />
      </svg>

      {/* dots + peak marker */}
      {pts.map((p, i) => {
        const isPeak = i === peakIdx;
        const [period, v] = byPeriod[i];
        return (
          <div
            key={period}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {isPeak && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-destructive px-1.5 py-0.5 text-[8px] font-bold text-white">
                ▲ {v}
              </span>
            )}
            <div
              className={`tc-dot rounded-full ${isPeak ? "tc-peak h-3 w-3 bg-destructive ring-2 ring-destructive/30" : "h-2 w-2 bg-primary"}`}
            />
          </div>
        );
      })}

      {/* x-axis labels */}
      {pts.map((p, i) =>
        showLabel(i) ? (
          <div
            key={`l${i}`}
            className="absolute -translate-x-1/2 whitespace-nowrap text-[8px] text-muted-foreground"
            style={{ left: `${p.x}%`, top: "90%" }}
            title={byPeriod[i][0]}
          >
            {fmt(byPeriod[i][0])}
          </div>
        ) : null,
      )}

      {/* hover capture + tooltip */}
      <div className="absolute top-0 flex" style={{ left: `${PADX}%`, right: `${PADX}%`, height: `${BOT}%` }}>
        {byPeriod.map(([period], i) => (
          <div
            key={period}
            className="flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-[10px] shadow-md"
          style={{ left: `${pts[hover].x}%`, top: `${pts[hover].y}%` }}
        >
          <div className="font-bold text-foreground">
            {byPeriod[hover][1]} {t("incidents")}
          </div>
          <div className="text-muted-foreground">{byPeriod[hover][0]}</div>
        </div>
      )}
    </div>
  );
}

const TREND_STYLE = `
.tc-fade{ animation: tc-fade .7s ease-out both; }
@keyframes tc-fade{ from{ opacity:0; transform: translateY(6px); } to{ opacity:1; transform:none; } }
.tc-grow{ transform-origin:left; animation: tc-grow 1s ease-out both; }
@keyframes tc-grow{ from{ transform: scaleX(0); } to{ transform: scaleX(1); } }
.tc-area{ animation: tc-fade .9s ease-out both; }
.tc-line{ stroke-dasharray:1; animation: tc-draw 1.1s ease-out forwards; }
@keyframes tc-draw{ from{ stroke-dashoffset:1; } to{ stroke-dashoffset:0; } }
.tc-dot{ animation: tc-pop .45s ease-out both; }
@keyframes tc-pop{ from{ transform: scale(0); } to{ transform: scale(1); } }
.tc-peak{ animation: tc-peak 2s ease-in-out infinite; }
@keyframes tc-peak{ 0%,100%{ box-shadow: 0 0 0 0 rgba(255,77,80,.5); } 50%{ box-shadow: 0 0 0 7px rgba(255,77,80,0); } }
@media (prefers-reduced-motion: reduce){
  .tc-fade,.tc-grow,.tc-area,.tc-line,.tc-dot,.tc-peak{ animation: none !important; }
  .tc-grow{ transform: scaleX(1); }
  .tc-line{ stroke-dashoffset: 0; }
}
`;
```

---

## Verification (static, sandbox)

- Braces / parens / brackets balanced; backticks even.
- `<div>` tags balanced (70 open / 70 close), `<svg>` 2/2, `<polygon>` + `<polyline>` present.
- 13/13 inline `style` objects parse as valid JS.
- Call site updated to pass `t`; old bars block removed.
- No off-brand colors remain (emerald/indigo cleared).

> Note: no `node_modules` in this sandbox, so a live `npm run build` was not run — checks are static analysis. Drop-in: same export, only the call site gains `t`.
