# Satyam — Auth, Audit, Map Trail & Network Fixes

> Standalone fix plan for the latest build. Previous rounds (E2E wiring, FlagEmbedding, NumPy crash, bug fixes 1–4, and the Console/Map merge + chat formatting + Kannada) are already applied. This document covers ONLY the new work: login authentication & roles, sign-up with photo/camera, removing the demo banner, the live Audit log, the “connect the dots” map animation, the data-driven Network/seed-entity screen, and a deep hardcoded-value scan.

## Issues in this document

1. **Issue 1 — Login:** role selector, remove demo banner, photo + camera on sign-up
2. **Issue 2 — Audit log:** kill the hardcoded fallback, show real data
3. **Issue 3 — Map “connect the dots”:** animate an offender's crime trail
4. **Issue 4 — Network / seed-entity:** de-hardcode + victim-centric chat query
5. **Issue 5 — Deep scan:** remaining hardcoded values

---

## Issue 1 — Login: role selector, remove demo banner, photo + camera on sign-up

**What exists today** (`frontend/src/routes/login.tsx`): a single email/password form that hardcodes `api.login(username, "investigator")` — so **every** login is an Inspector regardless of role. There is no role picker and no real sign-up (just a dead `Request access` link). A yellow `Synthetic / demo data` banner sits at the top.

The backend already supports roles: `POST /auth/login` accepts `rank` and maps it through `RANK_SCOPE` / `RANK_CLEARANCE` (`backend/app/core/rbac.py`) and `_DEMO_STATIONS` (`auth.py`). Valid ranks: `DGP, ADGP, IGP, DIG, SP, Addl.SP, DySP, CPI, PI, CI, PSI, SI, ASI, HC, PC`.

### 1.0 Best structural prompt

```
In frontend/src/routes/login.tsx:
1) Add a Role dropdown directly below the Password field. Populate it from the
   KSP ranks the backend understands (DGP, IGP, DIG, SP, DySP, CI/PI, PSI/SI,
   ASI, HC, PC). Pass the chosen rank to api.login(username, rank) instead of the
   hardcoded "investigator", so clearance/scope follow the role.
2) Remove the "Synthetic / demo data — not real case records" banner from the
   login page AND from components/Shell.tsx (it renders on every screen). Delete
   the unused AlertTriangle import.
3) Replace the dead "Request access" link with a "Create account" modal that
   collects name, email, role, password, AND a profile photo via EITHER file
   upload OR live camera capture (getUserMedia + canvas snapshot). POST it to a
   new /auth/register endpoint and sign the user in.
Keep the neobrutalist styling (border-2 border-foreground, nb-shadow). Localise
all new strings with t() and add Kannada entries to DICT.
```

### 1.1 Remove the demo banner (login + global)

**`login.tsx`** — delete this block:

```tsx
      {/* Synthetic data banner */}
      <div className="relative z-10 flex items-center justify-center gap-2 border-b-2 border-foreground bg-warning px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-warning-foreground">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t("Synthetic / demo data — not real case records")}
      </div>
```

And remove `AlertTriangle` from the `lucide-react` import.

**`components/Shell.tsx`** — the same banner renders app-wide (the yellow strip in your console/network screenshots). Find the sibling block that renders `t("Synthetic / demo data — not real case records")` (top of the Shell layout) and delete that element; drop the now-unused `AlertTriangle`/`triangle` icon import.

> Quick locate: `grep -rn "Synthetic / demo data" frontend/src` — remove every render site (login.tsx, Shell.tsx). Leave the DICT key in place; it just becomes unused.

### 1.2 Role selector below the password

Add this constant near the top of `login.tsx`:

```tsx
export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "DGP",  label: "DGP — Director General (state)" },
  { value: "IGP",  label: "IGP — Inspector General (state)" },
  { value: "DIG",  label: "DIG — Dy. Inspector General (range)" },
  { value: "SP",   label: "SP — Superintendent (district)" },
  { value: "DySP", label: "DySP — Dy. Superintendent (district)" },
  { value: "CI",   label: "CI / PI — Circle/Police Inspector (station)" },
  { value: "PSI",  label: "PSI / SI — Sub-Inspector (station)" },
  { value: "ASI",  label: "ASI — Asst. Sub-Inspector (station)" },
  { value: "HC",   label: "HC — Head Constable (station)" },
  { value: "PC",   label: "PC — Police Constable (station)" },
];
```

