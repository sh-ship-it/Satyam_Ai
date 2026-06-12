import { useEffect, useState } from "react";
import { X, User, Bell, Lock, Monitor, Database, LogOut, Check, Download, Trash2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Tab = "profile" | "preferences" | "notifications" | "security" | "data";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>("profile");

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "profile", label: t("Profile"), icon: User },
    { id: "preferences", label: t("Preferences"), icon: Monitor },
    { id: "notifications", label: t("Notifications"), icon: Bell },
    { id: "security", label: t("Security"), icon: Lock },
    { id: "data", label: t("Data & Privacy"), icon: Database },
  ];

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
          <h2 className="text-lg font-extrabold tracking-tight">{t("Settings")}</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-[200px_1fr] min-h-[440px]">
          {/* Sidebar */}
          <aside className="border-r-2 border-foreground bg-background p-3">
            <nav className="flex flex-col gap-1.5">
              {tabs.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-2 rounded-[5px] border-2 px-3 py-2 text-sm font-bold transition ${
                      active
                        ? "border-foreground bg-primary text-primary-foreground nb-shadow-sm"
                        : "border-transparent text-foreground/70 hover:border-foreground hover:bg-secondary-background hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="overflow-auto p-6">
            {tab === "profile" && (
              <Section title={t("Profile")} subtitle={t("Your investigator details")}>
                <div className="flex items-center gap-4">
                  <div className="grid h-16 w-16 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-lg font-extrabold text-primary-foreground nb-shadow-sm">
                    RK
                  </div>
                  <div>
                    <div className="text-base font-bold">R. Kumar</div>
                    <div className="text-sm text-foreground/60">Inspector · KSP Workspace</div>
                  </div>
                </div>
                <Field label={t("Full name")} defaultValue="R. Kumar" />
                <Field label={t("Email")} defaultValue="r.kumar@ksp.gov.in" />
                <Field label={t("Badge ID")} defaultValue="KSP-08842" />
                <Field label={t("Station")} defaultValue="Whitefield PS" />
              </Section>
            )}

            {tab === "preferences" && (
              <Section title={t("Preferences")} subtitle={t("Workspace appearance & language")}>
                <Row label={t("Language")}>
                  <div className="flex gap-2">
                    <Pill active={lang === "EN"} onClick={() => setLang("EN")}>EN</Pill>
                    <Pill active={lang === "KN"} onClick={() => setLang("KN")}>
                      <span className="font-kn">ಕನ್ನಡ</span>
                    </Pill>
                  </div>
                </Row>
                <Row label={t("Default landing")}>
                  <Select options={[t("Console"), t("Map"), t("Network"), t("Reports")]} />
                </Row>
                <Row label={t("Density")}>
                  <Select options={[t("Comfortable"), t("Compact")]} />
                </Row>
                <Row label={t("Time format")}>
                  <Select options={["24-hour", "12-hour"]} />
                </Row>
              </Section>
            )}

            {tab === "notifications" && (
              <Section title={t("Notifications")} subtitle={t("Choose what alerts you receive")}>
                <Toggle label={t("New FIR assignments")} defaultOn />
                <Toggle label={t("Case status updates")} defaultOn />
                <Toggle label={t("Hotspot alerts")} defaultOn />
                <Toggle label={t("Weekly summary email")} />
                <Toggle label={t("Sound on new message")} />
              </Section>
            )}

            {tab === "security" && (
              <Section title={t("Security")} subtitle={t("Protect your account")}>
                <Field label={t("Current password")} type="password" defaultValue="••••••••" />
                <Field label={t("New password")} type="password" placeholder="••••••••" />
                <Toggle label={t("Two-factor authentication (TOTP)")} defaultOn />
                <Toggle label={t("Require MFA on every sign-in")} />
                <div className="rounded-[5px] border-2 border-foreground bg-warning/20 p-3 text-xs font-bold">
                  {t("Last sign-in: today, 09:42 from Bengaluru (Chrome · Windows)")}
                </div>
              </Section>
            )}

            {tab === "data" && (
              <Section title={t("Data & Privacy")} subtitle={t("Manage workspace data")}>
                <Toggle label={t("Allow analytics on query patterns")} defaultOn />
                <Toggle label={t("Share anonymized usage with KSP IT")} />
                <DataActions t={t} />
              </Section>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm"
          >
            <Check className="h-4 w-4" /> {t("Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-foreground/60">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label, defaultValue, type = "text", placeholder,
}: { label: string; defaultValue?: string; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide">{label}</span>
      <input
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm font-medium nb-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <span className="text-sm font-bold">{label}</span>
      {children}
    </div>
  );
}

function Select({ options }: { options: string[] }) {
  return (
    <select className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1.5 text-sm font-bold">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[5px] border-2 border-foreground px-3 py-1 text-xs font-extrabold transition ${
        active ? "bg-primary text-primary-foreground nb-shadow-sm" : "bg-secondary-background text-foreground/60"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, defaultOn }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="flex items-center justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <span className="text-sm font-bold">{label}</span>
      <button
        onClick={() => setOn(!on)}
        className={`relative h-6 w-11 rounded-[5px] border-2 border-foreground transition ${on ? "bg-primary" : "bg-secondary-background"}`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-[3px] border-2 border-foreground bg-secondary-background transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

type Status = { kind: "idle" } | { kind: "exporting" } | { kind: "exported"; file: string } | { kind: "deleting" };

const DELETION_KEY = "satyam.account.deletionScheduledAt";
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function formatRemaining(ms: number) {
  if (ms <= 0) return "0d 0h 0m 0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function DataActions({ t }: { t: (s: string) => string }) {
  const [confirm, setConfirm] = useState<null | "export" | "delete">(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [typed, setTyped] = useState("");
  const [scheduledAt, setScheduledAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(DELETION_KEY);
    return v ? Number(v) : null;
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (scheduledAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [scheduledAt]);

  const remaining = scheduledAt ? scheduledAt + GRACE_MS - now : 0;

  const doExport = async () => {
    setStatus({ kind: "exporting" });
    const payload = {
      exportedAt: new Date().toISOString(),
      user: { name: "R. Kumar", email: "r.kumar@ksp.gov.in", badge: "KSP-08842" },
      activity: [
        { ts: new Date().toISOString(), action: "signed_in", ip: "10.0.4.21" },
        { ts: new Date().toISOString(), action: "viewed_case", id: "FIR-2026-00421" },
      ],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const file = `satyam-data-${Date.now()}.json`;
    a.href = url; a.download = file; a.click();
    URL.revokeObjectURL(url);
    setConfirm(null);
    setStatus({ kind: "exported", file });
  };

  const doDelete = async () => {
    setStatus({ kind: "deleting" });
    await new Promise((r) => setTimeout(r, 600));
    const ts = Date.now();
    window.localStorage.setItem(DELETION_KEY, String(ts));
    setScheduledAt(ts);
    setNow(Date.now());
    setConfirm(null);
    setTyped("");
    setStatus({ kind: "idle" });
  };

  const cancelDeletion = () => {
    window.localStorage.removeItem(DELETION_KEY);
    setScheduledAt(null);
  };

  const finalizeOn = scheduledAt ? new Date(scheduledAt + GRACE_MS) : null;

  return (
    <>
      <button
        onClick={() => { setStatus({ kind: "idle" }); setConfirm("export"); }}
        className="flex w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
      >
        <Download className="h-4 w-4" /> {t("Export my account data")}
      </button>
      <button
        disabled={scheduledAt !== null}
        onClick={() => { setStatus({ kind: "idle" }); setTyped(""); setConfirm("delete"); }}
        className="flex w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" /> {t("Delete my account data")}
      </button>

      {status.kind === "exported" && (
        <div className="flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary/20 p-3 text-xs font-bold">
          <Check className="h-4 w-4" /> {t("Export downloaded:")} {status.file}
        </div>
      )}

      {scheduledAt !== null && (
        <div className="space-y-2 rounded-[5px] border-2 border-foreground bg-destructive/15 p-3 nb-shadow-sm">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide">
            <AlertTriangle className="h-4 w-4" /> {t("Deletion scheduled")}
          </div>
          <div className="text-xs font-bold">
            {t("Your account will be permanently deleted in")}{" "}
            <span className="rounded-[3px] border-2 border-foreground bg-background px-1.5 py-0.5 font-mono">
              {formatRemaining(remaining)}
            </span>
          </div>
          {finalizeOn && (
            <div className="text-[11px] font-bold text-foreground/70">
              {t("Finalizes on")} {finalizeOn.toLocaleString()}
            </div>
          )}
          <button
            onClick={cancelDeletion}
            className="mt-1 w-full rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Cancel deletion")}
          </button>
        </div>
      )}


      {confirm && (
        <div
          className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b-2 border-foreground bg-header px-4 py-3 text-header-foreground">
              {confirm === "delete" ? <AlertTriangle className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              <h3 className="text-sm font-extrabold uppercase tracking-wide">
                {confirm === "export" ? t("Confirm data export") : t("Confirm account deletion")}
              </h3>
            </div>
            <div className="space-y-3 p-4 text-sm">
              {confirm === "export" ? (
                <p>{t("A JSON file containing your profile, preferences, and activity log will be downloaded to this device. Continue?")}</p>
              ) : (
                <>
                  <div className="rounded-[5px] border-2 border-foreground bg-destructive/15 p-3 text-xs font-bold">
                    {t("Your account enters a 7-day grace period. After 7 days it is permanently removed along with cases assigned only to you and your activity logs. You can cancel anytime during the grace period.")}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide">{t("Type DELETE to confirm")}</span>
                    <input
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm font-bold nb-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-4 py-3">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-2 text-xs font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                {t("Cancel")}
              </button>
              {confirm === "export" ? (
                <button
                  onClick={doExport}
                  disabled={status.kind === "exporting"}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm disabled:opacity-60"
                >
                  <Download className="h-4 w-4" /> {status.kind === "exporting" ? t("Preparing…") : t("Download export")}
                </button>
              ) : (
                <button
                  onClick={doDelete}
                  disabled={typed !== "DELETE" || status.kind === "deleting"}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-destructive px-3 py-2 text-xs font-extrabold text-destructive-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> {status.kind === "deleting" ? t("Scheduling…") : t("Schedule deletion (7 days)")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

