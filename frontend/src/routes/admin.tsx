import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useT } from "@/lib/i18n";
import { api, getCachedUser, type AdminUserRow } from "@/lib/api/client";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Lock, Search, UserCog, Loader2, X, Check, AlertTriangle,
  ShieldAlert, RefreshCcw, CircleSlash,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Access Control · Satyam" },
      { name: "description", content: "L4-only admin console for account creators and policy." },
    ],
  }),
  component: AdminAccessControl,
});

const RANKS = [
  "DGP", "ADGP", "IGP", "DIG", "SP", "Addl.SP", "DySP",
  "CPI", "PI", "CI", "PSI", "SI", "ASI", "HC", "PC",
  "admin", "analyst", "investigator", "viewer",
];
const SCOPES = ["state", "range", "district", "station"] as const;
const CLEARANCES = [1, 2, 3, 4] as const;

function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    default: "bg-primary/10",
    warn: "bg-warning/30",
    bad: "bg-destructive/20 text-destructive",
    good: "bg-primary/20 text-primary",
  };
  return (
    <span className={`inline-block rounded-[3px] border-2 border-foreground px-1.5 py-px font-mono text-[10px] font-bold ${map[tone] ?? map.default}`}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-foreground/55">{label}</span>
      {children}
    </label>
  );
}

