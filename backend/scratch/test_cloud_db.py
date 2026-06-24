import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

CLOUD_URL = "postgresql+asyncpg://neondb_owner:npg_7qDbsmiyR2Jt@ep-misty-haze-ad33z23j-pooler.c-2.us-east-1.aws.neon.tech/neondb?ssl=require"

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
