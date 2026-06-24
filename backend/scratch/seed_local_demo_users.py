"""
Seed the local PostgreSQL with demo users that match what the cloud DB has,
so the frontend can auto-login the same way in both environments.

Run once after migration + bulk data load:
    .venv\Scripts\python.exe scratch\seed_local_demo_users.py

Safe to run multiple times (idempotent).
"""
import asyncio
import hashlib
import os
import bcrypt
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Try admin URL first, fall back to app user
URLS = [
    "postgresql+asyncpg://postgres:postgres@localhost:5432/satyam",
    "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam",
    "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam",
]

# Hash a password the same way the backend does:  bcrypt.hashpw(pw.encode(), bcrypt.gensalt())
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


DEMO_USERS = [
    # username, full_name, rank, password, scope_override, clearance_override
    ("demo",     "Demo DGP",   "DGP",   "demo",     "state",  4),
    ("officer1", "Officer One","PSI",    "officer1", "state",  4),
]


INSERT_OFFICER_SQL = """
INSERT INTO officers (officer_id, name, rank, station_id)
VALUES (:officer_id, :name, :rank, :station_id)
ON CONFLICT (officer_id) DO NOTHING;
"""

INSERT_USER_SQL = """
INSERT INTO users (
    username, password_hash, full_name, email,
    officer_id, assigned_rank, is_active,
    scope_override, clearance_override
)
VALUES (
    :username, :password_hash, :full_name, :email,
    :officer_id, :rank, TRUE,
    :scope_override, :clearance_override
)
ON CONFLICT (username) DO UPDATE SET
    scope_override     = EXCLUDED.scope_override,
    clearance_override = EXCLUDED.clearance_override,
    password_hash      = EXCLUDED.password_hash,
    is_active          = TRUE;
"""


async def seed(url: str) -> bool:
    engine = create_async_engine(url, echo=False)
    try:
        async with engine.begin() as conn:
            # Get current max officer_id
            max_id = (await conn.execute(text("SELECT COALESCE(MAX(officer_id),0) FROM officers"))).scalar()
            # Get the first station_id for FK
            first_station = (await conn.execute(text("SELECT station_id FROM stations LIMIT 1"))).scalar() or 1

            for i, (username, full_name, rank, password, scope, clearance) in enumerate(DEMO_USERS):
                # Find or create officer
                existing_officer = (await conn.execute(
                    text("SELECT officer_id FROM officers WHERE rank = :rank LIMIT 1"), {"rank": rank}
                )).scalar()

                if existing_officer:
                    officer_id = existing_officer
                else:
                    officer_id = max_id + i + 1
                    await conn.execute(text(INSERT_OFFICER_SQL), {
                        "officer_id": officer_id,
                        "name": full_name,
                        "rank": rank,
                        "station_id": first_station,
                    })

                pw_hash = hash_pw(password)
                await conn.execute(text(INSERT_USER_SQL), {
                    "username": username,
                    "password_hash": pw_hash,
                    "full_name": full_name,
                    "email": f"{username}@ksp.local",
                    "officer_id": officer_id,
                    "rank": rank,
                    "scope_override": scope,
                    "clearance_override": clearance,
                })
                print(f"  Upserted user: {username!r} (rank={rank}, scope={scope}, clearance=L{clearance})")

        print("Done.")
        return True
    except Exception as e:
        print(f"  FAIL: {e}")
        return False
    finally:
        await engine.dispose()


async def main():
    print("Seeding local DB demo users ...\n")
    for url in URLS:
        host = url.split("@")[1]
        print(f"Connecting via {host} ...")
        if await seed(url):
            return
    print("\nERROR: Could not connect. Run manually in psql:")
    print("  INSERT INTO users (username,...) VALUES ('demo',...)")


asyncio.run(main())
