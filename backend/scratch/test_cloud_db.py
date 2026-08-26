import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Never hardcode a connection string with a password here — this file is tracked
# in git, which is how the Neon credential ended up in history.
import os

CLOUD_URL = os.environ.get("DATABASE_URL", "")
if not CLOUD_URL:
    raise SystemExit("DATABASE_URL is not set. Load backend/.env before running.")

async def main():
    print("[INFO] Testing connection to Cloud Neon DB...")
    try:
        engine = create_async_engine(CLOUD_URL)
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT 1"))
            print(f"[SUCCESS] Connected successfully! Result: {res.scalar()}")
    except Exception as e:
        print(f"[ERROR] Failed to connect to Cloud DB: {e}")

if __name__ == "__main__":
    asyncio.run(main())