Add state inside `Login()`:

```tsx
const [role, setRole] = useState("CI");
```

Insert this block in the form **immediately after the Password field's closing `</div>`** (before the “Remember me / Forgot password” row):

```tsx
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide">
                  {t("Role")}
                </label>
                <div className="relative">
                  <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                  <select
                    name="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="h-11 w-full appearance-none rounded-[5px] border-2 border-foreground bg-background pl-9 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{t(r.label)}</option>
                    ))}
                  </select>
                </div>
              </div>
```

Then change the submit handler so the role drives the login:

```tsx
// BEFORE
await api.login(username, "investigator");
// AFTER
await api.login(username, role);
```

Now signing in as `HC`/`PC` lands a clearance-1 station user (masked PII, no analytics), while `SP`/`IGP` get higher clearance — exactly the RBAC the backend already enforces.

### 1.3 Create-account modal with photo upload + camera capture

**Backend — add a demo register endpoint** in `backend/app/api/routes/auth.py` (mirrors `login`, accepts a base64 photo and just echoes a session; in production this is replaced by the OIDC enrolment flow):

```python
from app.schemas.auth import RegisterRequest  # add to imports

@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest) -> LoginResponse:
    settings = get_settings()
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="self-registration disabled in production")

    rank = req.role or req.rank or "investigator"
    clearance = resolve_clearance(rank)
    scope = resolve_scope(rank)
    geo = _DEMO_STATIONS.get(rank, _DEMO_STATIONS["investigator"])
    uid = (req.email.split("@")[0] if req.email else "").strip() or f"demo-{rank}"

    # NOTE (demo): the profile photo is accepted but not persisted server-side.
    # In production, store it in object storage + officers.photo_url.
    user = SessionUser(
        id=uid, name=req.name.strip() or uid, rank=rank, scope=scope,
        clearance=clearance, station_id=geo["station_id"],
        district=geo["district"], range_name=geo["range"],
    )
    token = create_access_token(
        subject=user.id, name=user.name, rank=rank, scope=scope, clearance=clearance,
        station_id=geo["station_id"], district=geo["district"], range_name=geo["range"],
    )
    return LoginResponse(token=token, user=user)
```

Add to `backend/app/schemas/auth.py`:

```python
class RegisterRequest(BaseModel):
    name: str = ""
    email: str = ""
    role: Optional[str] = None
    rank: Optional[str] = None
    password: str = ""
    photo_b64: Optional[str] = None   # data URL or raw base64 (demo: not persisted)
```

**Frontend — add `api.register`** in `frontend/src/lib/api/client.ts` (next to `login`):

```ts
  async register(body: {
    name: string; email: string; role: string; password: string; photo_b64?: string;
  }): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setAuthToken(out.token);
    return out;
  },
```

**Frontend — the modal.** Add a new component `frontend/src/components/CreateAccountDialog.tsx`. It supports both a file picker and live camera capture (`getUserMedia` → draw a frame to a `<canvas>` → `toDataURL`):

