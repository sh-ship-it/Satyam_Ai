import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, UserPlus, LogOut, UserCog, Camera, Upload, Loader2, ArrowRightLeft, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AccountManager } from "./AccountManager";
import avatarKumar from "@/assets/avatar-kumar.jpg";

type Account = {
  id: string;
  name: string;
  role: string;
  workspace: string;
  badge: string;
  photo?: string;
  initials: string;
  tone: string;
};

const SEED_ACCOUNTS: Account[] = [
  {
    id: "kumar",
    name: "R. Kumar",
    role: "Inspector",
    workspace: "KSP Workspace",
    badge: "KSP-08842",
    photo: avatarKumar,
    initials: "RK",
    tone: "bg-primary text-primary-foreground",
  },
  {
    id: "shankar",
    name: "P. Shankar",
    role: "Sub-Inspector",
    workspace: "KSP · Whitefield PS",
    badge: "KSP-11204",
    initials: "PS",
    tone: "bg-warning text-warning-foreground",
  },
  {
    id: "meera",
    name: "Meera N.",
    role: "Analyst",
    workspace: "CCB Workspace",
    badge: "CCB-00219",
    initials: "MN",
    tone: "bg-destructive text-destructive-foreground",
  },
];

function Avatar({ acc, size = "md" }: { acc: Account; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-base" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  if (acc.photo) {
    return (
      <img
        src={acc.photo}
        alt={acc.name}
        loading="lazy"
        width={96}
        height={96}
        className={`${dim} rounded-[5px] border-2 border-foreground object-cover nb-shadow-sm`}
      />
    );
  }
  return (
    <div
      className={`${dim} ${acc.tone} grid place-items-center rounded-[5px] border-2 border-foreground font-extrabold nb-shadow-sm`}
    >
      {acc.initials}
    </div>
  );
}

type SwitchPhase = "idle" | "confirm" | "loading" | "done";

const RELOAD_STEPS = [
  "Signing out current session",
  "Authenticating new identity",
  "Loading workspace permissions",
  "Refreshing case data",
] as const;

const LS_ACCOUNTS = "satyam.profile.accounts";
const LS_ACTIVE = "satyam.profile.activeId";

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(LS_ACCOUNTS);
    if (raw) return JSON.parse(raw) as Account[];
  } catch {}
  return SEED_ACCOUNTS;
}

function loadActiveId(): string {
  try {
    const raw = localStorage.getItem(LS_ACTIVE);
    if (raw) return raw;
  } catch {}
  return "kumar";
}

