import { useEffect, useRef, useState } from "react";
import {
  X,
  Users,
  Trash2,
  AlertTriangle,
  Check,
  Loader2,
  RefreshCcw,
  UserPlus,
  Inbox,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

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

type FetchState = "loading" | "ready" | "error";

function Avatar({ acc, size = "md" }: { acc: Account; size?: "sm" | "md" | "lg" }) {
  const dim =
    size === "lg"
      ? "h-12 w-12 text-base"
      : size === "sm"
        ? "h-7 w-7 text-[10px]"
        : "h-9 w-9 text-xs";
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

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[5px] border-2 border-foreground/30 bg-background px-3 py-2.5">
      <div className="h-9 w-9 animate-pulse rounded-[5px] border-2 border-foreground/30 bg-foreground/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/2 animate-pulse rounded bg-foreground/15" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-foreground/10" />
        <div className="h-2.5 w-20 animate-pulse rounded bg-foreground/10" />
      </div>
      <div className="h-7 w-20 animate-pulse rounded-[5px] border-2 border-foreground/20 bg-foreground/5" />
    </div>
  );
}

export function AccountManager({
  open,
  onClose,
  accounts,
  activeId,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  activeId: string;
  onChange: (next: Account[], nextActive: string) => void;
}) {
  const { t } = useI18n();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [fetchError, setFetchError] = useState<string>("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const retryRef = useRef(0);

  // Simulated fetch on open. First open succeeds; injects a transient
  // failure roughly every other reopen to exercise the error state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFetchState("loading");
    setFetchError("");
    setRowError(null);
    const fail = retryRef.current > 0 && retryRef.current % 2 === 1;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      if (fail) {
        setFetchState("error");
        setFetchError(
          t("Could not load your linked accounts. Check your connection and try again."),
        );
      } else {
        setFetchState("ready");
      }
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, t]);

  if (!open) return null;

  const canRemove = accounts.length > 1;

  const retryFetch = () => {
    retryRef.current += 1;
    setFetchState("loading");
    setFetchError("");
    window.setTimeout(() => setFetchState("ready"), 700);
  };

  const doRemove = async (id: string) => {
    setConfirmId(null);
    setRemovingId(id);
    setRowError(null);
    await new Promise((r) => setTimeout(r, 700));
    // Simulate a server failure when removing the "shankar" account so the
    // per-row error state is visible.
    if (id === "shankar") {
      setRemovingId(null);
      setRowError({ id, msg: t("Server rejected the request. Please retry.") });
      return;
    }
    const next = accounts.filter((a) => a.id !== id);
    let nextActive = activeId;
    if (id === activeId) nextActive = next[0]?.id ?? "";
    onChange(next, nextActive);
    setRemovingId(null);
  };

  const isEmpty = fetchState === "ready" && accounts.length === 0;

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background text-foreground nb-shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-busy={fetchState === "loading"}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <h2 className="text-lg font-extrabold tracking-tight">{t("Manage accounts")}</h2>
            {fetchState === "loading" && (
              <Loader2 className="h-4 w-4 animate-spin opacity-80" aria-label={t("Loading")} />
            )}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-foreground/50">
              {fetchState === "ready"
                ? `${t("Linked accounts")} (${accounts.length})`
                : t("Linked accounts")}
            </div>
            {fetchState === "ready" && !isEmpty && (
              <button
                onClick={retryFetch}
                className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                title={t("Refresh")}
              >
                <RefreshCcw className="h-3 w-3" /> {t("Refresh")}
              </button>
            )}
          </div>

          {/* Loading state */}
          {fetchState === "loading" && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}

          {/* Error state */}
          {fetchState === "error" && (
            <div
              role="alert"
              className="flex flex-col items-center gap-3 rounded-[5px] border-2 border-foreground bg-destructive/15 p-6 text-center nb-shadow-sm"
            >
              <div className="grid h-12 w-12 place-items-center rounded-[5px] border-2 border-foreground bg-destructive text-destructive-foreground nb-shadow-sm">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <div className="text-sm font-extrabold">{t("Couldn't load accounts")}</div>
                <p className="mt-1 text-xs font-bold text-foreground/70">{fetchError}</p>
              </div>
              <button
                onClick={retryFetch}
                className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> {t("Try again")}
              </button>
            </div>
          )}

          {/* Empty state */}
          {isEmpty && (
            <div className="flex flex-col items-center gap-3 rounded-[5px] border-2 border-dashed border-foreground/60 bg-background p-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-sm">
                <Inbox className="h-6 w-6" />
              </div>
              <div>
                <div className="text-sm font-extrabold">{t("No accounts linked yet")}</div>
                <p className="mt-1 text-xs font-bold text-foreground/65">
                  {t("Add a workspace account to start switching between identities.")}
                </p>
              </div>
              <button className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none">
                <UserPlus className="h-3.5 w-3.5" /> {t("Add an account")}
              </button>
            </div>
          )}

          {/* Ready state list */}
          {fetchState === "ready" && !isEmpty && (
            <div className="flex flex-col gap-2">
              {accounts.map((acc) => {
                const isActive = acc.id === activeId;
                const isRemoving = removingId === acc.id;
                const hasError = rowError?.id === acc.id;
                return (
                  <div
                    key={acc.id}
                    className={`flex flex-col gap-2 rounded-[5px] border-2 px-3 py-2.5 transition ${
                      isActive
                        ? "border-foreground bg-primary/10"
                        : "border-foreground/40 bg-background hover:border-foreground"
                    } ${isRemoving ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar acc={acc} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-extrabold">{acc.name}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-[3px] border-2 border-foreground bg-primary/20 px-1.5 py-px text-[10px] font-extrabold text-primary">
                              <Check className="h-2.5 w-2.5" /> {t("Active")}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] font-bold text-foreground/60">
                          {acc.role} · {acc.workspace}
                        </div>
                        <div className="mt-0.5 inline-block rounded-[3px] border-2 border-foreground bg-primary/10 px-1.5 py-px font-mono text-[10px] font-bold">
                          {acc.badge}
                        </div>
                      </div>

                      <button
                        disabled={!canRemove || isRemoving || !!removingId}
                        onClick={() => setConfirmId(acc.id)}
                        className="flex shrink-0 items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1.5 text-[11px] font-extrabold text-destructive nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          canRemove
                            ? t("Remove from switcher")
                            : t("Cannot remove the only account")
                        }
                      >
                        {isRemoving ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Removing…")}
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-3.5 w-3.5" /> {t("Remove")}
                          </>
                        )}
                      </button>
                    </div>

                    {hasError && (
                      <div
                        role="alert"
                        className="flex items-center justify-between gap-2 rounded-[5px] border-2 border-destructive bg-destructive/15 px-2.5 py-1.5 text-[11px] font-bold"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{rowError!.msg}</span>
                        </span>
                        <button
                          onClick={() => doRemove(acc.id)}
                          className="flex items-center gap-1 rounded-[3px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide hover:translate-x-[2px] hover:translate-y-[2px] transition"
                        >
                          <RefreshCcw className="h-3 w-3" /> {t("Retry")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {fetchState === "ready" && !isEmpty && !canRemove && (
            <div className="mt-3 flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-warning/20 p-3 text-xs font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t(
                "You must keep at least one account. Add another account before removing this one.",
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Close")}
          </button>
        </div>
      </div>

      {/* Remove confirmation */}
      {confirmId && (
        <div
          className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={() => setConfirmId(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background text-foreground nb-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b-2 border-foreground bg-header px-4 py-3 text-header-foreground">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="text-sm font-extrabold uppercase tracking-wide">
                {t("Remove account?")}
              </h3>
            </div>
            <div className="p-4 text-sm">
              <p className="font-bold">{t("This account will be removed from the switcher.")}</p>
              {confirmId === activeId && (
                <p className="mt-2 text-xs font-bold text-foreground/70">
                  {t(
                    "It is currently active. After removal you will be switched to another account.",
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-4 py-3">
              <button
                onClick={() => setConfirmId(null)}
                className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1.5 text-xs font-extrabold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={() => doRemove(confirmId)}
                className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-destructive px-3 py-1.5 text-xs font-extrabold text-destructive-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("Remove account")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