```tsx
import { useEffect, useRef, useState } from "react";
import { Camera, Upload, X, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { ROLE_OPTIONS } from "@/routes/login"; // or duplicate the list / move to a shared module

export function CreateAccountDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CI");
  const [photo, setPhoto] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start/stop the webcam
  useEffect(() => {
    if (!open || !camOn) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch {
        setErr(t("Camera unavailable — check browser permissions."));
        setCamOn(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open, camOn, t]);

  // Stop camera when dialog closes
  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      setCamOn(false);
    }
  }, [open]);

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 320;
    canvas.height = v.videoHeight || 240;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.85));
    setCamOn(false);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.register({ name, email, role, password, photo_b64: photo ?? undefined });
      onCreated();
    } catch {
      setErr(t("Could not create the account. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-[5px] border-2 border-foreground bg-secondary-background p-6 nb-shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{t("Create account")}</h3>
          <button onClick={onClose} className="rounded-[5px] p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Photo: upload OR camera */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[5px] border-2 border-foreground bg-background">
            {camOn ? (
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            ) : photo ? (
              <img src={photo} alt="profile" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-7 w-7 text-foreground/40" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1.5 text-xs font-bold nb-shadow-sm">
              <Upload className="h-3.5 w-3.5" /> {t("Upload photo")}
              <input type="file" accept="image/*" className="hidden" onChange={onFile} />
            </label>
            {camOn ? (
              <button onClick={capture} className="inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground nb-shadow-sm">
                <Camera className="h-3.5 w-3.5" /> {t("Capture")}
              </button>
            ) : (
              <button onClick={() => setCamOn(true)} className="inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1.5 text-xs font-bold nb-shadow-sm">
                <Camera className="h-3.5 w-3.5" /> {photo ? t("Retake") : t("Use camera")}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Full name")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm nb-shadow-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t("Email address")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm nb-shadow-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={t("Password")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm nb-shadow-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm nb-shadow-sm">
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
          </select>
        </div>

        {err && <p className="mt-3 text-xs font-medium text-destructive">{err}</p>}

        <button onClick={submit} disabled={busy}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-primary text-sm font-extrabold uppercase text-primary-foreground nb-shadow disabled:opacity-60">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          {t("Create account")}
        </button>
      </div>
    </div>
  );
}
```

**Wire it into `login.tsx`:** add `const [showCreate, setShowCreate] = useState(false);`, replace the `Request access` anchor with a button that opens the dialog, and render the dialog:

```tsx
<button type="button" onClick={() => setShowCreate(true)}
  className="font-bold underline-offset-4 hover:underline">
  {t("Create account")}
</button>
...
<CreateAccountDialog
  open={showCreate}
  onClose={() => setShowCreate(false)}
  onCreated={() => { setShowCreate(false); navigate({ to: "/console" }); }}
/>
```

> **Camera requires HTTPS or localhost** (browser security). It already works on `localhost:3000`; for LAN demos serve over https.

---

## Issue 2 — Audit log: kill the hardcoded fallback, show real data

**Reality check:** `audit.tsx` is NOT fully fake — it already calls `api.audit({limit:100})` and maps `res.entries`. The problems are: (1) initial state is `DEMO_ROWS` (8 fabricated rows incl. “Whitefield 142 rows”, “18,432 entries”) shown until/if the fetch resolves; (2) the live mapping is lossy — it shows `user:{id}` and `role: "—"` because the backend audit row has no officer name/rank, result, or source; (3) the `VERIFIED · 18,432 entries` string is a made-up fallback.

### 2.0 Best structural prompt

```
Make the Audit screen 100% live. Backend (app/api/routes/audit.py): join the
officers table so each entry returns officer username + rank, and a derived
result/source, instead of a bare user_id. Frontend (routes/audit.tsx): remove
the DEMO_ROWS seed and the "18,432 entries" fallback; start empty with a
loading state; render the enriched fields; show a real empty state when there
are no rows and an error state when the API fails. Keep the hash-chain card
driven by the real chain_valid + total.
```

### 2.1 Backend — enrich audit entries (`app/api/routes/audit.py`)

Replace the `entries` projection with a version that joins `officers` (the AuditLog stores `user_id` = `officer_id`) and derives display fields:

```python
from app.db.models import AuditLog, Officer  # add Officer

# ... inside list_audit, after fetching rows ...
officer_ids = [r.user_id for r in rows if getattr(r, "user_id", None) is not None]
officers = {}
if officer_ids:
    orows = (await session.execute(
        select(Officer.officer_id, Officer.name, Officer.rank)
        .where(Officer.officer_id.in_(set(officer_ids)))
    )).all()
    officers = {o.officer_id: (o.name, o.rank) for o in orows}

def _entry(r):
    name, rank = officers.get(getattr(r, "user_id", None), (None, None))
    action = (r.action or "").upper()
    return {
        "id": r.audit_id,
        "ts": r.at.isoformat() if r.at else None,
        "user": name or (f"officer #{r.user_id}" if r.user_id is not None else "system"),
        "role": rank or "—",
        "action": "DENY" if "DENY" in action or "BLOCK" in action else "ALLOW",
        "query": r.query_text or r.generated_sql or r.action or "",
        "result": r.reason or (f"case #{r.case_id}" if r.case_id is not None else "—"),
        "src": r.action or "audit_log",
        "hash": r.row_hash,
    }

return {
    "chain_valid": chain_valid,
    "total": total,
    "count": len(rows),
    "entries": [_entry(r) for r in rows],
}
```

