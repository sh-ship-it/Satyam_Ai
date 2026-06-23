import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { ShieldCheck, Lock, ChevronDown, Check, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useState, useMemo, useEffect } from "react";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit · Satyam" },
      { name: "description", content: "Read-only compliance log with hash-chain integrity." },
    ],
  }),
  component: Audit,
});

type AuditRow = {
  t: string;
  u: string;
  role: string;
  action: string;
  query: string;
  result: string;
  src: string;
  rawTs: number; // epoch ms for date comparison
};

/** ISO date string → "YYYY-MM-DD" */
function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function Audit() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [chainHead, setChainHead] = useState<string | null>(null);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);

  // Filter state — all derived from live data, nothing hardcoded
  const [userFilter, setUserFilter] = useState("All");
  const [actionFilter, setActionFilter] = useState("All");
  const [srcFilter, setSrcFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    api
      .audit({ limit: 500 })
      .then((res: any) => {
        if (!active) return;
        const mapped: AuditRow[] = (res?.entries ?? []).map((e: any) => {
          const rawTs = e.ts ? new Date(e.ts).getTime() : 0;
          return {
            t: e.ts ? new Date(e.ts).toLocaleString() : "—",
            u: e.user ?? "—",
            role: e.role ?? "—",
            action: e.action ?? "ALLOW",
            query: e.query ?? "",
            result: e.result ?? "",
            src: e.src ?? "audit_log",
            rawTs,
          };
        });
        setRows(mapped);
        if (typeof res?.chain_valid === "boolean") setChainValid(res.chain_valid);
        if (typeof res?.total === "number") setLiveTotal(res.total);
        if (typeof res?.chain_head === "string") setChainHead(res.chain_head);

        // Auto-set date range to span the actual data
        const timestamps = mapped.map((r) => r.rawTs).filter(Boolean);
        if (timestamps.length > 0) {
          setFromDate(toDateInput(new Date(Math.min(...timestamps))));
          setToDate(toDateInput(new Date(Math.max(...timestamps))));
        } else {
          const today = toDateInput(new Date());
          setFromDate(today);
          setToDate(today);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          const today = toDateInput(new Date());
          setFromDate(today);
          setToDate(today);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Voice command "open audit and find …" sets the search filter on this page.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/audit") return;
      const actions = Array.isArray(d.actions) ? d.actions : [];
      if (actions.length > 0) {
        for (const a of actions) {
          if (a.screen !== "/audit") continue;
          const p = a.params || {};
          if (a.action === "search" && p.query) setQuery(String(p.query));
          else if (a.action === "filter_action" && p.action) setActionFilter(String(p.action));
        }
        return;
      }
      if (typeof d.task === "string" && d.task.trim()) setQuery(d.task.trim());
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  // Derive unique option lists from live data — never hardcoded
  const userOptions = useMemo(() => {
    const s = new Set(rows.map((r) => r.u).filter((u) => u && u !== "—"));
    return ["All", ...Array.from(s).sort()];
  }, [rows]);

  const actionOptions = useMemo(() => {
    const s = new Set(rows.map((r) => r.action).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [rows]);

  const srcOptions = useMemo(() => {
    const s = new Set(rows.map((r) => r.src).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return rows.filter((r) => {
      if (userFilter !== "All" && r.u !== userFilter) return false;
      if (actionFilter !== "All" && r.action !== actionFilter) return false;
      if (srcFilter !== "All" && r.src !== srcFilter) return false;
      if (from && r.rawTs && r.rawTs < from) return false;
      if (to && r.rawTs && r.rawTs > to) return false;
      if (q && ![r.t, r.u, r.role, r.action, r.query, r.result, r.src]
        .join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, rows, userFilter, actionFilter, srcFilter, fromDate, toDate]);

  function resetFilters() {
    setQuery("");
    setUserFilter("All");
    setActionFilter("All");
    setSrcFilter("All");
    const timestamps = rows.map((r) => r.rawTs).filter(Boolean);
    if (timestamps.length > 0) {
      setFromDate(toDateInput(new Date(Math.min(...timestamps))));
      setToDate(toDateInput(new Date(Math.max(...timestamps))));
    }
  }

  const hasActiveFilters =
    !!query || userFilter !== "All" || actionFilter !== "All" || srcFilter !== "All";

  return (
    <Shell>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("Compliance")}
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {t("Audit log")}{" "}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t("read-only")}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3.5 py-2">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-success">
                {t("Hash-chain integrity")}
              </div>
              <div className="text-sm font-semibold text-foreground flex items-center gap-1">
                <Check className="h-4 w-4 text-success" />
                {chainValid === false
                  ? t("CHAIN BROKEN")
                  : liveTotal != null
                    ? `${t("VERIFIED")} · ${liveTotal.toLocaleString()} ${t("entries")}`
                    : t("Verifying…")}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-nowrap items-end gap-2 rounded-xl border border-border bg-card p-3 overflow-x-auto">
          <Filter label={t("Search")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search user, query, result…")}
                className="w-44 rounded-md border border-input bg-card pl-7 pr-7 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Filter>
          <Filter label={t("User")}>
            <Select
              options={loading ? ["All"] : userOptions}
              value={userFilter}
              onChange={setUserFilter}
            />
          </Filter>
          <Filter label={t("Action")}>
            <Select
              options={loading ? ["All"] : actionOptions}
              value={actionFilter}
              onChange={setActionFilter}
            />
          </Filter>
          <Filter label={t("From")}>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
            />
          </Filter>
          <Filter label={t("To")}>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
            />
          </Filter>
          <Filter label={t("Source table")}>
            <Select
              options={loading ? ["All"] : srcOptions}
              value={srcFilter}
              onChange={setSrcFilter}
            />
          </Filter>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="self-end mb-px rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition"
            >
              {t("Reset")}
            </button>
          )}
          <button className="ml-auto self-end rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            {t("Apply")}
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <Th>{t("Time")}</Th>
                  <Th>{t("User")}</Th>
                  <Th>{t("Role")}</Th>
                  <Th>{t("Action")}</Th>
                  <Th className="min-w-[300px]">{t("Query / SQL")}</Th>
                  <Th>{t("Result")}</Th>
                  <Th>{t("Sources")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {t("Loading audit log…")}
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-sm text-destructive font-semibold"
                    >
                      {t("Couldn't load the audit log.")}
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {t("No entries match your search.")}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, i) => {
                    const deny = r.action === "DENY";
                    return (
                      <tr key={i} className={`${deny ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                        <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground whitespace-nowrap">
                          {r.t}
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">{r.u}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t(r.role)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              deny
                                ? "bg-destructive/15 text-destructive"
                                : "bg-success/15 text-success"
                            }`}
                          >
                            {deny && <Lock className="h-3 w-3" />}
                            {r.action}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-[12px] text-foreground/80 max-w-[420px] truncate"
                          title={r.query}
                        >
                          {r.query}
                        </td>
                        <td className="px-3 py-2 text-foreground/80 whitespace-nowrap">
                          {r.result}
                        </td>
                        <td className="px-3 py-2 text-[12px] font-mono text-muted-foreground">
                          {r.src}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {t("Showing")} {filteredRows.length} {t("of")}{" "}
              {liveTotal?.toLocaleString() ?? rows.length} {t("entries")} ·{" "}
              {t("Read-only · No edit controls exposed")}
            </span>
            <span className="font-mono">SHA-256 head: {chainHead ? `${chainHead.slice(0,4)}…${chainHead.slice(-4)}` : "—"}</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left font-semibold ${className}`}>{children}</th>;
}
function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
function Select({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-input bg-card px-2.5 py-1.5 pr-7 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
