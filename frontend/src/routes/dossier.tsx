import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useState, useRef } from "react";
import {
  Fingerprint, Search, Shield, ShieldAlert, AlertTriangle,
  User, Phone, MapPin, Banknote, Scale, Users, Contact,
  ChevronRight, Printer, Lock, X, ZoomIn,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { dossier, type DossierListItem, type DossierDetail } from "@/lib/api/dossier";
import { useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/dossier")({
  head: () => ({ meta: [{ title: "Person 360 · Satyam" }] }),
  component: DossierScreen,
});

// ── Risk palette ──────────────────────────────────────────────────────────
const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High:     "bg-orange-500 text-white",
  Medium:   "bg-yellow-500 text-foreground",
  Low:      "bg-green-600 text-white",
};

const WANTED_BG: Record<string, string> = {
  Wanted:              "bg-destructive text-destructive-foreground",
  "On Bail":           "bg-orange-400 text-foreground",
  Convicted:           "bg-purple-600 text-white",
  "Under Observation": "bg-blue-500 text-white",
  Released:            "bg-muted text-muted-foreground",
};

function RiskBadge({ level }: { level: string | null }) {
  const { lang } = useI18n();
  if (!level) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RISK_BG[level] ?? "bg-muted"}`}>
      <ShieldAlert className="h-3 w-3" /> {tData("risk_label", level, lang)}
    </span>
  );
}

// ── FaceCard ──────────────────────────────────────────────────────────────
function FaceCard({ front, left, right, name }: {
  front: string | null; left: string | null; right: string | null; name: string;
}) {
  const t = useT();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjE0MCIgZmlsbD0iI2NkZDZlMCIvPjx0ZXh0IHg9IjYwIiB5PSI3NSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzZiNzI4MCI+Tm8gcGhvdG88L3RleHQ+PC9zdmc+";
  const shots = [
    { src: front, label: t("Front") },
    { src: left,  label: t("Left Profile") },
    { src: right, label: t("Right Profile") },
  ];
  return (
    <>
      <div className="flex gap-3 justify-center">
        {shots.map(({ src, label }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <div
              className="relative cursor-zoom-in overflow-hidden rounded-[6px] border-2 border-foreground bg-muted"
              style={{ width: 110, height: 130 }}
              onClick={() => src && setLightbox(src)}
            >
              {/* forensic height guide lines */}
              <div className="pointer-events-none absolute inset-0">
                {[25, 50, 75].map(p => (
                  <div key={p} className="absolute w-full border-t border-foreground/10" style={{ top: `${p}%` }} />
                ))}
                <div className="absolute left-2 top-1 text-[7px] font-mono text-foreground/30 select-none">180cm</div>
                <div className="absolute left-2 top-[25%] text-[7px] font-mono text-foreground/30 select-none">160cm</div>
                <div className="absolute left-2 top-[50%] text-[7px] font-mono text-foreground/30 select-none">140cm</div>
              </div>
              <img
                src={src ?? PLACEHOLDER}
                alt={`${name} — ${label}`}
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
              />
              {src && (
                <div className="absolute bottom-1 right-1 rounded bg-black/50 p-0.5">
                  <ZoomIn className="h-2.5 w-2.5 text-white" />
                </div>
              )}
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Full size" className="max-h-[90vh] max-w-[90vw] rounded-[8px] border-2 border-white/20 shadow-2xl" />
          <button onClick={() => setLightbox(null)} className="absolute right-6 top-6 text-white hover:text-red-400">
            <X className="h-7 w-7" />
          </button>
        </div>
      )}
    </>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────
function Section({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[8px] border-2 border-foreground bg-background p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value ?? "—"}</div>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────
function DossierScreen() {
  const t = useT();
  const { lang } = useI18n();
  const { location } = useRouterState();

  // Detect clearance from JWT stored in localStorage
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const tok = localStorage.getItem("satyam.token");
      if (!tok) { setIsAdmin(false); return; }
      const payload = JSON.parse(atob(tok.split(".")[1]));
      const cl = Number(payload.clearance ?? payload.clr ?? 0);
      const rank = String(payload.rank ?? payload.role ?? "");
      setIsAdmin(cl >= 4 || ["admin","DGP","ADGP","IGP","SP"].includes(rank));
    } catch { setIsAdmin(false); }
  }, []);

  const [list, setList]           = useState<DossierListItem[]>([]);
  const [selected, setSelected]   = useState<DossierDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch]       = useState("");

  // In-memory cache so clicking a previously loaded person is instant.
  const cacheRef = useRef<Record<number, DossierDetail>>({});

  useEffect(() => {
    if (!isAdmin) return;
    // Load the list, then pre-fetch all details in the background so
    // every subsequent click is instant (no visible delay).
    dossier.list().then(items => {
      setList(items);
      // Pre-fetch all 10 detail pages silently after list arrives.
      items.forEach(item => {
        dossier.detail(item.demo_id).then(d => {
          cacheRef.current[item.demo_id] = d;
        }).catch(() => {});
      });
    }).catch(() => {});
  }, [isAdmin]);

  function open(id: number) {
    // If already cached → instant switch, no spinner.
    if (cacheRef.current[id]) {
      setSelected(cacheRef.current[id]);
      return;
    }
    // Not yet in cache (e.g. pre-fetch hasn't finished) → show spinner once.
    setLoadingDetail(true);
    dossier.detail(id)
      .then(d => { cacheRef.current[id] = d; setSelected(d); })
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }

  const filtered = list.filter(p =>
    !search || p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.district ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (isAdmin === null) return <Shell><div className="p-8 text-sm text-muted-foreground">Loading…</div></Shell>;

  if (!isAdmin) return (
    <Shell>
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <Lock className="h-12 w-12 text-destructive/60" />
        <h2 className="text-xl font-extrabold">{t("Admin access required")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Person 360 dossier requires clearance L4 (DGP / ADGP / IGP / SP / admin). Sign in with an admin account.
        </p>
      </div>
    </Shell>
  );

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
        {/* Left rail — person list */}
        <aside className="flex w-64 shrink-0 flex-col border-r-2 border-foreground bg-card">
          <div className="border-b-2 border-foreground px-3 py-3">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider">
              <Fingerprint className="h-4 w-4 text-primary" /> {t("Person 360")}
            </div>
            <div className="mt-2 flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t("Search name / district…")}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {list.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground animate-pulse">{t("Loading…")}</div>
            )}
            {filtered.map(p => (
              <button
                key={p.demo_id}
                onClick={() => open(p.demo_id)}
                className={`flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-muted transition ${selected?.demo_id === p.demo_id ? "bg-primary/10 border-l-4 border-l-primary" : ""}`}
              >
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-[4px] border border-border bg-muted">
                  <img
                    src={p.photo_front ?? ""}
                    alt={p.full_name}
                    className="h-full w-full object-cover"
                    onError={e => (e.currentTarget.style.display = "none")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-foreground">{p.full_name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{tData("district", p.district, lang)}</div>
                  {p.risk_level && (
                    <span className={`mt-0.5 inline-block rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold ${RISK_BG[p.risk_level] ?? "bg-muted"}`}>
                      {tData("risk_label", p.risk_level, lang)}
                    </span>
                  )}
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
          {/* Demo notice */}
          <div className="border-t-2 border-foreground bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-yellow-700 dark:text-yellow-400">
              ⚠ {t("Demo data — fictional only")}
            </p>
          </div>
        </aside>

        {/* Right detail pane */}
        <main className="flex-1 min-w-0 overflow-auto bg-background">
          {loadingDetail ? (
            /* Skeleton while loading detail for the first time */
            <div className="p-5 space-y-4 max-w-4xl mx-auto animate-pulse">
              <div className="rounded-[8px] border-2 border-foreground/20 bg-card p-4">
                <div className="flex gap-3 mb-4">
                  <div className="h-7 w-48 rounded bg-muted" />
                  <div className="h-6 w-20 rounded bg-muted" />
                  <div className="h-6 w-20 rounded bg-muted" />
                </div>
                <div className="h-4 w-full rounded bg-muted mb-2" />
                <div className="h-4 w-3/4 rounded bg-muted mb-4" />
                <div className="flex gap-3 justify-center">
                  {[1,2,3].map(i => <div key={i} className="h-32 w-28 rounded-[6px] bg-muted" />)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-[8px] border-2 border-foreground/20 h-48 bg-card" />
                <div className="rounded-[8px] border-2 border-foreground/20 h-48 bg-card" />
              </div>
              <div className="rounded-[8px] border-2 border-foreground/20 h-40 bg-card" />
            </div>
          ) : !selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Fingerprint className="h-12 w-12 opacity-30" />
              <p className="text-sm">
                {t("Select a person from the list")}
              </p>
            </div>
          ) : (
            <DossierDetailPane d={selected} onPrint={() => window.print()} />
          )}
        </main>
      </div>
    </Shell>
  );
}

// ── Detail pane ──────────────────────────────────────────────────────────
function DossierDetailPane({ d, onPrint }: { d: DossierDetail; onPrint: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

  return (
    <div className="p-5 space-y-5 max-w-4xl mx-auto" id="dossier-print-area">
      {/* Header band */}
      <div className="rounded-[8px] border-2 border-foreground bg-card p-4 print:border-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold text-foreground">{d.full_name}</h1>
              <RiskBadge level={d.risk_level} />
              {d.wanted_status && (
                <span className={`inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10px] font-bold uppercase ${WANTED_BG[d.wanted_status] ?? "bg-muted"}`}>
                  {d.wanted_status}
                </span>
              )}
              <span className="inline-flex items-center rounded-[4px] border border-yellow-400 bg-yellow-50 px-2 py-0.5 text-[9px] font-bold text-yellow-700">
                {t("DEMO — fictional")}
              </span>
            </div>
            {d.aliases && d.aliases.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("Also known as")}: {d.aliases.join(", ")}
              </p>
            )}
            <p className="mt-1 text-sm text-foreground/80 max-w-xl">{d.summary}</p>
          </div>
          <button
            onClick={onPrint}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-[6px] border-2 border-foreground bg-muted px-3 py-1.5 text-xs font-bold hover:bg-card transition"
          >
            <Printer className="h-3.5 w-3.5" /> {t("Print / Export PDF")}
          </button>
        </div>

        {/* Face card */}
        <div className="mt-4">
          <FaceCard front={d.photo_front} left={d.photo_left} right={d.photo_right} name={d.full_name} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Personal & Physical */}
        <Section icon={User} title={t("Personal & Physical")}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label={t("Gender")} value={tData("gender", d.gender, lang)} />
            <Field label={t("Date of Birth")} value={d.dob ?? "—"} />
            <Field label={t("Age")} value={d.age != null ? `${d.age} ${t("years")}` : null} />
            <Field label={t("Height")} value={d.height_cm != null ? `${d.height_cm} cm` : null} />
            <Field label={t("Build")} value={d.build} />
            <Field label={t("Complexion")} value={d.complexion} />
            <Field label={t("Blood Group")} value={d.blood_group} />
            <Field label={t("Nationality")} value={d.nationality} />
          </div>
          {d.identifying_marks && (
            <div className="mt-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Identifying Marks")}</div>
              <div className="mt-0.5 rounded-[4px] border border-border bg-muted/30 px-2 py-1 text-xs font-medium">{d.identifying_marks}</div>
            </div>
          )}
        </Section>

        {/* Contact details */}
        <Section icon={Phone} title={t("Contact Details")}>
          <div className="space-y-2">
            <Field label={t("Primary Phone")} value={d.primary_phone} />
            <Field label={t("Secondary Phone")} value={d.secondary_phone} />
            <Field label={t("Email")} value={d.email} />
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Home Address")}</div>
            <div className="mt-0.5 text-sm">{d.home_address ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{tData("district", d.district, lang)} — {d.pincode}</div>
          </div>
        </Section>
      </div>

      {/* Bank Accounts */}
      <Section icon={Banknote} title={`${t("Bank Accounts")} — ${d.bank_account_count} ${t("accounts")} · ${fmt(Number(d.total_balance_inr))} ${t("total")}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-foreground text-left">
                <th className="pb-1.5 font-bold pr-3">{t("Bank")}</th>
                <th className="pb-1.5 font-bold pr-3">{t("Account No.")}</th>
                <th className="pb-1.5 font-bold pr-3">IFSC</th>
                <th className="pb-1.5 font-bold pr-3">{t("Type")}</th>
                <th className="pb-1.5 font-bold pr-3 text-right">{t("Balance")}</th>
                <th className="pb-1.5 font-bold pr-3">{t("Status")}</th>
                <th className="pb-1.5 font-bold">{t("Flag")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.banks.map(b => (
                <tr key={b.id} className={b.flagged ? "bg-destructive/5" : ""}>
                  <td className="py-1.5 pr-3 font-medium">{b.bank_name}</td>
                  <td className="py-1.5 pr-3 font-mono">{b.account_no}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{b.ifsc ?? "—"}</td>
                  <td className="py-1.5 pr-3">{t(b.account_type ?? "") || "—"}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{b.balance_inr != null ? fmt(Number(b.balance_inr)) : "—"}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold ${b.status === "Frozen" ? "bg-destructive/20 text-destructive" : b.status === "Dormant" ? "bg-muted text-muted-foreground" : "bg-green-100 text-green-800"}`}>
                      {t(b.status ?? "")}
                    </span>
                  </td>
                  <td className="py-1.5">
                    {b.flagged ? (
                      <span title={b.flag_reason ?? ""} className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        <span className="text-[9px] max-w-[120px] truncate">{b.flag_reason}</span>
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Crime History */}
      <Section icon={Scale} title={`${t("Crime History")} — ${d.crimes.length} ${t("records")} · ${d.open_case_count} ${t("open")}`}>
        <div className="space-y-3">
          {d.crimes.map(c => (
            <div key={c.id} className={`rounded-[6px] border-2 p-3 ${c.status === "Open" ? "border-destructive/60 bg-destructive/5" : c.status === "Convicted" ? "border-purple-500/40 bg-purple-50/40 dark:bg-purple-900/10" : "border-foreground bg-background"}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold">{c.case_ref}</span>
                  <span className="font-semibold text-xs">{tData("crime_type", c.crime_type, lang)}</span>
                  {c.role && <span className="rounded-[3px] border border-border bg-muted px-1.5 py-0.5 text-[9px]">{tData("role", c.role, lang)}</span>}
                </div>
                {c.status && (
                  <span className={`shrink-0 rounded-[4px] px-2 py-0.5 text-[9px] font-bold ${c.status === "Open" ? "bg-destructive text-destructive-foreground" : c.status === "Convicted" ? "bg-purple-600 text-white" : c.status === "Chargesheeted" ? "bg-orange-400 text-foreground" : "bg-muted text-muted-foreground"}`}>
                    {tData("status", c.status, lang)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                {c.occurred_on && <span>📅 {c.occurred_on}</span>}
                {c.station && <span>🏛 {tData("station", c.station, lang)}</span>}
                {c.sections && <span className="font-mono">§ {c.sections}</span>}
              </div>
              {c.sentence && <p className="mt-1 text-[10px] font-medium text-purple-700 dark:text-purple-300">{t("Sentence")}: {c.sentence}</p>}
              {c.narrative && <p className="mt-1 text-[11px] text-foreground/75 leading-snug">{c.narrative}</p>}
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Family */}
        <Section icon={Users} title={t("Family Members")}>
          {d.family.length === 0 ? <p className="text-xs text-muted-foreground">{t("No records.")}</p> : (
            <div className="space-y-2">
              {d.family.map(f => (
                <div key={f.id} className="rounded-[6px] border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{f.name}</span>
                    <span className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[9px] font-medium">{f.relation}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    {f.age && <span>Age {f.age}</span>}
                    {f.phone && <span>{f.phone}</span>}
                    {f.occupation && <span>{f.occupation}</span>}
                  </div>
                  {f.notes && <p className="mt-0.5 text-[10px] italic text-muted-foreground">{f.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Contacts / Known associates */}
        <Section icon={Contact} title={t("Known Associates / Contacts")}>
          {d.contacts.length === 0 ? <p className="text-xs text-muted-foreground">{t("No records.")}</p> : (
            <div className="space-y-2">
              {d.contacts.map(c => (
                <div key={c.id} className="rounded-[6px] border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{c.name ?? "Unknown"}</span>
                    {c.label && <span className="rounded-[3px] bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 text-[9px] font-medium text-orange-800 dark:text-orange-300">{c.label}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    {c.relation && <span>{c.relation}</span>}
                    {c.phone && <span>{c.phone}</span>}
                  </div>
                  {c.notes && <p className="mt-0.5 text-[10px] italic text-muted-foreground">{c.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