> If your `Officer` model class name differs, `grep -n "class .*Officer" backend/app/db/models.py`. If audit rows aren't being written, confirm `write_audit(...)` is called (it is, from `chat_service.stream_chat`).

### 2.2 Frontend — remove the fake seed (`routes/audit.tsx`)

1. **Delete** the entire `DEMO_ROWS = [ ... ]` array.
2. Change the state seeds:

```tsx
// BEFORE
const [rows, setRows] = useState(DEMO_ROWS);
// AFTER
type AuditRow = { t: string; u: string; role: string; action: string; query: string; result: string; src: string };
const [rows, setRows] = useState<AuditRow[]>([]);
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState(false);
```

3. Update the fetch effect to use the enriched fields and set loading/error:

```tsx
useEffect(() => {
  let active = true;
  api.audit({ limit: 100 })
    .then((res: any) => {
      if (!active) return;
      const mapped: AuditRow[] = (res?.entries ?? []).map((e: any) => ({
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
    .catch(() => { if (active) setLoadError(true); })
    .finally(() => { if (active) setLoading(false); });
  return () => { active = false; };
}, []);
```

4. Replace the `VERIFIED · 18,432 entries` fallback with a neutral label:

```tsx
{chainValid === false
  ? t("CHAIN BROKEN")
  : liveTotal != null
    ? `${t("VERIFIED")} · ${liveTotal.toLocaleString()} ${t("entries")}`
    : t("Verifying…")}
```

5. In the table body, handle the three states (loading / error / empty) instead of always rendering rows:

```tsx
{loading ? (
  <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">{t("Loading audit log…")}</td></tr>
) : loadError ? (
  <tr><td colSpan={7} className="py-10 text-center text-sm text-destructive">{t("Couldn't load the audit log.")}</td></tr>
) : filteredRows.length === 0 ? (
  <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">{t("No entries match your search.")}</td></tr>
) : (
  filteredRows.map((r, i) => ( /* ...existing row markup... */ ))
)}
```

6. Footer: use `liveTotal ?? rows.length` (drop the `rows.length` over a fake 18,432).

---

## Issue 3 — Map “connect the dots”: animate an offender's crime trail

**Goal:** when the user says “connect the dots” (chat or voice) — or clicks a button on the Console map — draw the selected offender's crime locations one by one and animate a line linking them in the order the crimes happened.

### 3.0 Best structural prompt

```
Add an animated "connect the dots" offender trail to the Console map.
Backend: new POST /map/offender-trail {person_id|entity_name} -> ordered list of
{lat,lng,date,fir_number,crime_type,station} for that offender's cases
(role accused), sorted by report_date. RLS-scoped, RUN_ANALYTICS.
Frontend CrimeMap.tsx: accept an optional `trail` prop; when set, drop each pin
in sequence and animate a polyline segment-by-segment (requestAnimationFrame),
fitBounds to the trail. Console: add a "Connect the dots" control and a voice/
chat phrase that calls api.offenderTrail(seed) and feeds CrimeMap.
```

### 3.1 Backend endpoint

`backend/app/schemas/map.py` — add:

```python
class OffenderTrailRequest(BaseModel):
    person_id: Optional[str] = None
    entity_name: Optional[str] = None

class TrailPoint(BaseModel):
    lat: float
    lng: float
    date: Optional[str] = None
    fir_number: Optional[str] = None
    crime_type: Optional[str] = None
    station: Optional[str] = None

class OffenderTrailResponse(BaseModel):
    person_id: str
    label: str
    points: list[TrailPoint] = []
```

