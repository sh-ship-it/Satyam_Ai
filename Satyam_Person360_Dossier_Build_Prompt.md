# Satyam — “Person 360” Admin Dossier Screen — Build Prompt

> **Hand this file to your coding agent.** It is a complete, self-contained build
> spec for a NEW admin-only screen that shows one person’s entire profile
> (crime history, contacts, home address, family + their contacts, bank
> accounts, and a front / left / right mugshot face-card view).
>
> **Two hard rules that must never be violated:**
> 1. **Data isolation** — this screen uses its own `demo_dossier_*` tables and a
>    dedicated seed. It must **never** read from or write to the real synthetic
>    dataset tables (`persons`, `cases`, `case_persons`, `narratives`,
>    `financial_accounts`, `financial_transactions`, …). Exactly **10** demo
>    records. Removing/seeding demo data must not touch any existing table.
> 2. **Admin only** — the route, the nav entry, and the API are gated to
>    `clearance == 4` / role `admin`. No masking is applied on this screen
>    because (a) it’s admin-only and (b) the data is 100% fictional demo data.

---

## 0. Why a separate table namespace (do this, not the alternative)

The existing loader `backend/seed/load_seed.py` runs `TRUNCATE … CASCADE` on the
real tables and the embeddings job + RLS policies operate on `persons` / `cases`.
If the demo dossier reused those tables it would (a) get wiped by reseeds,
(b) pollute Network / Profile / Forecast analytics, and (c) be subject to RLS
scope filtering. Therefore the demo data lives in **brand-new tables prefixed
`demo_dossier_`** with **no foreign keys to real tables** and **no RLS policy**
(they are only ever queried through the admin-gated endpoint).

---

## 1. Database — new migration (isolated tables)

Create `backend/migrations/004_demo_dossier.sql` (verified: `backend/migrations/` currently holds 001/002/003 — **004** is the next free number):

```sql
-- Demo-only dossier tables. FULLY ISOLATED from the synthetic dataset.
-- No FKs to persons/cases. No RLS. Only read via the admin dossier endpoint.
-- Safe to drop & reseed without affecting any production/synthetic table.

CREATE TABLE IF NOT EXISTS demo_dossier_persons (
    demo_id          SERIAL PRIMARY KEY,
    slug             TEXT UNIQUE NOT NULL,         -- e.g. 'rakesh-gowda'
    full_name        TEXT NOT NULL,
    aliases          TEXT[]  DEFAULT '{}',
    gender           TEXT,
    dob              DATE,
    age              INT,
    height_cm        INT,
    build            TEXT,
    complexion       TEXT,
    identifying_marks TEXT,
    blood_group      TEXT,
    nationality      TEXT DEFAULT 'Indian',
    risk_level       TEXT,                          -- Low | Medium | High | Critical
    wanted_status    TEXT,                          -- e.g. 'Wanted', 'On Bail', 'Convicted'
    primary_phone    TEXT,
    secondary_phone  TEXT,
    email            TEXT,
    home_address     TEXT,
    district         TEXT,
    pincode          TEXT,
    photo_front      TEXT,                          -- /demo-dossier/<slug>/front.png
    photo_left       TEXT,
    photo_right      TEXT,
    summary          TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_dossier_family (
    id          SERIAL PRIMARY KEY,
    demo_id     INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    relation    TEXT NOT NULL,                      -- Father, Mother, Spouse, Brother…
    age         INT,
    phone       TEXT,
    occupation  TEXT,
    address     TEXT,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_bank_accounts (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    bank_name     TEXT NOT NULL,
    account_no    TEXT NOT NULL,                    -- fictional, store masked-friendly
    ifsc          TEXT,
    branch        TEXT,
    account_type  TEXT,                             -- Savings | Current | Joint
    balance_inr   NUMERIC(14,2),
    status        TEXT DEFAULT 'Active',            -- Active | Frozen | Dormant
    opened_on     DATE,
    flagged       BOOLEAN DEFAULT false,
    flag_reason   TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_crimes (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    case_ref      TEXT NOT NULL,                    -- fictional FIR no e.g. 'DEMO/2023/0142'
    crime_type    TEXT NOT NULL,
    sections      TEXT,                             -- IPC/BNS sections
    role          TEXT,                             -- Accused | Convicted | Suspect
    status        TEXT,                             -- Open | Chargesheeted | Convicted | Acquitted
    occurred_on   DATE,
    station       TEXT,
    district      TEXT,
    sentence      TEXT,
    narrative     TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_contacts (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    label         TEXT,                             -- 'Known associate', 'Employer'…
    name          TEXT,
    relation      TEXT,
    phone         TEXT,
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS ix_demo_family_pid  ON demo_dossier_family(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_bank_pid    ON demo_dossier_bank_accounts(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_crimes_pid  ON demo_dossier_crimes(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_contacts_pid ON demo_dossier_contacts(demo_id);
```

