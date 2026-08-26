import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Never hardcode a connection string with a password here — this file is tracked
# in git, which is how the Neon credential ended up in history. Read the URLs the
# app already resolves from the gitignored .env instead.
import os

LOCAL_URL = os.environ.get(
    "LOCAL_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/satyam"
)
CLOUD_URL = os.environ.get("DATABASE_URL", "")
if not CLOUD_URL:
    raise SystemExit(
        "DATABASE_URL is not set. Load backend/.env first, e.g. in PowerShell:\n"
        '  Get-Content backend/.env | ForEach-Object { if ($_ -match "^([A-Z_]+)=(.*)$") '
        '{ [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2]) } }'
    )

async def check_db(name, url):
    print(f"\n--- Checking {name} Database ---")
    try:
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            # Check users
            res = await conn.execute(text("SELECT user_id, username, password_hash, is_active FROM users"))
            users = res.fetchall()
            print(f"Users found ({len(users)}):")
            for u in users:
                print(f"  - ID: {u[0]}, Username: {u[1]}, Hash: {u[2][:20]}..., Active: {u[3]}")
    except Exception as e:
        print(f"[ERROR] Failed to check {name} DB: {e}")

async def main():
    await check_db("Local", LOCAL_URL)
    await check_db("Cloud", CLOUD_URL)

if __name__ == "__main__":
    asyncio.run(main())
