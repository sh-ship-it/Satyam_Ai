"""Authentication routes.

Login:    looks up the user by username (derived from email), verifies bcrypt password.
          Falls back to demo mode (any password accepted) when APP_ENV != production
          and the user doesn't exist yet — so judges can sign in without pre-seeding.
Register: creates a new User row with bcrypt-hashed password + Officer row if needed.
          Works on both the Neon cloud DB and local PG17 (whichever DATABASE_URL points to).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal
from app.config import get_settings
from app.core.rbac import Principal, resolve_clearance, resolve_scope
from app.core.security import create_access_token, hash_password, verify_password
from app.schemas.auth import LoginRequest, LoginResponse, SessionUser, RegisterRequest, StationOption
from app.db.session import get_sessionmaker
from app.db.models import User, Officer, Station

router = APIRouter()

# ── Demo station/district/range defaults ──────────────────────────────────────
_BLR = {"district": "Bengaluru City", "range": "Commissionerates"}

_DEMO_STATIONS: dict[str, dict] = {
    "PC":    {"station_id": 1,    **_BLR},
    "HC":    {"station_id": 1,    **_BLR},
    "ASI":   {"station_id": 1,    **_BLR},
    "SI":    {"station_id": 1,    **_BLR},
    "PSI":   {"station_id": 1,    **_BLR},
    "PI":    {"station_id": 1,    **_BLR},
    "CI":    {"station_id": 1,    **_BLR},
    "DySP":  {"station_id": None, **_BLR},
    "SP":    {"station_id": None, **_BLR},
    "DIG":   {"station_id": None, "district": "", "range": "Commissionerates"},
    "IGP":   {"station_id": None, "district": "", "range": ""},
    "DGP":   {"station_id": None, "district": "", "range": ""},
    "admin":        {"station_id": None, "district": "", "range": ""},
    "investigator": {"station_id": 1,    **_BLR},
    "analyst":      {"station_id": None, "district": "", "range": ""},
    "viewer":       {"station_id": 1,    **_BLR},
}


def _db_rank(rank: str) -> str:
    """Normalise UI rank values to the DB rank_access.rank strings."""
    return {"CI": "PI", "DySP": "Dy.SP"}.get(rank, rank)


async def _get_or_create_officer(
    session: AsyncSession, name: str, rank: str, station_id: int
) -> Officer:
    db_rank = _db_rank(rank)
    stmt = select(Officer).where(Officer.rank == db_rank).limit(1)
    officer = (await session.execute(stmt)).scalar_one_or_none()
    if officer:
        return officer
    max_id = (await session.execute(select(func.max(Officer.officer_id)))).scalar() or 0
    officer = Officer(
        officer_id=max_id + 1,
        name=name,
        rank=db_rank,
        station_id=station_id,
    )
    session.add(officer)
    await session.flush()
    return officer


def _build_token_and_user(
    uid: str, name: str, rank: str, officer_id: int | None
) -> tuple[str, SessionUser]:
    clearance = resolve_clearance(rank)
    scope = resolve_scope(rank)
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


async def get_or_create_user(
    session: AsyncSession, username: str, rank: str, name: str,
    station_id: int | None = None,
    password: str | None = None,
    email: str | None = None,
    photo_b64: str | None = None,
) -> User:
    stmt = select(User).where(User.username == username)
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user:
        if station_id:
            officer_stmt = select(Officer).where(Officer.officer_id == user.officer_id)
            officer = (await session.execute(officer_stmt)).scalar_one_or_none()
            if officer:
                officer.station_id = station_id
        return user

    db_rank = _db_rank(rank)
    officer_stmt = select(Officer).where(Officer.rank == db_rank).limit(1)
    officer = (await session.execute(officer_stmt)).scalar_one_or_none()

    if not officer:
        max_id_res = await session.execute(select(func.max(Officer.officer_id)))
        new_officer_id = (max_id_res.scalar() or 0) + 1
        geo = _DEMO_STATIONS.get(rank, _DEMO_STATIONS["investigator"])
        resolved_station = station_id or geo.get("station_id", 1) or 1
        officer = Officer(
            officer_id=new_officer_id,
            name=name,
            rank=db_rank,
            station_id=resolved_station,          # use chosen station
        )
        session.add(officer)
        await session.flush()
    else:
        if station_id:
            officer.station_id = station_id

    hashed = hash_password(password) if password else hash_password("demo")
    new_user = User(
        username=username,
        password_hash=hashed,
        full_name=name,
        email=email or None,
        photo_b64=photo_b64 or None,
        officer_id=officer.officer_id,
        assigned_rank=db_rank,
        is_active=True,
    )
    session.add(new_user)
    await session.flush()
    return new_user


@router.get("/stations", response_model=list[StationOption])
async def list_stations() -> list[StationOption]:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        rows = (await session.execute(
            select(Station).order_by(Station.district, Station.station_name)
        )).scalars().all()
    return [
        StationOption(
            station_id=s.station_id,
            station_name=s.station_name,
            district=s.district,
            range_name=s.range_name,
        )
        for s in rows
    ]


# ── Login ─────────────────────────────────────────────────────────────────────
@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    settings = get_settings()
    username = (req.username or "").strip()
    if not username:
        raise HTTPException(status_code=422, detail="Email / username is required.")

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        async with session.begin():
            stmt = select(User).where(User.username == username)
            db_user = (await session.execute(stmt)).scalar_one_or_none()

            if db_user:
                # Verify password
                if settings.app_env == "production":
                    if not verify_password(req.password or "", db_user.password_hash):
                        raise HTTPException(status_code=401, detail="Invalid credentials")
                else:
                    # Dev/demo: accept correct password; empty password accepted for convenience
                    pw_ok = (not req.password) or verify_password(req.password, db_user.password_hash)
                    if not pw_ok:
                        raise HTTPException(status_code=401, detail="Invalid password")

                name = db_user.full_name or username.replace(".", " ").title()
                # Rank comes from the DB record, not the request
                assigned_rank = db_user.assigned_rank or "CI"
                officer_id = db_user.user_id
                token, user = _build_token_and_user(username, name, assigned_rank, officer_id)
                return LoginResponse(token=token, user=user)

            else:
                # No user found — user must register first; never auto-create on login
                raise HTTPException(
                    status_code=404,
                    detail="Account not found. Please create an account first."
                )


# ── Register ──────────────────────────────────────────────────────────────────
@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest) -> LoginResponse:
    settings = get_settings()
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="Self-registration disabled in production.")

    rank = req.role or req.rank or "investigator"
    clearance = resolve_clearance(rank)
    scope = resolve_scope(rank)
    geo = dict(_DEMO_STATIONS.get(rank, _DEMO_STATIONS["investigator"]))

    email = (req.email or "").strip()
    password = (req.password or "").strip()
    if not password:
        raise HTTPException(status_code=422, detail="Password is required.")

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        async with session.begin():
            # If a station was chosen, use its real district/range/id.
            if req.station_id is not None:
                st = (await session.execute(
                    select(Station).where(Station.station_id == req.station_id)
                )).scalar_one_or_none()
                if st is not None:
                    geo = {
                        "station_id": st.station_id,
                        "district": st.district,
                        "range": st.range_name,
                    }
            uid = (req.email.split("@")[0] if req.email else "").strip() or f"demo-{rank}"

            # Check username uniqueness before creating/fetching
            stmt = select(User).where(User.username == uid)
            existing = (await session.execute(stmt)).scalar_one_or_none()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"Username '{uid}' is already taken. Use a different name or email."
                )

            db_user = await get_or_create_user(
                session, uid, rank, req.name.strip() or uid.title(),
                station_id=req.station_id,
                password=password,
                email=email or None,
                photo_b64=req.photo_b64 or None,
            )
            user_id = db_user.user_id

    user = SessionUser(
        id=uid,
        name=req.name.strip() or uid.title(),
        rank=rank,
        scope=scope,
        clearance=clearance,
        station_id=geo["station_id"],
        district=geo["district"],
        range_name=geo["range"],
    )
    token = create_access_token(
        subject=user.id,
        name=user.name,
        rank=rank,
        scope=scope,
        clearance=clearance,
        station_id=geo["station_id"],
        district=geo["district"],
        range_name=geo["range"],
        officer_id=user_id,
    )
    return LoginResponse(token=token, user=user)


# ── Me ────────────────────────────────────────────────────────────────────────
@router.get("/me", response_model=SessionUser)
async def me(principal: Principal = Depends(get_principal)) -> SessionUser:
    return SessionUser(
        id=principal.id,
        name=principal.name,
        rank=principal.rank,
        scope=principal.scope,
        clearance=principal.clearance,
        station_id=principal.station_id,
        district=principal.district,
        range_name=principal.range_name,
    )
