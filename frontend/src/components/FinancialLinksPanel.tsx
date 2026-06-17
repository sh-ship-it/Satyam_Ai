import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, DollarSign, TrendingUp, Shield } from "lucide-react";
import { financial, type MoneyTrailResponse, type MoneyNode } from "@/lib/api/financial";

const FLAG_COLOR: Record<string, string> = {
  high_value: "#dc2626",
  near_incident_date: "#ea580c",
  rapid_repeated: "#d97706",
  circular_flow: "#7c3aed",
};

const FLAG_LABEL: Record<string, string> = {
  high_value: "High Value",
  near_incident_date: "Near Incident",
  rapid_repeated: "Rapid Repeated",
  circular_flow: "Circular Flow",
};

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);
}

export function FinancialLinksPanel({ seed }: { seed: string }) {
  const [data, setData] = useState<MoneyTrailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [minAmount, setMinAmount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<MoneyNode | null>(null);

  useEffect(() => {
    if (!seed?.trim()) { setData(null); return; }
    let alive = true;
    setLoading(true); setError(null); setSelectedNode(null);
    financial
      .moneyTrail({ entity_name: seed.trim(), depth: 2, suspicious_only: suspiciousOnly, min_amount: minAmount })
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setError("Could not load financial links for this seed."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [seed, suspiciousOnly, minAmount]);

  // Circular layout for nodes.
  const layout = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const cx = 360, cy = 230, R = 170;
    const pos: Record<string, { x: number; y: number; n: MoneyNode }> = {};
    const seedNodes = nodes.filter((n) => n.is_seed);
    const otherNodes = nodes.filter((n) => !n.is_seed);

    // Seed node(s) at centre
    if (seedNodes.length === 1) {
      pos[seedNodes[0].id] = { x: cx, y: cy, n: seedNodes[0] };
    } else {
      seedNodes.forEach((n, i) => {
        const a = (2 * Math.PI * i) / (seedNodes.length || 1);
        pos[n.id] = { x: cx + 60 * Math.cos(a), y: cy + 60 * Math.sin(a), n };
      });
    }

    otherNodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / (otherNodes.length || 1);
      pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), n };
    });
    return pos;
  }, [data]);

  if (!seed?.trim()) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full p-8 text-center">
      <DollarSign className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">Enter a seed person above to view their financial links.</p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center gap-3 h-full p-8 text-muted-foreground text-sm">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Loading financial links…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 m-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
    </div>
  );

  if (!data || data.nodes.length === 0) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full p-8 text-center">
      <Shield className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No financial accounts or transactions linked to this seed.</p>
    </div>
  );

  const flagCounts = data.edges.reduce<Record<string, number>>((acc, e) => {
    if (e.pattern_flag) acc[e.pattern_flag] = (acc[e.pattern_flag] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Accounts", val: data.nodes.length, icon: DollarSign, color: "text-primary" },
          { label: "Flows", val: data.edges.length, icon: TrendingUp, color: "text-foreground" },
          { label: "Flagged", val: data.flagged_count, icon: AlertTriangle, color: "text-destructive" },
          { label: "Total", val: inr(data.total_amount), icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
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
            <span key={flag} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold"
              style={{ borderColor: FLAG_COLOR[flag] + "60", color: FLAG_COLOR[flag], background: FLAG_COLOR[flag] + "15" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: FLAG_COLOR[flag] }} />
              {FLAG_LABEL[flag] || flag} ({count})
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={suspiciousOnly}
            onChange={(e) => setSuspiciousOnly(e.target.checked)}
            className="rounded accent-destructive" />
          <span className="text-muted-foreground">Suspicious only</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Min amount</span>
          <select value={minAmount} onChange={e => setMinAmount(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
            <option value={0}>Any</option>
            <option value={10000}>₹10K+</option>
            <option value={100000}>₹1L+</option>
            <option value={1000000}>₹10L+</option>
          </select>
        </label>
      </div>

      <div className="grid md:grid-cols-[1fr_280px] gap-4">
        {/* SVG graph */}
        <svg viewBox="0 0 720 460" className="w-full rounded-xl border border-border bg-card/50">
          <defs>
            <marker id="fin-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="#94a3b8" />
            </marker>
          </defs>
          {/* Edges */}
          {data.edges.map((e, i) => {
            const a = layout[e.source], b = layout[e.target];
            if (!a || !b) return null;
            const color = e.pattern_flag ? (FLAG_COLOR[e.pattern_flag] ?? "#64748b") : "#94a3b8";
            const w = e.is_suspicious ? 2.5 : 1.2;
            return (
              <line key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color} strokeWidth={w} strokeOpacity={0.7}
                markerEnd="url(#fin-arrow)" />
            );
          })}
          {/* Nodes */}
          {Object.values(layout).map(({ x, y, n }) => {
            const isSelected = selectedNode?.id === n.id;
            const fill = n.is_seed ? "#2563eb"
              : n.kyc_risk_level === "High" ? "#dc2626"
              : n.kyc_risk_level === "Medium" ? "#d97706"
              : "#0ea5e9";
            const r = n.is_seed ? 14 : 9;
            return (
              <g key={n.id} transform={`translate(${x},${y})`}
                className="cursor-pointer" onClick={() => setSelectedNode(n)}>
                <circle r={r + (isSelected ? 3 : 0)}
                  fill={fill} stroke={isSelected ? "#fff" : "#1e293b"}
                  strokeWidth={isSelected ? 2.5 : 1.5} opacity={0.9} />
                <text y={-(r + 6)} textAnchor="middle" fontSize={9}
                  fill="currentColor" className="pointer-events-none">
                  {n.label.length > 16 ? n.label.slice(0, 15) + "…" : n.label}
                </text>
                {n.kyc_risk_level === "High" && (
                  <text y={4} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="bold">!</text>
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
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Account Details</div>
                <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              </div>
              {[
                ["Label", selectedNode.label],
                ["Bank", selectedNode.bank_name || "—"],
                ["Type", selectedNode.account_type || "—"],
                ["District", selectedNode.district || "—"],
                ["KYC Risk", selectedNode.kyc_risk_level || "—"],
                ["Owner", selectedNode.person_label || "—"],
                ["In", inr(selectedNode.total_in)],
                ["Out", inr(selectedNode.total_out)],
                ["Degree", String(selectedNode.degree)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs gap-2">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-medium text-right truncate">{v}</span>
                </div>
              ))}
              {selectedNode.is_seed && (
                <div className="rounded-lg bg-primary/10 text-primary px-2 py-1 text-[10px] font-bold text-center">SEED ACCOUNT</div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <div className="px-3 py-2 border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Top Flows (click node to inspect)
              </div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-2 py-1.5 text-left">From</th>
                    <th className="px-2 py-1.5 text-left">Amount</th>
                    <th className="px-2 py-1.5 text-left">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.edges
                    .slice().sort((a, b) => b.amount - a.amount).slice(0, 15)
                    .map((e, i) => (
                      <tr key={i} className={e.is_suspicious ? "text-destructive" : ""}>
                        <td className="px-2 py-1 text-[10px] truncate max-w-[80px]">
                          {layout[e.source]?.n.label ?? e.source}
                        </td>
                        <td className="px-2 py-1 font-bold tabular-nums">{inr(e.amount)}</td>
                        <td className="px-2 py-1">
                          {e.pattern_flag ? (
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                              style={{ background: (FLAG_COLOR[e.pattern_flag] || "#64748b") + "20", color: FLAG_COLOR[e.pattern_flag] || "#64748b" }}>
                              {FLAG_LABEL[e.pattern_flag] || e.pattern_flag}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-border pt-2">{data.notice}</p>
    </div>
  );
}
