# Satyam — Build Prompt: Admin "Access Control" screen (L4-only)

**Paste this whole file into your coding AI working inside the `Satyam_Ai-main` repo.** It adds a
new **top-priority-admin-only** screen where an **L4** officer (DGP / ADGP / IGP / SP / `admin`) can:

1. **See who created each account** (account creator + when), and
2. **Change a person's policy** — rank, clearance (L1–L4), jurisdiction scope, and active/disabled —
   so an officer can be granted higher (or lower) access.

It matches the existing codebase conventions exactly:
- Backend: FastAPI routers in `backend/app/api/routes/`, RBAC in `backend/app/core/rbac.py`
  (`Permission.ADMIN` already requires **clearance ≥ 4**), hash-chained audit via
  `app.core.audit.write_audit`, JWT issued in `app/core/security.py`.
- Frontend: TanStack flat routes in `frontend/src/routes/`, neobrutalist styling
  (`border-2 border-foreground`, `nb-shadow*`, `rounded-[5px]`), `useT()` i18n, lucide-react icons,
  API via `frontend/src/lib/api/client.ts`.

> ⚠️ This is a privilege-management screen. Every change is **audit-logged** and the acting admin
> **cannot demote/disable themselves** (anti-lockout). Self-registration stays dev-only as today.

---