`backend/app/pipeline/tools/analytics.py` — add:

```python
async def offender_trail(
    session: AsyncSession, *, person_id: int | str
) -> tuple[str, list[dict]]:
    """Ordered crime locations for one offender (role = accused/offender)."""
    try:
        pid = int(person_id)
        label = str(person_id)
    except (TypeError, ValueError):
        row = (await session.execute(
            text("SELECT person_id, name FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
            {"n": str(person_id)},
        )).first()
        if not row:
            return str(person_id), []
        pid, label = row[0], row[1]
    sql = text(
        """
        SELECT c.latitude AS lat, c.longitude AS lng, c.report_date AS date,
               c.fir_number, c.crime_type, c.station_name AS station
        FROM case_persons cp
        JOIN cases c ON c.case_id = cp.case_id
        WHERE cp.person_id = :pid
          AND cp.role ILIKE '%accused%'
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY c.report_date ASC
        LIMIT 200
        """
    )
    rows = (await session.execute(sql, {"pid": pid})).mappings().all()
    return str(label), [dict(r) for r in rows]
```

`backend/app/api/routes/map.py` — add a route (mirrors `/hotspots`, so no `main.py` change — it's under the existing `/map` prefix):

```python
from app.schemas.map import OffenderTrailRequest, OffenderTrailResponse, TrailPoint

@router.post("/offender-trail", response_model=OffenderTrailResponse)
async def offender_trail(
    req: OffenderTrailRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> OffenderTrailResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    seed = req.person_id or req.entity_name or ""
    label, pts = await analytics.offender_trail(session, person_id=seed)
    return OffenderTrailResponse(
        person_id=str(seed), label=label,
        points=[TrailPoint(**p) for p in pts],
    )
```

### 3.2 Frontend client

`lib/api/client.ts` — add:

```ts
export type TrailPoint = { lat: number; lng: number; date?: string; fir_number?: string; crime_type?: string; station?: string };
export type OffenderTrail = { person_id: string; label: string; points: TrailPoint[] };
// inside the api object:
  offenderTrail(body: { person_id?: string; entity_name?: string }) {
    return request<OffenderTrail>("/map/offender-trail", { method: "POST", body: JSON.stringify(body) });
  },
```

### 3.3 CrimeMap — animated polyline

In `components/CrimeMap.tsx`, extend the props and add a trail effect. Add `trail` + `animateKey` to the signature:

```tsx
export function CrimeMap({
  points, mode = "heat", trail, animateKey,
}: { points: Hotspot[]; mode?: Mode; trail?: Hotspot[]; animateKey?: number }) {
```

Add this effect after the existing draw effect (uses the already-loaded `L`/`map` refs):

```tsx
  // Animated "connect the dots" offender trail
  const trailLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (trailLayerRef.current) { map.removeLayer(trailLayerRef.current); trailLayerRef.current = null; }
    if (!trail || trail.length === 0) return;

    const group = L.layerGroup().addTo(map);
    trailLayerRef.current = group;
    const latlngs = trail.map((p) => [p.lat, p.lng] as [number, number]);
    map.fitBounds(L.latLngBounds(latlngs).pad(0.25));

    const line = L.polyline([], { color: "#e11d48", weight: 3, opacity: 0.9, dashArray: "6 6" }).addTo(group);
    let i = 0;
    const step = () => {
      if (i >= trail.length || !trailLayerRef.current) return;
      const p = trail[i];
      L.circleMarker([p.lat, p.lng], {
        radius: 6, color: "#e11d48", fillColor: "#fb7185", fillOpacity: 0.9, weight: 2,
      }).bindTooltip(`${i + 1}. ${p.label ?? p.weight ?? ""}`).addTo(group);
      line.addLatLng([p.lat, p.lng]);
      i += 1;
      if (i < trail.length) setTimeout(() => requestAnimationFrame(step), 600);
    };
    requestAnimationFrame(step);

    return () => { if (trailLayerRef.current) { map.removeLayer(trailLayerRef.current); trailLayerRef.current = null; } };
  }, [trail, animateKey, ready]);
```

> Map a `TrailPoint[]` to `Hotspot[]` when passing in: `trail.map(p => ({ lat: p.lat, lng: p.lng, weight: 1, label: p.fir_number }))`.

### 3.4 Console — control + chat/voice trigger

In `routes/console.tsx` (the merged map canvas):

```tsx
const [trail, setTrail] = useState<Hotspot[] | undefined>(undefined);
const [trailKey, setTrailKey] = useState(0);

const connectDots = useCallback(async (seed: string) => {
  try {
    const res = await api.offenderTrail({ entity_name: seed });
    setTrail(res.points.map((p) => ({ lat: p.lat, lng: p.lng, weight: 1, label: p.fir_number })));
    setTrailKey((k) => k + 1);
    setCanvasTab("map");
  } catch { /* surface a toast if you have one */ }
}, []);
```

Pass it to the map: `<CrimeMap points={hotspots} mode={mapMode} trail={trail} animateKey={trailKey} />`.

Add a button on the Map tab (e.g. next to the layer toggle):

```tsx
<button onClick={() => connectDots(seedInput || "")}
  className="rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1.5 text-xs font-bold nb-shadow-sm">
  {t("Connect the dots")}
</button>
```

**Chat/voice phrase:** in `sendMessage`, before streaming, detect the intent and short-circuit to the animation:

```tsx
const m = trimmed.toLowerCase();
if (m.includes("connect the dots") || m.includes("ಚುಕ್ಕಿಗಳನ್ನು ಸಂಪರ्ಕ")) {
  // pull a name after "for"/"of", else use the last seed
  const who = (trimmed.match(/(?:for|of|against|by)\s+(.+)$/i)?.[1] || "").trim();
  await connectDots(who);
  return;
}
```

> Backend already wires offender hotspots via `mapMode === "by_offender"`; the trail is the temporal companion to that.

---

## Issue 4 — Network / seed-entity screen: de-hardcode + victim-centric chat query

**What's hardcoded today** (`routes/network.tsx`):
- Initial graph = `DEMO_NODES` (S1…N8) / `DEMO_EDGES` shown before any search (your screenshot — “SEED ENTITY” with Person-01…Vehicle-01).
- `exportJson()` writes `seedEntity: "S. Manjunath", depth: 2` regardless of the real seed.
- The screen DOES call `api.network({entity_name, depth:2})` via `fetchGraph`, but only after the user types a seed; the default view is fake.

### 4.0 Best structural prompt

```
Make the Network screen fully data-driven. Remove DEMO_NODES/DEMO_EDGES; start
empty with an "enter a person to build the graph" prompt + loading/empty states.
Drive the export metadata (seed label + depth) from the real query, not the
hardcoded "S. Manjunath"/2. Support a ?seed= URL param so chat can deep-link.
Backend: add victim-centric ego — given a person, return the OFFENDERS
(accused) in cases where that person was victim/complainant, plus everything
connected. Wire the chat "network" intent to extract the person and emit a
deep-link to /network?seed=<name>.
```

### 4.1 Frontend — remove demo graph, add states & seed param

```tsx
// Replace DEMO seeds:
const [NODES, setNODES] = useState<any[]>([]);
const [EDGES, setEDGES] = useState<[string,string][]>([]);
const [graphLoading, setGraphLoading] = useState(false);
const [graphEmpty, setGraphEmpty] = useState(true);
```

In `fetchGraph`, set `setGraphLoading(true)` at the start, `setGraphEmpty(mappedNodes.length === 0)` on success, and clear loading in `finally`. On mount, read a `?seed=` param and auto-run it:

```tsx
useEffect(() => {
  const seed = new URLSearchParams(window.location.search).get("seed");
  if (seed) { setSeedInput(seed); fetchGraph(seed); }
}, [fetchGraph]);
```

Render an empty/prompt state in the canvas when `graphEmpty && !graphLoading` (“Enter a person or ID above to build the link graph”), and a spinner when `graphLoading`. Guard the node-inspector (`NODES.find(...)!`) against an empty array so it doesn't crash before a search.

Fix the export metadata:

```tsx
// BEFORE
seedEntity: "S. Manjunath",
depth: 2,
// AFTER
seedEntity: NODES.find((n) => (n as any).role === "seed")?.label ?? seedInput ?? selected,
depth: depth,            // use the screen's actual depth control
```

### 4.2 Backend — victim-centric ego (offenders against a person)

Add `focus` to the request so the same endpoint serves both “network around X” and “offenders who targeted X”. In `schemas/network.py`:

```python
class EgoRequest(BaseModel):
    person_id: Optional[str] = None
    entity_name: Optional[str] = None
    depth: int = 1
    focus: Optional[str] = None   # "victim" => return offenders in cases where person was victim/complainant
    # ... keep existing _require_one validator ...
```

In `analytics.py`, add a victim-centric query (offenders = accused in the victim's cases):

```python
async def victim_offender_network(
    session: AsyncSession, *, person_id: int | str
) -> tuple[list[dict], list[dict]]:
    """Given a victim/complainant, return the offenders (accused) across their
    cases and the people/cases connected around them."""
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        resolved = (await session.execute(
            text("SELECT person_id FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
            {"n": str(person_id)},
        )).scalar_one_or_none()
        if resolved is None:
            return [], []
        pid = resolved
    sql = text(
        """
        WITH victim_cases AS (
            SELECT case_id FROM case_persons
            WHERE person_id = :pid AND (role ILIKE '%victim%' OR role ILIKE '%complainant%')
        )
        SELECT cp.person_id, p.name, cp.role, c.case_id, c.fir_number, c.crime_type
        FROM case_persons cp
        JOIN persons p ON p.person_id = cp.person_id
        JOIN cases   c ON c.case_id   = cp.case_id
        WHERE cp.case_id IN (SELECT case_id FROM victim_cases)
        LIMIT 300
        """
    )
    rows = [dict(r) for r in (await session.execute(sql, {"pid": pid})).mappings().all()]
    g = nx.Graph()
    g.add_node(str(pid), kind="person", label="victim", role="seed")
    for r in rows:
        cnode = f"case:{r['case_id']}"
        g.add_node(cnode, kind="case", label=r.get("fir_number", str(r["case_id"])), crime_type=r.get("crime_type"))
        pnode = str(r["person_id"])
        g.add_node(pnode, kind="person", label=r.get("name", pnode), role=(r.get("role") or "").lower())
        g.add_edge(pnode, cnode, label=r.get("role"))
    nodes = [{"id": n, "label": d.get("label", n), "kind": d.get("kind", "person"),
              "crime_type": d.get("crime_type"), "degree": g.degree(n), "role": d.get("role")}
             for n, d in g.nodes(data=True)]
    edges = [{"source": u, "target": v, "label": d.get("label")} for u, v, d in g.edges(data=True)]
    return nodes, edges
```

In `network_service.ego`, branch on `req.focus`:

```python
if (req.focus or "").lower() == "victim":
    nodes_raw, edges_raw = await analytics.victim_offender_network(session, person_id=req.person_id)
else:
    nodes_raw, edges_raw = await analytics.ego_network(session, person_id=req.person_id, depth=req.depth)
```

### 4.3 Wire the chat “network” intent

The orchestrator already has a `network` lane but it (a) only runs when `slots.person` is set and (b) never tells the UI to open the graph. Two improvements:

1. **Router** (`prompts.py ROUTER_SYSTEM` + schema already has a `person` slot) — strengthen the instruction so “who attacked / offenders against / crimes committed against <name>” maps to `intent=network` with `person=<name>`. Add to the network description: *“network (links between people/cases, including offenders who acted against a victim).”*
2. **Orchestrator** (`orchestrator.py`, network branch) — detect the victim framing and emit a deep-link the console can render:

```python
elif intent == "network":
    person = state.slots.get("person")
    if person:
        victim_framed = any(w in message.lower() for w in ("against", "victim", "targeted", "attacked"))
        if victim_framed:
            nodes, edges = await analytics.victim_offender_network(session, person_id=person)
        else:
            nodes, edges = await analytics.ego_network(session, person_id=person)
        context = json.dumps({"nodes": nodes, "edges": edges}, default=str)
        # deep-link event so the console can offer "Open in Network"
        yield PipelineEvent("citation", {"ref": f"/network?seed={person}", "label": "Open network"})
    yield PipelineEvent("tool", {"name": "analytics.network", "status": "end"})
```

The composed answer will now list the offenders (from `context`) in the clean table format, and the citation chip deep-links to the live Network graph (`?seed=` handled in 4.1).

---

## Issue 5 — Deep scan: remaining hardcoded values

Full scan result (`grep` across `frontend/src`, excluding the i18n dictionary):

| File | Line | Hardcoded value | Fix |
|------|------|-----------------|-----|
| `routes/audit.tsx` | 18–29 | `DEMO_ROWS` (Whitefield/142/FIR-2024-08842/18,432) | Issue 2 — delete. |
| `routes/network.tsx` | 21–33 | `DEMO_NODES` / `DEMO_EDGES` | Issue 4 — delete, start empty. |
| `routes/network.tsx` | 367 | `seedEntity: "S. Manjunath", depth: 2` | Issue 4 — derive from real seed/depth. |
| `routes/console.tsx` | 365 | `"Whitefield…"` demo conversation seed | Replace `getDefaultMessages()` with `[]`. |
| `components/ProfileMenu.tsx` | 33 | `“Whitefield…”` static profile sub-text | Bind to `api.me()` (name/rank/station from the session user). |
| `components/SettingsDialog.tsx` | 135 | `“Whitefield…”` static workspace label | Bind to the session user's district/station. |
| `routes/map.tsx` | whole file | Leftover standalone Map (superseded by merged Console canvas) | Delete the file; remove `/map` from `Shell` NAV; regen `routeTree.gen.ts` (`npm run dev`). |

### 5.1 ProfileMenu / SettingsDialog — bind to the session user

Both show a hardcoded “Whitefield”. Pull the real identity once:

```tsx
const [me, setMe] = useState<SessionUser | null>(null);
useEffect(() => { api.me().then(setMe).catch(() => {}); }, []);
// then render: {me ? `${me.name} · ${me.rank}` : "—"} and {me?.district || me?.range_name || "—"}
```

(`api.me()` and `SessionUser` already exist in `client.ts`.)

### 5.2 Console demo conversation

Set `getDefaultMessages()` to return `[]` and neutralise `cannedFallback()` so the chat starts empty instead of replaying the Whitefield 142-FIR script.

### 5.3 Re-run the scan after fixes

```bash
cd frontend/src && grep -rnoE 'Whitefield|S\. ?Manjunath|142|18,432|FIR-2024-08842|DEMO_' routes components | grep -v i18n.tsx
```
Expect **zero** hits (the only legitimate remaining occurrences are inside `lib/i18n.tsx`, which are translation keys, not data).

### 5.4 Remove the leftover standalone Map

`routes/map.tsx` still exists even though the map now lives in the Console. Delete it, remove the `{ to: "/map" }` entry from `Shell` `NAV`, and let TanStack regenerate `routeTree.gen.ts` on next `npm run dev` (or manually drop the `MapRoute` / `MapRouteImport` references).

---

## Verify

1. `cd backend && python -c "import app.api.routes.auth, app.api.routes.map, app.api.routes.audit, app.services.network_service"` — imports clean.
2. `cd frontend && npm run build` — compiles (new dialog, client methods, CrimeMap props).
3. Login: pick **HC** → PII masked + no analytics; pick **SP/IGP** → full access. No yellow banner anywhere.
4. Create account: upload a photo AND capture from webcam; new session lands on the console.
5. Audit: rows show real officer names/ranks + real total; pull the plug on the backend → clean error state, not fake rows.
6. Map: “connect the dots for <offender>” animates pins + a dashed line in date order.
7. Network: open with no seed → empty prompt; chat “offenders who committed crimes against <name>” → table of offenders + an “Open network” chip that loads `/network?seed=<name>` live.
8. `grep` deep-scan (5.3) returns zero data hits.
