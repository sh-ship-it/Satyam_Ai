import { useEffect, useRef, useState } from "react";
import { AlertTriangle, DollarSign, TrendingUp, Shield } from "lucide-react";
import { ForceGraph, fitLinkDistance, ringLayout } from "@/lib/forceGraph";
import { financial, type MoneyTrailResponse, type MoneyNode } from "@/lib/api/financial";
import { useI18n, useT } from "@/lib/i18n";
import { tData } from "@/lib/tData";

const FLAG_COLOR: Record<string, string> = {
  high_value: "#dc2626",
  near_incident_date: "#ea580c",
  rapid_repeated: "#d97706",
  circular_flow: "#7c3aed",
};

/** Marker id suffix -> fill. Keyed by pattern flag, plus `plain` for unflagged
 *  edges, so every edge can point to a marker that matches its own stroke. */
const ARROW_COLORS: [string, string][] = [
  ["plain", "#94a3b8"],
  ...Object.entries(FLAG_COLOR),
];

function arrowKey(flag: string | null): string {
  return flag && FLAG_COLOR[flag] ? flag : "plain";
}

const FLAG_LABEL: Record<string, string> = {
  high_value: "High Value",
  near_incident_date: "Near Incident",
  rapid_repeated: "Rapid Repeated",
  circular_flow: "Circular Flow",
};

/** [highlight, base] per node kind, for the radial-gradient bodies. Matches the
 *  People graph's treatment so the two tabs look like one product. */
const NODE_TINT: Record<string, [string, string]> = {
  seed: ["#60a5fa", "#2563eb"],
  high: ["#f87171", "#dc2626"],
  medium: ["#fbbf24", "#d97706"],
  normal: ["#67e8f9", "#0ea5e9"],
};

function nodeTintKey(n: MoneyNode): string {
  if (n.is_seed) return "seed";
  if (n.kyc_risk_level === "High") return "high";
  if (n.kyc_risk_level === "Medium") return "medium";
  return "normal";
}

/** Drawn radius in SVG units. Single source of truth: the layout, the collision
 *  radius handed to the engine, and the arrowhead trim all have to agree, and they
 *  drifted apart when this was inlined in three places. */
function nodeRadius(n: MoneyNode): number {
  return n.is_seed ? 17 : 9 + Math.min(6, (n.degree ?? 1) * 1.4);
}

/** Shorten a label while keeping the part that distinguishes it.
 *
 *  Account labels look like "Mysuru Cooperative Bank ****0421". Truncating the tail
 *  removes the account digits — the only unique part — so several different
 *  accounts rendered identical text. Eliding the middle keeps both ends. */
function shortLabel(label: string, max = 22): string {
  if (label.length <= max) return label;
  const tail = 8;
  return label.slice(0, max - tail - 1) + "\u2026" + label.slice(-tail);
}

/** Plate width for a label at fontSize 9.5, in SVG units. */
function labelWidth(text: string): number {
  return Math.max(24, text.length * 5.3 + 8);
}

/** Stroke width from transferred amount, on a square-root scale.
 *
 *  Linear width would let one large transfer swamp the picture — amounts here span
 *  three orders of magnitude — while a flat width throws the information away
 *  entirely, which is what the previous two-value (1.2 / 2.5) version did. */