function AdminAccessControl() {
  const t = useT();
  const me = getCachedUser();
  const isL4 = (me?.clearance ?? 0) >= 4;

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  const load = () => {
    setLoading(true);
    setErr("");
    api
      .adminUsers()
      .then((res) => setRows(res.rows))
      .catch((e: any) => setErr(e?.message || t("Could not load accounts.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isL4) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isL4]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.full_name, r.username, r.email, r.assigned_rank, r.created_by_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s),
    );
  }, [rows, q]);

  if (!isL4) {
    return (
      <Shell>
        <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 rounded-[5px] border-2 border-foreground bg-secondary-background p-8 text-center nb-shadow-lg">
          <div className="grid h-14 w-14 place-items-center rounded-[5px] border-2 border-foreground bg-destructive text-destructive-foreground nb-shadow-sm">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-extrabold">{t("Restricted — L4 clearance required")}</h2>
          <p className="text-sm font-bold text-foreground/70">
            {t("Only top-priority administrators (clearance L4) can open Access Control.")}
          </p>
          <Pill tone="bad">
            {t("Your clearance")}: L{me?.clearance ?? "—"}
          </Pill>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            <h1 className="text-2xl font-extrabold tracking-tight">{t("Access Control")}</h1>
            <Pill tone="good">L4 {t("admin")}</Pill>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1.5 text-xs font-extrabold uppercase nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> {t("Refresh")}
          </button>
        </div>

        {/* Search bar */}
        <div className="mb-3 flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-background px-3 py-2 nb-shadow-sm">
          <Search className="h-4 w-4 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search by name, email, rank or creator…")}
            className="w-full bg-transparent text-sm font-bold outline-none"
          />
          {q && (
            <button onClick={() => setQ("")}>
              <X className="h-4 w-4 opacity-60" />
            </button>
          )}
        </div>

        {err && (
          <div
            role="alert"
            className="mb-3 flex items-center gap-2 rounded-[5px] border-2 border-destructive bg-destructive/15 px-3 py-2 text-sm font-bold"
          >
            <AlertTriangle className="h-4 w-4" /> {err}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm font-bold text-foreground/60">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Loading accounts…")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-header text-header-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold">{t("Officer")}</th>
                    <th className="px-3 py-2 font-extrabold">{t("Rank")}</th>
                    <th className="px-3 py-2 font-extrabold">{t("Clearance")}</th>
                    <th className="px-3 py-2 font-extrabold">{t("Scope")}</th>
                    <th className="px-3 py-2 font-extrabold">{t("Created by")}</th>
                    <th className="px-3 py-2 font-extrabold">{t("Status")}</th>
                    <th className="px-3 py-2 text-right font-extrabold">{t("Policy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.user_id} className="border-t-2 border-foreground/20">
                      <td className="px-3 py-2">
                        <div className="font-extrabold">{r.full_name || r.username}</div>
                        <div className="text-[11px] font-bold text-foreground/55">
                          {r.email || r.username}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Pill>{r.assigned_rank || "—"}</Pill>
                      </td>
                      <td className="px-3 py-2">
                        <Pill
                          tone={
                            r.clearance >= 4 ? "good" : r.clearance <= 1 ? "warn" : "default"
                          }
                        >
                          L{r.clearance}
                        </Pill>{" "}
                        {r.has_override && <Pill tone="warn">{t("override")}</Pill>}
                      </td>
                      <td className="px-3 py-2">
                        <Pill>{r.scope}</Pill>
                      </td>
                      <td className="px-3 py-2 text-[12px] font-bold">
                        {r.created_by_name ? (
                          r.created_by_name
                        ) : (
                          <span className="text-foreground/45">{t("Self-registered")}</span>
                        )}
                        {r.created_at && (
                          <div className="text-[10px] font-bold text-foreground/45">
                            {new Date(r.created_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.is_active ? (
                          <Pill tone="good">
                            <Check className="mr-0.5 inline h-2.5 w-2.5" />
                            {t("Active")}
                          </Pill>
                        ) : (
                          <Pill tone="bad">
                            <CircleSlash className="mr-0.5 inline h-2.5 w-2.5" />
                            {t("Disabled")}
                          </Pill>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setEditing(r)}
                          className="inline-flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1.5 text-[11px] font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                        >
                          <UserCog className="h-3.5 w-3.5" /> {t("Edit")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-8 text-center text-sm font-bold text-foreground/55"
                      >
                        {t("No accounts match.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <PolicyEditor
          row={editing}
          isSelf={editing.username === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((prev) =>
              prev.map((x) => (x.user_id === updated.user_id ? { ...x, ...updated } : x)),
            );
            setEditing(null);
          }}
        />
      )}
    </Shell>
  );
}

function PolicyEditor({
  row,
  isSelf,
  onClose,
  onSaved,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (u: AdminUserRow) => void;
}) {
  const t = useT();
  const [rank, setRank] = useState(row.assigned_rank || "viewer");
  const [clearance, setClearance] = useState<number>(row.clearance);
  const [scope, setScope] = useState<string>(row.scope);
  const [active, setActive] = useState<boolean>(row.is_active);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!reason.trim()) {
      setError(t("A reason is required."));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateUserPolicy(row.user_id, {
        rank,
        clearance: clearance as 1 | 2 | 3 | 4,
        scope: scope as "state" | "range" | "district" | "station",
        is_active: active,
        reason: reason.trim(),
      });
      onSaved(updated);
    } catch (e: any) {
      setError(e?.message || t("Could not save policy."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("Change policy")}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="text-base font-extrabold">
              {t("Change policy")} — {row.full_name || row.username}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground"
            aria-label={t("Close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal body */}
        <div className="space-y-4 p-5">
          {isSelf && (
            <div className="flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-warning/25 px-3 py-2 text-xs font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("This is your own account. You can't disable it or drop below L4.")}
            </div>
          )}

          <Field label={t("Rank")}>
            <select
              value={rank}
              onChange={(e) => setRank(e.target.value)}
              className="nb-input"
            >
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Clearance")}>
              <select
                value={clearance}
                onChange={(e) => setClearance(Number(e.target.value))}
                className="nb-input"
              >
                {CLEARANCES.map((c) => (
                  <option key={c} value={c}>
                    L{c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Scope")}>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="nb-input"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={active}
              disabled={isSelf}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 border-2 border-foreground"
            />
            {t("Account active")}
          </label>

          <Field label={t("Reason (audit-logged, required)")}>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("e.g. Promoted to SP — district handover")}
              className="nb-input"
            />
          </Field>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-[5px] border-2 border-destructive bg-destructive/15 px-3 py-2 text-xs font-bold"
            >
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t("Save policy")}
          </button>
        </div>
      </div>
    </div>
  );
}