export function ProfileMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [activeId, setActiveId] = useState<string>(loadActiveId);
  const [photoEditor, setPhotoEditor] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<SwitchPhase>("idle");
  const [stepIdx, setStepIdx] = useState(0);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = accounts.find((a) => a.id === activeId)!;
  const pending = pendingId ? accounts.find((a) => a.id === pendingId) : null;

  useEffect(() => {
    localStorage.setItem(LS_ACCOUNTS, JSON.stringify(accounts));
  }, [accounts]);

  useEffect(() => {
    localStorage.setItem(LS_ACTIVE, activeId);
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onPickPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setAccounts((prev) => prev.map((a) => (a.id === active.id ? { ...a, photo: url } : a)));
      setPhotoEditor(false);
    };
    reader.readAsDataURL(file);
  };

  const requestSwitch = (id: string) => {
    if (id === activeId) return;
    setPendingId(id);
    setPhase("confirm");
    setOpen(false);
  };

  const cancelSwitch = () => {
    if (phase === "loading") return;
    setPendingId(null);
    setPhase("idle");
    setStepIdx(0);
  };

  const confirmSwitch = async () => {
    if (!pendingId) return;
    setPhase("loading");
    setStepIdx(0);
    for (let i = 0; i < RELOAD_STEPS.length; i++) {
      setStepIdx(i);
      await new Promise((r) => setTimeout(r, 550));
    }
    setActiveId(pendingId);
    setPhase("done");
    await new Promise((r) => setTimeout(r, 700));
    setPendingId(null);
    setPhase("idle");
    setStepIdx(0);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[5px] border-2 border-header-foreground bg-secondary-background pl-1.5 pr-2 py-1 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar acc={active} size="sm" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-extrabold">{active.name}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-foreground/60">
            {active.role} · {active.workspace}
          </span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-[900] w-[320px] overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background text-foreground nb-shadow-lg"
        >
          <div className="flex items-center gap-3 border-b-2 border-foreground bg-background p-3">
            <div className="relative">
              <Avatar acc={active} size="lg" />
              <button
                onClick={() => setPhotoEditor(true)}
                className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground"
                aria-label={t("Change photo")}
              >
                <Camera className="h-2.5 w-2.5" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold">{active.name}</div>
              <div className="truncate text-[11px] font-bold text-foreground/60">
                {active.role} · {active.workspace}
              </div>
              <div className="mt-0.5 inline-block rounded-[3px] border-2 border-foreground bg-primary/15 px-1.5 py-px font-mono text-[10px] font-bold">
                {active.badge}
              </div>
            </div>
          </div>

          <div className="border-b-2 border-foreground p-2">
            <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-foreground/50">
              {t("Switch account")}
            </div>
            <div className="flex flex-col gap-1">
              {accounts.map((acc) => {
                const isActive = acc.id === activeId;
                return (
                  <button
                    key={acc.id}
                    onClick={() => requestSwitch(acc.id)}
                    className={`flex items-center gap-2.5 rounded-[5px] border-2 px-2 py-1.5 text-left transition ${
                      isActive
                        ? "border-foreground bg-primary/15"
                        : "border-transparent hover:border-foreground hover:bg-background"
                    }`}
                  >
                    <Avatar acc={acc} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">{acc.name}</div>
                      <div className="truncate text-[10px] font-bold text-foreground/55">
                        {acc.role} · {acc.workspace}
                      </div>
                    </div>
                    {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
            <button className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-[5px] border-2 border-dashed border-foreground/60 px-2 py-1.5 text-xs font-bold text-foreground/70 hover:border-foreground hover:bg-background hover:text-foreground">
              <UserPlus className="h-3.5 w-3.5" /> {t("Add another account")}
            </button>
          </div>

          <div className="flex flex-col p-2">
            <button
              onClick={() => { setOpen(false); setAccountsOpen(true); }}
              className="flex items-center gap-2 rounded-[5px] border-2 border-transparent px-2 py-1.5 text-xs font-bold hover:border-foreground hover:bg-background"
            >
              <Users className="h-3.5 w-3.5" /> {t("Manage accounts")}
            </button>
            <button
              onClick={() => { setOpen(false); onOpenSettings(); }}
              className="flex items-center gap-2 rounded-[5px] border-2 border-transparent px-2 py-1.5 text-xs font-bold hover:border-foreground hover:bg-background"
            >
              <UserCog className="h-3.5 w-3.5" /> {t("Profile & settings")}
            </button>
            <button className="flex items-center gap-2 rounded-[5px] border-2 border-transparent px-2 py-1.5 text-xs font-bold text-destructive hover:border-foreground hover:bg-destructive hover:text-destructive-foreground">
              <LogOut className="h-3.5 w-3.5" /> {t("Sign out")}
            </button>
          </div>
        </div>
      )}

      {/* Photo editor */}
      {photoEditor && (
        <div
          className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={() => setPhotoEditor(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background text-foreground nb-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b-2 border-foreground bg-header px-4 py-2.5 text-sm font-extrabold uppercase tracking-wide text-header-foreground">
              {t("Update profile photo")}
            </div>
            <div className="flex flex-col items-center gap-3 p-4">
              <Avatar acc={active} size="lg" />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                <Upload className="h-3.5 w-3.5" /> {t("Upload from device")}
              </button>
              {active.photo && (
                <button
                  onClick={() => {
                    setAccounts((p) => p.map((a) => (a.id === active.id ? { ...a, photo: undefined } : a)));
                    setPhotoEditor(false);
                  }}
                  className="w-full rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-2 text-xs font-bold nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  {t("Remove photo")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Switch account confirm + reload */}
      {pending && phase !== "idle" && (
        <div
          className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={cancelSwitch}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background text-foreground nb-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b-2 border-foreground bg-header px-4 py-2.5 text-sm font-extrabold uppercase tracking-wide text-header-foreground">
              <ArrowRightLeft className="h-4 w-4" />
              {phase === "confirm" && t("Switch account?")}
              {phase === "loading" && t("Loading workspace…")}
              {phase === "done" && t("Workspace ready")}
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between gap-3 rounded-[5px] border-2 border-foreground bg-background p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar acc={active} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-extrabold">{active.name}</div>
                    <div className="truncate text-[10px] font-bold text-foreground/55">{active.workspace}</div>
                  </div>
                </div>
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-foreground/60" />
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar acc={pending} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-extrabold">{pending.name}</div>
                    <div className="truncate text-[10px] font-bold text-foreground/55">{pending.workspace}</div>
                  </div>
                </div>
              </div>

              {phase === "confirm" && (
                <p className="mt-3 text-xs font-bold text-foreground/70">
                  {t("Switching ends the current session and reloads cases, permissions, and dashboards for the selected workspace. Unsaved drafts may be lost.")}
                </p>
              )}

              {(phase === "loading" || phase === "done") && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {RELOAD_STEPS.map((label, i) => {
                    const state =
                      phase === "done" || i < stepIdx ? "done" : i === stepIdx ? "active" : "pending";
                    return (
                      <li
                        key={label}
                        className={`flex items-center gap-2 rounded-[5px] border-2 px-2 py-1.5 text-[11px] font-bold ${
                          state === "done"
                            ? "border-foreground bg-primary/15"
                            : state === "active"
                              ? "border-foreground bg-background"
                              : "border-transparent text-foreground/50"
                        }`}
                      >
                        {state === "done" ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : state === "active" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-foreground/30" />
                        )}
                        {t(label)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {phase === "confirm" && (
              <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background p-3">
                <button
                  onClick={cancelSwitch}
                  className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1.5 text-xs font-extrabold nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  {t("Cancel")}
                </button>
                <button
                  onClick={confirmSwitch}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground nb-shadow-sm hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  {t("Switch & reload")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <AccountManager
        open={accountsOpen}
        onClose={() => setAccountsOpen(false)}
        accounts={accounts}
        activeId={activeId}
        onChange={(next, nextActive) => {
          setAccounts(next);
          setActiveId(nextActive);
        }}
      />
    </div>
  );
}