function edgeWidth(amount: number, max: number): number {
  if (!max || amount <= 0) return 1.4;
  return 1.4 + Math.sqrt(amount / max) * 5.2;
}

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function FinancialLinksPanel({ seed }: { seed: string }) {
  const t = useT();
  const { lang } = useI18n();
  const [data, setData] = useState<MoneyTrailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [minAmount, setMinAmount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<MoneyNode | null>(null);

  useEffect(() => {
    if (!seed?.trim()) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    financial
      .moneyTrail({
        entity_name: seed.trim(),
        depth: 2,
        suspicious_only: suspiciousOnly,
        min_amount: minAmount,
      })
      .then(async (r) => {
        if (!alive) return;

        // Translate nodes dynamically at runtime if language is Kannada
        if (lang === "KN" || lang === "kn") {
          try {
            const { translateOnTheFly } = await import("@/lib/api/intelligence");
            const stringsToTranslate: string[] = [];
            r.nodes.forEach((n) => {
              if (n.label) stringsToTranslate.push(n.label);
              if (n.person_label) stringsToTranslate.push(n.person_label);
              if (n.bank_name) stringsToTranslate.push(n.bank_name);
              if (n.account_type) stringsToTranslate.push(n.account_type);
            });
            const translations = await translateOnTheFly(stringsToTranslate);
            const accountTypeKN: Record<string, string> = {
              Savings: "ಉಳಿತಾಯ",
              Current: "ಚಾಲ್ತಿ",
              Loan: "ಸಾಲ",
              "Credit Card": "ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್",
            };
            r.nodes = r.nodes.map((n) => ({
              ...n,
              label: translations[n.label] ?? n.label,
              person_label: n.person_label
                ? (translations[n.person_label] ?? n.person_label)
                : null,
              bank_name: n.bank_name ? (translations[n.bank_name] ?? n.bank_name) : null,
              account_type: n.account_type
                ? (translations[n.account_type] ?? accountTypeKN[n.account_type] ?? n.account_type)
                : null,
            }));
          } catch (e) {
            console.warn("[financial links] dynamic translation failed:", e);
          }
        }

        setData(r);
      })
      .catch(() => {
        if (alive) setError(t("Could not load financial links for this seed."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [seed, suspiciousOnly, minAmount, lang]);

  // ── Force layout, replacing a static circle ────────────────────────────────
  //
  // The old layout dropped every non-seed account on one ring at a fixed radius.
  // That is why it read as "rings": account structure was invisible, because
  // position carried no information — two accounts trading heavily sat as far apart
  // as two unrelated ones. A force layout puts connected accounts near each other,
  // so a cluster on screen means a cluster in the money.
  //
  // World space is the 0-100 box the engine defaults to; rendering scales it into
  // the SVG viewBox, which keeps the physics tuning identical to the People graph.
  const engineRef = useRef(new ForceGraph());
  const [, setTickTock] = useState(0);
  const [settled, setSettled] = useState(false);
  const rafRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragId = useRef<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nodes = data?.nodes ?? [];
    const g = engineRef.current;
    const seedIds = new Set(nodes.filter((n) => n.is_seed).map((n) => n.id));
    const seeded = ringLayout(
      nodes.map((n) => n.id),
      { cx: 50, cy: 50, radius: 28, centreIds: seedIds },
    );
    g.setGraph(
      nodes.map((n) => ({
        id: n.id,
        x: seeded[n.id]?.x ?? 50,
        y: seeded[n.id]?.y ?? 50,
        // Heavier when the account moves more money, so the hubs hold the middle
        // and small accounts arrange themselves around them.
        mass: n.is_seed ? 6 : 1 + Math.min(3, (n.degree ?? 1) * 0.4),
        // Drawn radius converted to world units (the SVG is 720 wide over a
        // 100-unit world), so collision keeps the account labels readable.
        radius: (nodeRadius(n) / 720) * 100,
        pinned: n.is_seed,
      })),
      (data?.edges ?? []).map((e) => ({ a: e.source, b: e.target })),
    );
    g.params.linkDistance = fitLinkDistance(nodes.length);
    g.params.repulsion = 22;
    setSettled(false);
  }, [data]);

  useEffect(() => {
    if (settled) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const g = engineRef.current;
      const moving = g.step(dt);
      setTickTock((n) => n + 1);
      if (!moving && !g.dragging) {
        setSettled(true);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [settled]);

  /** World (0-100) -> SVG viewBox coordinates. */
  const toSvg = (x: number, y: number) => ({ x: (x / 100) * 720, y: (y / 100) * 460 });
  /** Pointer -> world, via the SVG's own matrix so it is correct at any CSS size. */
  const toWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 50, y: 50 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 50, y: 50 };
    const r = pt.matrixTransform(ctm.inverse());
    return { x: (r.x / 720) * 100, y: (r.y / 460) * 100 };
  };

  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragId.current = id;
    engineRef.current.dragStart(id);
    setSettled(false);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragId.current) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    engineRef.current.dragTo(x, y);
    setSettled(false);
  };
  const onUp = () => {
    const id = dragId.current;
    if (!id) return;
    // Dropped accounts stay where they were put — an analyst arranging a money
    // trail is doing deliberate work, and springing back undoes it.
    engineRef.current.dragEnd(true);
    setPinned((prev) => new Set(prev).add(id));
    dragId.current = null;
    setSettled(false);
  };

  /** Current positions, read straight from the engine on every render.
   *
   *  Deliberately not memoised: the whole point is that it changes every animation
   *  frame, and the frame loop already forces a re-render. A `useMemo` here would
   *  need the live node array in its dependency list, which is the same object
   *  every frame — so it would either never update or need a fake dependency. */
  const layout: Record<string, { x: number; y: number; n: MoneyNode }> = {};
  for (const n of data?.nodes ?? []) {
    const fn = engineRef.current.node(n.id);
    if (!fn) continue;
    const p = toSvg(fn.x, fn.y);
    layout[n.id] = { x: p.x, y: p.y, n };
  }

  if (!seed?.trim())
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full p-8 text-center">
        <DollarSign className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {t("Enter a seed person above to view their financial links.")}
        </p>
      </div>
    );

  if (loading)
    return (
      <div className="flex items-center justify-center gap-3 h-full p-8 text-muted-foreground text-sm">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        {t("Loading financial links…")}
      </div>
    );

  if (error)
    return (
      <div className="flex items-center gap-2 m-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );

  if (!data || data.nodes.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full p-8 text-center">
        <Shield className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {t("No financial accounts or transactions linked to this seed.")}
        </p>
      </div>
    );

  const maxAmount = data.edges.reduce((m, e) => Math.max(m, e.amount || 0), 0);

  const flagCounts = data.edges.reduce<Record<string, number>>((acc, e) => {
    if (e.pattern_flag) acc[e.pattern_flag] = (acc[e.pattern_flag] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("Accounts"), val: data.nodes.length, icon: DollarSign, color: "text-primary" },
          { label: t("Flows"), val: data.edges.length, icon: TrendingUp, color: "text-foreground" },
          {
            label: t("Flagged"),
            val: data.flagged_count,
            icon: AlertTriangle,
            color: "text-destructive",
          },
          {
            label: t("Total"),
            val: inr(data.total_amount),
            icon: DollarSign,
            color: "text-emerald-600 dark:text-emerald-400",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border bg-card p-3 flex items-center gap-2"
          >
            <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
            <div>
              <div className={`text-sm font-bold tabular-nums ${s.color}`}>{s.val}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Flag legend */}
      {Object.keys(flagCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(flagCounts).map(([flag, count]) => (
            <span
              key={flag}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold"
              style={{
                borderColor: FLAG_COLOR[flag] + "60",
                color: FLAG_COLOR[flag],
                background: FLAG_COLOR[flag] + "15",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: FLAG_COLOR[flag] }} />
              {t(FLAG_LABEL[flag] || flag)} ({count})
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={suspiciousOnly}
            onChange={(e) => setSuspiciousOnly(e.target.checked)}
            className="rounded accent-destructive"
          />
          <span className="text-muted-foreground">{t("Suspicious only")}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t("Min amount")}</span>
          <select
            value={minAmount}
            onChange={(e) => setMinAmount(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
          >
            <option value={0}>{t("Any")}</option>
            <option value={10000}>₹10K+</option>
            <option value={100000}>₹1L+</option>
            <option value={1000000}>₹10L+</option>
          </select>
        </label>
      </div>

      <div className="grid md:grid-cols-[1fr_280px] gap-4">
        {/* SVG graph */}
        <svg
          ref={svgRef}
          viewBox="0 0 720 460"
          className="w-full touch-none select-none rounded-xl border border-border bg-card/50"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          <defs>
            {/* One marker per edge colour, and `markerUnits="userSpaceOnUse"`.
             *
             * Both details are load-bearing. Markers default to `strokeWidth`
             * units, so an amount-scaled stroke of ~6 multiplied the arrowhead by
             * six and produced triangles bigger than the nodes. And a marker does
             * NOT inherit `currentColor` from the path that references it — it
             * resolves in its own context — so a single shared marker rendered
             * black regardless of the edge colour. Enumerating them is the portable
             * fix; `context-stroke` is not supported widely enough to rely on. */}
            {ARROW_COLORS.map(([key, col]) => (
              <marker
                key={key}
                id={`fin-arrow-${key}`}
                markerUnits="userSpaceOnUse"
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L8,3 L0,6 Z" fill={col} />
              </marker>
            ))}
            {/* One gradient per node kind, lit from the top-left, so nodes read as
                objects rather than flat discs. */}
            {Object.entries(NODE_TINT).map(([k, [light, base]]) => (
              <radialGradient key={k} id={`fin-grad-${k}`} cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor={light} />
                <stop offset="100%" stopColor={base} />
              </radialGradient>
            ))}
            <filter id="fin-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Edges. Width carries amount and curvature separates the two directions
              of a reciprocal pair, which a straight line drew on top of itself. */}
          {data.edges.map((e, i) => {
            const a = layout[e.source],
              b = layout[e.target];
            if (!a || !b) return null;
            const color = e.pattern_flag ? (FLAG_COLOR[e.pattern_flag] ?? "#64748b") : "#94a3b8";
            const touched =
              !selectedNode || selectedNode.id === e.source || selectedNode.id === e.target;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const bow = Math.min(len * 0.16, 34);
            const mx = (a.x + b.x) / 2 + (-dy / len) * bow;
            const my = (a.y + b.y) / 2 + (dx / len) * bow;

            // Stop the curve clear of both node bodies. Drawing to the node centre
            // buried the arrowhead under the circle, so direction — the whole point
            // of an arrow on a money trail — was unreadable. The tangent of a
            // quadratic at its endpoint runs along (end - control), which is what
            // to back off along, not the straight chord.
            const t0x = a.x - mx;
            const t0y = a.y - my;
            const l0 = Math.hypot(t0x, t0y) || 1;
            const t1x = b.x - mx;
            const t1y = b.y - my;
            const l1 = Math.hypot(t1x, t1y) || 1;
            const startTrim = nodeRadius(a.n) + 2;
            // Leave room for the 8-unit arrowhead as well as the node itself.
            const endTrim = nodeRadius(b.n) + 10;
            const sx = a.x - (t0x / l0) * startTrim;
            const sy = a.y - (t0y / l0) * startTrim;
            const ex = b.x - (t1x / l1) * endTrim;
            const ey = b.y - (t1y / l1) * endTrim;
            // A pair closer together than the two trims would invert the curve.
            if (len < startTrim + endTrim) return null;

            return (
              <path
                key={i}
                d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
                fill="none"
                stroke={color}
                strokeWidth={edgeWidth(e.amount, maxAmount) * (e.is_suspicious ? 1.6 : 1)}
                strokeOpacity={touched ? (e.is_suspicious ? 0.95 : 0.5) : 0.12}
                strokeLinecap="round"
                strokeDasharray={e.is_suspicious ? undefined : "6 5"}
                markerEnd={`url(#fin-arrow-${arrowKey(e.pattern_flag)})`}
              />
            );
          })}

          {/* Nodes */}
          {Object.values(layout).map(({ x, y, n }) => {
            const isSelected = selectedNode?.id === n.id;
            const kind = nodeTintKey(n);
            const r = nodeRadius(n);
            const isPinned = pinned.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${x},${y})`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={onNodeDown(n.id)}
                onClick={() => setSelectedNode(n)}
              >
                {/* Soft halo, and a brighter one when this node is inspected. */}
                <circle
                  r={r + 5}
                  fill={NODE_TINT[kind][1]}
                  opacity={isSelected ? 0.3 : 0.16}
                  filter="url(#fin-glow)"
                />
                <circle
                  r={r}
                  fill={`url(#fin-grad-${kind})`}
                  stroke={isSelected ? "#ffffff" : "#0f172a"}
                  strokeWidth={isSelected ? 3 : 1.6}
                  strokeOpacity={0.9}
                />
                {/* A dropped node is held in place; say so rather than letting the
                    user wonder why it stopped participating in the layout. */}
                {isPinned && (
                  <circle
                    r={r + 3}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                )}
                {/* Label on a plate, above the node.
                 *
                 * Bank labels share long prefixes ("Canara Union Bank ****1234"),
                 * so a 17-character truncation rendered several nodes with the
                 * *same* visible text — the account number, which is the only part
                 * that differs, was exactly what got cut. Now the tail is kept and
                 * the middle is elided. The plate stops labels from disappearing
                 * into the edges they cross. */}
                <g transform={`translate(0, ${-(r + 9)})`} className="pointer-events-none">
                  <rect
                    x={-labelWidth(shortLabel(n.label)) / 2}
                    y={-8}
                    width={labelWidth(shortLabel(n.label))}
                    height={13}
                    rx={3}
                    // `var(--card)` does NOT exist in styles.css — only
                    // --background, --secondary-background, --foreground and
                    // --border are defined. An unresolvable var in an SVG `fill`
                    // is an invalid value, and SVG falls back to BLACK rather than
                    // ignoring it, so the plate rendered solid black while the text
                    // below stayed `currentColor` (also black in the light theme).
                    // Result: invisible labels. Using the variable the People graph
                    // already proves works here.
                    fill="var(--secondary-background)"
                    stroke="currentColor"
                    strokeWidth={0.8}
                    strokeOpacity={0.35}
                    opacity={0.95}
                  />
                  <text
                    y={1}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={n.is_seed || isSelected ? 800 : 600}
                    fill="currentColor"
                  >
                    {shortLabel(n.label)}
                  </text>
                </g>
                {n.kyc_risk_level === "High" && (
                  <text
                    y={4}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#fff"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    !
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Node inspector / edge table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          {selectedNode ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t("Account Details")}
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  ✕
                </button>
              </div>
              {[
                [t("Label"), selectedNode.label],
                [t("Bank"), selectedNode.bank_name || "—"],
                [t("Type"), selectedNode.account_type || "—"],
                [t("District"), tData("district", selectedNode.district, lang) || "—"],
                [t("KYC Risk"), tData("kyc_risk_level", selectedNode.kyc_risk_level, lang) || "—"],
                [t("Owner"), selectedNode.person_label || "—"],
                [t("In"), inr(selectedNode.total_in)],
                [t("Out"), inr(selectedNode.total_out)],
                [t("Degree"), String(selectedNode.degree)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs gap-2">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-medium text-right truncate">{v}</span>
                </div>
              ))}
              {selectedNode.is_seed && (
                <div className="rounded-lg bg-primary/10 text-primary px-2 py-1 text-[10px] font-bold text-center">
                  {t("SEED ACCOUNT")}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <div className="px-3 py-2 border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("Top Flows (click node to inspect)")}
              </div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-2 py-1.5 text-left">{t("From")}</th>
                    <th className="px-2 py-1.5 text-left">{t("Amount")}</th>
                    <th className="px-2 py-1.5 text-left">{t("Flag")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.edges
                    .slice()
                    .sort((a, b) => b.amount - a.amount)
                    .slice(0, 15)
                    .map((e, i) => (
                      <tr key={i} className={e.is_suspicious ? "text-destructive" : ""}>
                        <td className="px-2 py-1 text-[10px] truncate max-w-[80px]">
                          {layout[e.source]?.n.label ?? e.source}
                        </td>
                        <td className="px-2 py-1 font-bold tabular-nums">{inr(e.amount)}</td>
                        <td className="px-2 py-1">
                          {e.pattern_flag ? (
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                              style={{
                                background: (FLAG_COLOR[e.pattern_flag] || "#64748b") + "20",
                                color: FLAG_COLOR[e.pattern_flag] || "#64748b",
                              }}
                            >
                              {t(FLAG_LABEL[e.pattern_flag] || e.pattern_flag)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
        {t(data.notice)}
      </p>
    </div>
  );
}
