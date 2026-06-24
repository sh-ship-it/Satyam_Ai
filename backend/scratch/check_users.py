import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

LOCAL_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/satyam"
CLOUD_URL = "postgresql+asyncpg://neondb_owner:npg_7qDbsmiyR2Jt@ep-misty-haze-ad33z23j-pooler.c-2.us-east-1.aws.neon.tech/neondb?ssl=require"

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