> **Do NOT add these tables to `load_seed.py`’s TRUNCATE list, to RLS
> (`db/rls.py`), or to the embeddings job.** They are intentionally outside
> those systems.

---

## 2. ORM models

Add to a NEW file `backend/app/db/demo_dossier_models.py` (keep them out of
`db/models.py` so they never get swept into existing migrations/relationships):

```python
"""Demo-only dossier ORM models — ISOLATED from the synthetic dataset.
See migrations/004_demo_dossier.sql. No FKs to persons/cases; no RLS.
"""
from __future__ import annotations
import datetime as dt
from sqlalchemy import (Boolean, Date, DateTime, Integer, Numeric, String, Text)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.models import Base  # reuse the same DeclarativeBase

class DemoDossierPerson(Base):
    __tablename__ = "demo_dossier_persons"
    demo_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True)
    full_name: Mapped[str] = mapped_column(String)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    # … map every column from the DDL above …
    family   = relationship("DemoDossierFamily",  cascade="all, delete-orphan")
    banks    = relationship("DemoDossierBank",    cascade="all, delete-orphan")
    crimes   = relationship("DemoDossierCrime",   cascade="all, delete-orphan")
    contacts = relationship("DemoDossierContact", cascade="all, delete-orphan")
# … DemoDossierFamily / DemoDossierBank / DemoDossierCrime / DemoDossierContact …
```

---

## 3. Pydantic schema

`backend/app/schemas/dossier.py` — response models: `DossierListItem`
(`demo_id, slug, full_name, age, district, risk_level, photo_front`) and
`DossierDetail` (the person + nested `family[]`, `banks[]`, `crimes[]`,
`contacts[]`, plus computed `bank_account_count`, `total_balance_inr`,
`open_case_count`). Mirror the style of `backend/app/schemas/intelligence.py`.

---

## 4. Service

`backend/app/services/dossier_service.py`:

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.demo_dossier_models import DemoDossierPerson

async def list_dossiers(session: AsyncSession) -> list[dict]:
    rows = (await session.execute(select(DemoDossierPerson).order_by(DemoDossierPerson.full_name))).scalars().all()
    return [_to_list_item(p) for p in rows]

async def get_dossier(session: AsyncSession, demo_id: int) -> dict | None:
    p = (await session.execute(
        select(DemoDossierPerson).where(DemoDossierPerson.demo_id == demo_id)
    )).scalars().first()
    return _to_detail(p) if p else None
```

> Use a plain (non-RLS) session here, OR keep `get_scoped_session` — either is
> fine because these tables have no RLS policy. **Do not** call `mask_*`
> helpers; this is admin-only, fictional data.

---

## 5. Route (admin-gated) + wiring

`backend/app/api/routes/dossier.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import Principal
from app.services import dossier_service as svc

router = APIRouter()

def _require_admin(p: Principal) -> None:
    # Admin-only: full clearance OR explicit admin role.
    if p.clearance < 4 and p.rank not in ("admin", "DGP", "ADGP", "IGP", "SP"):
        raise HTTPException(403, detail="Person 360 dossier requires admin (L4) access")

@router.get("/list")
async def dossier_list(session: AsyncSession = Depends(get_scoped_session),
                       principal: Principal = Depends(get_principal)):
    _require_admin(principal)
    return {"persons": await svc.list_dossiers(session)}

@router.get("/{demo_id}")
async def dossier_detail(demo_id: int,
                         session: AsyncSession = Depends(get_scoped_session),
                         principal: Principal = Depends(get_principal)):
    _require_admin(principal)
    await write_audit(session, action="dossier.view", user_id=principal.officer_id,
                      query_text=f"demo_dossier demo_id={demo_id}")
    d = await svc.get_dossier(session, demo_id)
    if not d:
        raise HTTPException(404, detail="demo dossier not found")
    return d
