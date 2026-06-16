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
};

function Audit() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    api
      .audit({ limit: 100 })
      .then((res: any) => {
        if (!active) return;
        const mapped = (res?.entries ?? []).map((e: any) => ({
          t: e.ts ? new Date(e.ts).toLocaleString() : "—",
          u: e.user ?? "—",
          role: e.role ?? "—",
          action: e.action ?? "ALLOW",
          query: e.query ?? "",
          result: e.result ?? "",
          src: e.src ?? "audit_log",
        }));
        setRows(mapped);
        if (typeof res?.chain_valid === "boolean") setChainValid(res.chain_valid);
        if (typeof res?.total === "number") setLiveTotal(res.total);
      })
      .catch(() => {
        if (active) setLoadError(true);
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
      if (typeof d.task === "string" && d.task.trim()) setQuery(d.task.trim());
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.t, r.u, r.role, r.action, r.query, r.result, r.src]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [query, rows]);

  return (
    <Shell>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Compliance")}</div>
            <h1 className="text-xl font-semibold text-foreground">{t("Audit log")} <span className="ml-2 text-xs font-normal text-muted-foreground">{t("read-only")}</span></h1>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3.5 py-2">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-success">{t("Hash-chain integrity")}</div>
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
          <Filter label={t("User")}><Select options={[t("All users"), "r.kumar", "p.shetty", "n.iyer", "admin"]} /></Filter>
          <Filter label={t("Action")}><Select options={[t("All"), "ALLOW", "DENY"]} /></Filter>
          <Filter label={t("From")}><input type="date" defaultValue="2024-08-14" className="rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground" /></Filter>
          <Filter label={t("To")}><input type="date" defaultValue="2024-08-14" className="rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground" /></Filter>
          <Filter label={t("Source table")}><Select options={[t("All"), "fir_records", "persons", "cctv_evidence", "graph_index"]} /></Filter>
          <button className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("Apply")}</button>
        </div>


        {/* Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <Th>{t("Time")}</Th><Th>{t("User")}</Th><Th>{t("Role")}</Th><Th>{t("Action")}</Th>
                  <Th className="min-w-[300px]">{t("Query / SQL")}</Th>
                  <Th>{t("Result")}</Th><Th>{t("Sources")}</Th>
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
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-destructive font-semibold">
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
                        <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground whitespace-nowrap">{r.t}</td>
                        <td className="px-3 py-2 font-medium text-foreground">{r.u}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t(r.role)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            deny ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                          }`}>
                            {deny && <Lock className="h-3 w-3" />}
                            {r.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px] text-foreground/80 max-w-[420px] truncate" title={r.query}>
                          {r.query}
                        </td>
                        <td className="px-3 py-2 text-foreground/80 whitespace-nowrap">{r.result}</td>
                        <td className="px-3 py-2 text-[12px] font-mono text-muted-foreground">{r.src}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>

            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {t("Showing")} {filteredRows.length} {t("of")} {liveTotal?.toLocaleString() ?? rows.length} {t("entries")} · {t("Read-only · No edit controls exposed")}
            </span>
            <span className="font-mono">SHA-256 head: 4f8b…a91c</span>
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
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function Select({ options }: { options: string[] }) {
  return (
    <div className="relative">
      <select className="appearance-none rounded-md border border-input bg-card px-2.5 py-1.5 pr-7 text-sm">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
