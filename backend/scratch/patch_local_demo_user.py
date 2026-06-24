import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

URLS = [
    "postgresql+asyncpg://postgres:postgres@localhost:5432/satyam",
    "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam",
    "postgresql+asyncpg://postgres:@localhost:5432/satyam",
]

PATCH = "UPDATE users SET scope_override='state', clearance_override=4"
CHECK = "SELECT username, assigned_rank, scope_override, clearance_override FROM users"


async def main():
    for url in URLS:
        host = url.split("@")[1]
        print(f"Trying {host} ...")
        try:
            engine = create_async_engine(url)
            async with engine.begin() as conn:
                result = await conn.execute(text(PATCH))
                print(f"  Updated {result.rowcount} user(s)")
                rows = (await conn.execute(text(CHECK))).fetchall()
                for r in rows:
                    print(f"  {r}")
            await engine.dispose()
            print("DONE - restart backend for changes to apply")
            return
        except Exception as e:
            print(f"  FAIL: {str(e)[:200]}")

    print("ERROR: could not connect with any admin URL")
    print("Run manually in psql:")
    print("  UPDATE users SET scope_override='state', clearance_override=4;")


asyncio.run(main())