```

Register in `backend/app/main.py` next to the other includes:

```python
from app.api.routes import dossier as dossier_routes
app.include_router(dossier_routes.router, prefix="/api/dossier", tags=["dossier"])
```

---

## 6. Frontend API client

Add `frontend/src/lib/api/dossier.ts` mirroring `intelligence.ts`
(`apiFetch` + `getAuthToken`). Export `dossier.list()` → `GET /api/dossier/list`
and `dossier.detail(id)` → `GET /api/dossier/{id}`, with `DossierListItem` /
`DossierDetail` TS types matching the Pydantic schema.

---

## 7. Frontend screen

New file route `frontend/src/routes/dossier.tsx` (TanStack Start, same pattern as
`profile.$personId.tsx`). Layout:

- **Left rail:** searchable list of the 10 demo persons (name + risk chip +
  thumbnail = `photo_front`). Selecting one loads the detail.
- **Header band:** full name, aliases, risk badge (reuse `RISK_BG` palette from
  `profile.$personId.tsx`), wanted status, a clear **“DEMO DATA — fictional”**
  pill so judges/users know it’s isolated demo content.
- **Face-card view (the 3-angle mugshot):** a `FaceCard` component showing three
  framed images side by side with captions **Front**, **Left Profile**,
  **Right Profile**, sourced from `photo_front/left/right`. Use a subtle
  ID-card frame, scale/height grid lines behind for a forensic look, and a
  lightbox on click.
- **Detail sections (cards/grid):**
  1. **Personal & Physical** — DOB/age, gender, height, build, complexion,
     identifying marks, blood group, nationality.
  2. **Contact details** — primary/secondary phone, email.
  3. **Home address** — full address + district + pincode (+ optional small
     Leaflet pin if you want, reuse `CrimeMap` pattern; OK to omit).
  4. **Family members** — table: name, relation, age, phone, occupation.
  5. **Other contacts / known associates** — table from `demo_dossier_contacts`.
  6. **Bank accounts** — table: bank, account no, IFSC, branch, type, balance,
     status, flagged. Show a header stat: **N accounts · ₹ total**.
  7. **Crime history** — timeline/table: case ref, date, crime type, sections,
     role, status, station, sentence, narrative (reuse the timeline visual
     style from the profile screen).
- **Export:** a “Print / Export PDF” button reusing the existing print pattern
  (`window.print()` + print CSS) already used on the profile screen.

### Nav entry (admin-gated)

In `frontend/src/components/Shell.tsx`, add to the `NAV` array:

```tsx
{ to: "/dossier", icon: Fingerprint, label: t("Person 360") },  // NOTE: use Fingerprint (or Contact/UserSquare) — already imported in profile.$personId.tsx and confirmed in lucide-react ^0.575. `IdCard` was NOT verified in this version; do not use it without checking.
```

Gate it so it only renders when the logged-in principal is admin/L4 (the Shell
already knows the user’s role/clearance — reuse that same guard that hides
named-accused features for low clearance, around the existing role check). Also
add a client-side redirect in `dossier.tsx`’s component: if not admin, show a
“Admin access required” empty state instead of data.

Add i18n keys `"Person 360"` (and any section labels) to both the English DICT
and `kn-data.json` so the bilingual toggle keeps working.

---

## 8. Seeding the 10 demo records (isolated)

Create `backend/seed/demo_dossier/demo_dossier.json` with the 10 personas below,
and a loader `backend/seed/load_demo_dossier.py`:

```python
"""Seed the 10 isolated demo dossiers. Safe & idempotent.
Usage:  python -m seed.load_demo_dossier   (add --local for local PG)
Only TRUNCATEs demo_dossier_* tables — never the synthetic dataset.
"""
# 1) TRUNCATE demo_dossier_contacts, demo_dossier_crimes,
#    demo_dossier_bank_accounts, demo_dossier_family, demo_dossier_persons RESTART IDENTITY CASCADE
# 2) Load demo_dossier.json, insert person, then nested family/banks/crimes/contacts.
```

> **Idempotency check:** the only tables this script may name are
> `demo_dossier_*`. A grep for `persons`, `cases`, `narratives`, `financial_`
> in this loader must return nothing.

### The 10 demo personas (fictional — copy into `demo_dossier.json`)

> All names, numbers, addresses, FIRs, and accounts are invented for demo only.
> Phone numbers use the safe fictional prefix ranges; account numbers are masked.

| # | slug | Name | Age/Gender | District | Risk | Primary crime | Banks | Family |
|---|------|------|-----------|----------|------|---------------|-------|--------|
| 1 | rakesh-gowda | Rakesh Gowda | 38 / M | Bengaluru Urban | Critical | Organized vehicle theft ring | 3 | Father, Spouse, Brother |
| 2 | imran-shariff | Imran Shariff | 31 / M | Mysuru | High | Chain snatching / robbery | 2 | Mother, Spouse |
| 3 | naveen-kumar | Naveen Kumar | 45 / M | Mangaluru (Dakshina Kannada) | High | Financial fraud / cheating | 4 | Spouse, Son, Daughter |
| 4 | suresh-patil | Suresh Patil | 52 / M | Belagavi | Medium | Land-grab extortion | 2 | Spouse, Brother |
| 5 | anwar-baig | Anwar Baig | 29 / M | Kalaburagi | High | Narcotics peddling | 2 | Father, Mother |
| 6 | manjunath-shetty | Manjunath Shetty | 41 / M | Udupi | Medium | Illegal money lending | 3 | Spouse, Father |
| 7 | prakash-reddy | Prakash Reddy | 36 / M | Ballari | Critical | Illegal mining / extortion | 3 | Spouse, Brother, Father |
| 8 | farhan-khan | Farhan Khan | 27 / M | Hubballi-Dharwad | Medium | Mobile/electronics theft | 1 | Mother, Sister |
| 9 | lokesh-naik | Lokesh Naik | 49 / M | Shivamogga | High | Forest/wildlife smuggling | 2 | Spouse, Son |
| 10 | vijay-rao | Vijay Rao | 34 / M | Tumakuru | Medium | Cybercrime / UPI fraud | 4 | Spouse, Father, Mother |

For each persona fill out, in the JSON:
- **person**: full physical description (height_cm, build, complexion,
  identifying_marks e.g. “scar on left eyebrow”, blood_group), wanted_status,
  primary/secondary phone (use `+91 9XXXXXXXXX` fictional), email, full home
  address + district + pincode, a 2–3 sentence summary, and the three photo
  paths `/demo-dossier/<slug>/front.png|left.png|right.png`.
- **family[]**: 2–4 members with name, relation, age, phone, occupation.
- **contacts[]**: 1–3 known associates/employer with phone.
- **banks[]**: the listed number of accounts (bank_name from real Indian banks
  e.g. SBI, Canara, KVGB, HDFC; fictional account_no like `•••• •••• 4821`;
  IFSC, branch, account_type, balance_inr, status, flagged + flag_reason on at
  least one suspicious account).
- **crimes[]**: 2–5 entries with case_ref `DEMO/<year>/<nnnn>`, crime_type,
  sections (IPC + BNS, e.g. `IPC 379 / BNS 303`), role, status, occurred_on,
  station, district, sentence (if convicted), and a 1–2 line narrative.

> Keep totals realistic (e.g. balances ₹12k–₹18L, one flagged account each for
> the High/Critical risk personas to make the “bank accounts” section tell a
> story).

---

## 9. AI-generated face photos (front / left / right)

The screen needs **3 images per persona = 30 images**, generated by the AI image
tool. **Ethics: these must be fully synthetic, fictional faces — never a real
person, celebrity, or anyone identifiable.** Place files at:

```
frontend/public/demo-dossier/<slug>/front.png
frontend/public/demo-dossier/<slug>/left.png
frontend/public/demo-dossier/<slug>/right.png
```

### Consistency rules (critical for a believable mugshot card)
- Same person across all 3 angles: keep identical age, face shape, hair, beard,
  skin tone, and any identifying mark per persona.
- Neutral expression, plain **light grey studio backdrop**, even frontal
  lighting, head-and-shoulders crop, eyes open, no glasses unless specified,
  no caption/text/watermark, no uniform, plain dark t-shirt/shirt.
- Square 1:1, photoreal, ID/booking-photo style.
- **front.png** = facing camera; **left.png** = head turned ~90° to show the
  LEFT profile; **right.png** = head turned ~90° to show the RIGHT profile.

### Base prompt template (fill `[…]` per persona, run 3x with the angle line)
```
Photorealistic booking-style ID photograph of a FICTIONAL [age]-year-old
[gender] South-Indian (Karnataka) person. Face shape: [oval/round/square].
Hair: [short black, receding, etc]. Facial hair: [clean-shaven / short beard].
Skin tone: [wheatish/dark/fair]. Identifying mark: [scar on left eyebrow / mole
on right cheek / none]. Neutral expression, eyes open, plain dark shirt.
Even studio lighting, flat light-grey background, head-and-shoulders, sharp
focus, 1:1 square. No text, no watermark, no uniform. Not a real person.
ANGLE: [front, facing the camera directly]
```
Replace the ANGLE line per file with:
- front.png → `ANGLE: front, facing the camera directly, both ears visible`
- left.png  → `ANGLE: left side profile, head turned 90 degrees to show the left side of the face`
- right.png → `ANGLE: right side profile, head turned 90 degrees to show the right side of the face`

### Per-persona face briefs (use these so the 10 look distinct)
1. **Rakesh Gowda** — 38, square jaw, short black hair, thick moustache, wheatish, scar on left eyebrow.
2. **Imran Shariff** — 31, oval face, short fade haircut, short beard, medium tone, small mole right cheek.
3. **Naveen Kumar** — 45, round face, receding hairline, clean-shaven, fair, rimless-glasses look optional.
4. **Suresh Patil** — 52, broad face, greying hair, thick greying moustache, wheatish, weathered skin.
5. **Anwar Baig** — 29, lean angular face, curly short hair, light stubble, medium-dark, sharp cheekbones.
6. **Manjunath Shetty** — 41, round full face, side-parted black hair, clean-shaven, fair, double chin.
7. **Prakash Reddy** — 36, square face, slicked-back hair, trimmed beard, wheatish, intense brow.
8. **Farhan Khan** — 27, youthful oval face, trendy short hair, light stubble, medium tone, ear stud.
9. **Lokesh Naik** — 49, weathered rectangular face, short greying hair, bushy moustache, dark, sun-tanned.
10. **Vijay Rao** — 34, oval face, neat short hair, clean-shaven, fair, modern glasses.

> If the image tool can’t guarantee identity across angles, generate `front`
> first, then use it as a reference/seed for `left` and `right`.

---

## 10. Acceptance criteria (“does it work + nothing broke”)

- [ ] `GET /api/dossier/list` returns exactly **10** persons; `GET /api/dossier/{id}`
      returns nested family/banks/crimes/contacts.
- [ ] Both endpoints return **403** for a non-admin (clearance < 4) token and
      **200** for an admin token.
- [ ] `/dossier` nav item is only visible to admin/L4 users; non-admins hitting
      the URL see an “Admin access required” state.
- [ ] Face-card shows 3 images (front/left/right) for every persona; all 30
      images load from `frontend/public/demo-dossier/...`.
- [ ] Bank section shows the correct account count + total; crime history shows
      all entries; family + contacts tables render.
- [ ] **Isolation proof:** running `python -m seed.load_seed` (the synthetic
      reseed) does **not** change `SELECT count(*) FROM demo_dossier_persons`
      (still 10). Running `python -m seed.load_demo_dossier` does **not** change
      `SELECT count(*) FROM persons` / `cases`.
- [ ] `grep -nE "\b(persons|cases|case_persons|narratives|financial_)\b" backend/seed/load_demo_dossier.py backend/app/services/dossier_service.py` returns **nothing** (no cross-talk with real tables).
- [ ] Network / Profile / Forecast / Socio screens are unchanged (demo data
      never appears there because it’s in separate tables).
- [ ] Bilingual toggle still works (new i18n keys added to EN + kn-data.json).
- [ ] App boots: `uvicorn app.main:app` starts with the new router; frontend
      `bun run build` / dev compiles with the new route and `Fingerprint` import.

---

## 11. Build order (suggested)
1. Migration `004_demo_dossier.sql` → apply.
2. ORM models + Pydantic schema.
3. `demo_dossier.json` (10 personas) + `load_demo_dossier.py` → seed → verify 10 rows.
4. Service + admin-gated route + register in `main.py` → test 200/403.
5. Generate 30 AI face images → drop into `frontend/public/demo-dossier/`.
6. API client + `dossier.tsx` screen + `FaceCard` + Shell nav (admin-gated) + i18n.
7. Run the acceptance checklist (esp. the isolation proofs).