## 0) Data model gap (read first)
`users` today has: `user_id, username, password_hash, full_name, email, photo_b64, officer_id,
assigned_rank (FK rank_access.rank), is_active, created_at`. It has **no** `created_by`, and
clearance/scope are derived from `assigned_rank` only. To support "who created it" + manual
clearance/scope overrides, we add three nullable columns. Existing rows stay valid (NULL = "self /
system", and NULL overrides = "derive from rank" exactly like today).

---

## 1) Migration — `backend/migrations/006_admin_access_control.sql`
```sql
-- 006_admin_access_control.sql
-- Adds account-creator tracking + manual clearance/scope overrides for the
-- L4-only Access Control screen. All columns nullable => backward compatible.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_by        INTEGER  NULL REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS clearance_override SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS scope_override     TEXT     NULL;

-- Sanity guards (idempotent -- safe to re-run; Postgres has no ADD CONSTRAINT IF NOT EXISTS):
DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_clearance_override
        CHECK (clearance_override IS NULL OR clearance_override BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_scope_override
        CHECK (scope_override IS NULL OR scope_override IN ('state','range','district','station'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_users_created_by ON users(created_by);
```
Run it the same way as the others (e.g. `psql "$DATABASE_URL" -f backend/migrations/006_admin_access_control.sql`),
against whichever DB `DATABASE_URL` points at (Neon or local PG).

---

## 2) ORM — edit `backend/app/db/models.py`
In `class User(Base)`, add the three columns (right after `created_at`):
```python
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    clearance_override: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    scope_override: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```
(`SmallInteger` and `Text` are already imported at the top of the file.)

---

## 3) Honor overrides at login — edit `backend/app/api/routes/auth.py`
Clearance/scope are currently derived from rank only. Make login respect the overrides so a policy
change actually grants higher access on the user's next login.

Replace the **`_build_token_and_user`** helper with this override-aware version:
```python
def _build_token_and_user(
    uid: str, name: str, rank: str, officer_id: int | None,
    clearance_override: int | None = None,
    scope_override: str | None = None,
) -> tuple[str, SessionUser]:
    clearance = clearance_override if clearance_override is not None else resolve_clearance(rank)
    scope = scope_override or resolve_scope(rank)
    geo = _DEMO_STATIONS.get(rank, _DEMO_STATIONS["investigator"])
    user = SessionUser(
        id=uid, name=name, rank=rank, scope=scope, clearance=clearance,
        station_id=geo["station_id"], district=geo["district"], range_name=geo["range"],
    )
    token = create_access_token(
        subject=uid, name=name, rank=rank, scope=scope, clearance=clearance,
        station_id=geo["station_id"], district=geo["district"], range_name=geo["range"],
        officer_id=officer_id,
    )
    return token, user
```
Then in **`login`**, where the existing user's token is built, pass the overrides:
```python
                assigned_rank = db_user.assigned_rank or "CI"
                officer_id = db_user.user_id
                token, user = _build_token_and_user(
                    username, name, assigned_rank, officer_id,
                    clearance_override=db_user.clearance_override,
                    scope_override=db_user.scope_override,
                )
                return LoginResponse(token=token, user=user)
```
> Also: blocked sign-in for disabled accounts. In `login`, right after `db_user` is loaded and
> before password verification, add:
> ```python
>                 if not db_user.is_active:
>                     raise HTTPException(status_code=403, detail="Account is disabled. Contact an administrator.")
> ```

---

## 4) Schemas — new file `backend/app/schemas/admin.py`
```python
from __future__ import annotations
from typing import Optional, Literal
from pydantic import BaseModel, Field


class AdminUserRow(BaseModel):
    user_id: int
    username: str
    full_name: str = ""
    email: Optional[str] = None
    assigned_rank: Optional[str] = None
    clearance: int                       # effective (override or rank-derived)
    scope: str                           # effective
    is_active: bool
    created_at: Optional[str] = None      # ISO string
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None  # "who created the account"
    has_override: bool = False            # manual clearance/scope set?


class AdminUserList(BaseModel):
    rows: list[AdminUserRow]
    total: int


class PolicyUpdateRequest(BaseModel):
    rank: Optional[str] = None                                   # new KSP rank / app role
    clearance: Optional[int] = Field(default=None, ge=1, le=4)   # manual override (null => clear)
    scope: Optional[Literal["state", "range", "district", "station"]] = None
    is_active: Optional[bool] = None
    reason: str = ""                                             # required for the audit trail
    clear_overrides: bool = False                                # reset clearance/scope to rank defaults
```

---

## 5) Backend router — new file `backend/app/api/routes/admin.py`
```python
"""L4-only Access Control.

Lets a top-priority admin (Permission.ADMIN => clearance >= 4) see who created each
account and change a person's policy (rank / clearance / scope / active). Every
mutation is hash-chain audit-logged. The acting admin cannot demote or disable
themselves (anti-lockout).

The users table is not jurisdiction-scoped, so we use a plain sessionmaker session
(like auth.py) rather than the RLS-scoped session.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import aliased

from app.api.deps import get_principal
from app.core.rbac import (
    AccessDenied, Permission, Principal, require,
    resolve_clearance, resolve_scope, RANK_CLEARANCE,
)
from app.core.audit import write_audit
from app.db.session import get_sessionmaker
from app.db.models import User
from app.schemas.admin import AdminUserRow, AdminUserList, PolicyUpdateRequest

router = APIRouter()


def _require_admin(principal: Principal) -> None:
    try:
        require(principal, Permission.ADMIN)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


def _effective_clearance(u: User) -> int:
    if u.clearance_override is not None:
        return int(u.clearance_override)
    return resolve_clearance(u.assigned_rank or "viewer")


def _effective_scope(u: User) -> str:
    return u.scope_override or resolve_scope(u.assigned_rank or "viewer")


async def _acting_user(session, principal: Principal) -> User | None:
    """Resolve the acting admin's User row (principal.id == username)."""
    return (await session.execute(
        select(User).where(User.username == principal.id)
    )).scalar_one_or_none()


@router.get("/users", response_model=AdminUserList)
async def list_users(principal: Principal = Depends(get_principal)) -> AdminUserList:
    _require_admin(principal)
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        creator = aliased(User)
        stmt = (
            select(User, creator.full_name, creator.username)
            .outerjoin(creator, User.created_by == creator.user_id)
            .order_by(User.created_at.desc().nullslast(), User.user_id.desc())
        )
        result = (await session.execute(stmt)).all()
        rows: list[AdminUserRow] = []
        for u, creator_name, creator_username in result:
            rows.append(AdminUserRow(
                user_id=u.user_id,
                username=u.username,
                full_name=u.full_name or "",
                email=u.email,
                assigned_rank=u.assigned_rank,
                clearance=_effective_clearance(u),
                scope=_effective_scope(u),
                is_active=bool(u.is_active),
                created_at=u.created_at.isoformat() if u.created_at else None,
                created_by_id=u.created_by,
                created_by_name=(creator_name or creator_username) if u.created_by else None,
                has_override=(u.clearance_override is not None or u.scope_override is not None),
            ))
    return AdminUserList(rows=rows, total=len(rows))


@router.patch("/users/{user_id}/policy", response_model=AdminUserRow)
async def update_policy(
    user_id: int,
    req: PolicyUpdateRequest,
    principal: Principal = Depends(get_principal),
) -> AdminUserRow:
    _require_admin(principal)
    if not (req.reason or "").strip():
        raise HTTPException(status_code=422, detail="A reason is required for any policy change.")

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        async with session.begin():
            target = (await session.execute(
                select(User).where(User.user_id == user_id)
            )).scalar_one_or_none()
            if target is None:
                raise HTTPException(status_code=404, detail="User not found.")

            actor = await _acting_user(session, principal)
            is_self = actor is not None and actor.user_id == target.user_id

            before = {
                "rank": target.assigned_rank,
                "clearance": _effective_clearance(target),
                "scope": _effective_scope(target),
                "is_active": bool(target.is_active),
            }

            # --- anti-lockout: admins cannot weaken their own access ---
            if is_self:
                if req.is_active is False:
                    raise HTTPException(status_code=400, detail="You cannot disable your own account.")
                new_clr = req.clearance if req.clearance is not None else (
                    resolve_clearance(req.rank) if req.rank else before["clearance"]
                )
                if new_clr < 4 or (req.rank and RANK_CLEARANCE.get(req.rank, 1) < 4):
                    raise HTTPException(status_code=400, detail="You cannot lower your own clearance below L4.")

            # --- apply rank (re-derives defaults) ---
            if req.rank is not None:
                target.assigned_rank = req.rank
                # rank change resets overrides unless explicit values are also sent
                target.clearance_override = None
                target.scope_override = None

            # --- explicit overrides win over rank defaults ---
            if req.clear_overrides:
                target.clearance_override = None
                target.scope_override = None
            if req.clearance is not None:
                target.clearance_override = int(req.clearance)
            if req.scope is not None:
                target.scope_override = req.scope
            if req.is_active is not None:
                target.is_active = bool(req.is_active)

            await session.flush()

            after = {
                "rank": target.assigned_rank,
                "clearance": _effective_clearance(target),
                "scope": _effective_scope(target),
                "is_active": bool(target.is_active),
            }

            await write_audit(
                session,
                action="ADMIN_POLICY_CHANGE",
                user_id=actor.user_id if actor else None,
                reason=req.reason.strip(),
                query_text=(
                    f"target_user={target.username}({target.user_id}) "
                    f"before={before} after={after}"
                ),
            )

            row = AdminUserRow(
                user_id=target.user_id,
                username=target.username,
                full_name=target.full_name or "",
                email=target.email,
                assigned_rank=target.assigned_rank,
                clearance=after["clearance"],
                scope=after["scope"],
                is_active=after["is_active"],
                created_at=target.created_at.isoformat() if target.created_at else None,
                created_by_id=target.created_by,
                created_by_name=None,
                has_override=(target.clearance_override is not None or target.scope_override is not None),
            )
    return row
```

> **Tracking the creator going forward:** so future accounts record who made them, set
> `created_by` whenever an admin provisions an account. If you add an admin "create account" flow
> later, set `new_user.created_by = actor.user_id`. Existing rows show "Self-registered" because
> `created_by` is NULL — that's expected and handled by the UI.

---

## 6) Register the router — edit `backend/app/main.py`
Next to the other `include_router` lines (around line 111), add:
```python
    from app.api.routes import admin as admin_routes
    app.include_router(admin_routes.router, prefix="/admin", tags=["admin"])
```
(Match the import style already used in that file — top-of-file import is fine too.)

---

## 7) Frontend API client — edit `frontend/src/lib/api/client.ts`
Add these types near the other exported types:
```ts
export type AdminUserRow = {
  user_id: number;
  username: string;
  full_name: string;
  email?: string | null;
  assigned_rank?: string | null;
  clearance: 1 | 2 | 3 | 4;
  scope: "state" | "range" | "district" | "station";
  is_active: boolean;
  created_at?: string | null;
  created_by_id?: number | null;
  created_by_name?: string | null;
  has_override: boolean;
};

export type PolicyUpdate = {
  rank?: string;
  clearance?: 1 | 2 | 3 | 4 | null;
  scope?: "state" | "range" | "district" | "station";
  is_active?: boolean;
  reason: string;
  clear_overrides?: boolean;
};
```
Then add these two methods inside the `export const api = { ... }` object:
```ts
  adminUsers(): Promise<{ rows: AdminUserRow[]; total: number }> {
    return request("/admin/users");
  },
  updateUserPolicy(userId: number, body: PolicyUpdate): Promise<AdminUserRow> {
    return request(`/admin/users/${userId}/policy`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
```

---

## 8) New screen — new file `frontend/src/routes/admin.tsx`
```tsx
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
    api.adminUsers()
      .then((res) => setRows(res.rows))
      .catch((e) => setErr(e?.body?.detail || t("Could not load accounts.")))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (isL4) load(); else setLoading(false); }, [isL4]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.full_name, r.username, r.email, r.assigned_rank, r.created_by_name]
        .filter(Boolean).join(" ").toLowerCase().includes(s),
    );
  }, [rows, q]);

  // --- hard gate: non-L4 officers never see the data ---
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
          <Pill tone="bad">{t("Your clearance")}: L{me?.clearance ?? "—"}</Pill>
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

        {/* Search */}
        <div className="mb-3 flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-background px-3 py-2 nb-shadow-sm">
          <Search className="h-4 w-4 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search by name, email, rank or creator…")}
            className="w-full bg-transparent text-sm font-bold outline-none"
          />
          {q && <button onClick={() => setQ("")}><X className="h-4 w-4 opacity-60" /></button>}
        </div>

        {err && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-[5px] border-2 border-destructive bg-destructive/15 px-3 py-2 text-sm font-bold">
            <AlertTriangle className="h-4 w-4" /> {err}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm font-bold text-foreground/60">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Loading accounts…")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg">
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
                      <div className="text-[11px] font-bold text-foreground/55">{r.email || r.username}</div>
                    </td>
                    <td className="px-3 py-2"><Pill>{r.assigned_rank || "—"}</Pill></td>
                    <td className="px-3 py-2">
                      <Pill tone={r.clearance >= 4 ? "good" : r.clearance <= 1 ? "warn" : "default"}>
                        L{r.clearance}
                      </Pill>{" "}
                      {r.has_override && <Pill tone="warn">{t("override")}</Pill>}
                    </td>
                    <td className="px-3 py-2"><Pill>{r.scope}</Pill></td>
                    <td className="px-3 py-2 text-[12px] font-bold">
                      {r.created_by_name || <span className="text-foreground/45">{t("Self-registered")}</span>}
                      {r.created_at && (
                        <div className="text-[10px] font-bold text-foreground/45">
                          {new Date(r.created_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.is_active
                        ? <Pill tone="good"><Check className="mr-0.5 inline h-2.5 w-2.5" />{t("Active")}</Pill>
                        : <Pill tone="bad"><CircleSlash className="mr-0.5 inline h-2.5 w-2.5" />{t("Disabled")}</Pill>}
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
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-sm font-bold text-foreground/55">{t("No accounts match.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <PolicyEditor
          row={editing}
          isSelf={editing.username === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((x) => (x.user_id === updated.user_id ? { ...x, ...updated } : x)));
            setEditing(null);
          }}
        />
      )}
    </Shell>
  );
}

function PolicyEditor({
  row, isSelf, onClose, onSaved,
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
    if (!reason.trim()) { setError(t("A reason is required.")); return; }
    setSaving(true); setError("");
    try {
      const updated = await api.updateUserPolicy(row.user_id, {
        rank,
        clearance: clearance as 1 | 2 | 3 | 4,
        scope: scope as any,
        is_active: active,
        reason: reason.trim(),
      });
      onSaved(updated);
    } catch (e: any) {
      setError(e?.body?.detail || t("Could not save policy."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="text-base font-extrabold">{t("Change policy")} — {row.full_name || row.username}</h2>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 p-5">
          {isSelf && (
            <div className="flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-warning/25 px-3 py-2 text-xs font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("This is your own account. You can't disable it or drop below L4.")}
            </div>
          )}

          <Field label={t("Rank")}>
            <select value={rank} onChange={(e) => setRank(e.target.value)} className="nb-input">
              {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Clearance")}>
              <select value={clearance} onChange={(e) => setClearance(Number(e.target.value))} className="nb-input">
                {CLEARANCES.map((c) => <option key={c} value={c}>L{c}</option>)}
              </select>
            </Field>
            <Field label={t("Scope")}>
              <select value={scope} onChange={(e) => setScope(e.target.value)} className="nb-input">
                {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 border-2 border-foreground" />
            {t("Account active")}
          </label>

          <Field label={t("Reason (audit-logged, required)")}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Promoted to SP — district handover")} className="nb-input" />
          </Field>

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-[5px] border-2 border-destructive bg-destructive/15 px-3 py-2 text-xs font-bold">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-5 py-3">
          <button onClick={onClose} className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none">{t("Cancel")}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("Save policy")}
          </button>
        </div>
      </div>
    </div>
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
```

> **`nb-input` helper:** the selects/inputs use a `nb-input` class for the neobrutalist field look.
> If you don't already have it, add this once to `frontend/src/styles.css`:
> ```css
> .nb-input {
>   width: 100%;
>   border: 2px solid var(--color-foreground, #0a160a);
>   border-radius: 5px;
>   background: var(--color-background, #fff);
>   padding: 0.5rem 0.625rem;
>   font-weight: 700;
>   font-size: 0.875rem;
>   outline: none;
> }
> ```
> (Or just inline the same Tailwind classes you use on other form fields.)

---

## 9) Navigation — show the link only to L4
Wherever your nav lives (`components/Shell.tsx` or `components/ProfileMenu.tsx`), add a link to
`/admin` that's gated by clearance, e.g.:
```tsx
import { getCachedUser } from "@/lib/api/client";
import { ShieldCheck } from "lucide-react";
// ...
const me = getCachedUser();
{(me?.clearance ?? 0) >= 4 && (
  <Link to="/admin" className="nav-link flex items-center gap-1.5">
    <ShieldCheck className="h-4 w-4" /> {t("Access Control")}
  </Link>
)}
```
The route itself already hard-gates server data behind `Permission.ADMIN`, so hiding the link is
just UX — the backend is the real boundary.

---

## 10) Security & behavior notes
- **Server is the boundary.** `GET /admin/users` and `PATCH /admin/users/{id}/policy` both call
  `require(principal, Permission.ADMIN)` (clearance ≥ 4). A non-L4 token gets `403` regardless of UI.
- **Anti-lockout.** The acting admin can't disable themselves or drop their own clearance below L4.
- **Audit trail.** Every change writes an `ADMIN_POLICY_CHANGE` row via the hash-chained
  `write_audit`, capturing actor, target, before/after, and the required reason — visible on your
  existing **Audit** screen.
- **Effect timing.** Clearance/scope changes take effect on the target's **next login** (the JWT is
  re-minted with the override). If you want instant effect, force a re-login or shorten
  `jwt_expire_minutes`. Disabling is enforced at login via the `is_active` check from step 3.
- **Creator history.** Pre-existing accounts show "Self-registered" (NULL `created_by`). Set
  `created_by = actor.user_id` in any future admin-provisioning flow to populate it going forward.

## 11) Quick test checklist
1. Run migration 006; restart backend.
2. Log in as an L4 (`admin`/`SP`/`DGP`). Open **Access Control** → table loads with a **Created by** column.
3. Log in as a non-L4 (`viewer`/`HC`) → the link is hidden and visiting `/admin` shows the locked panel; `GET /admin/users` returns 403.
4. As L4, edit a `viewer`: set rank `SP`, clearance `L4`, scope `state`, add a reason → save.
5. Re-login as that user → they now have L4 access. Confirm an `ADMIN_POLICY_CHANGE` entry on the Audit screen.
6. Try to disable your own L4 account → blocked with a clear error.
