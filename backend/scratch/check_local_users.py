import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

LOCAL_URL = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"

async def main():
    engine = create_async_engine(LOCAL_URL)
    async with engine.connect() as conn:
        # Check users
        print("=== USERS ===")
        rows = await conn.execute(text(
            "SELECT username, assigned_rank, scope_override, clearance_override FROM users LIMIT 20"
        ))
        for r in rows:
            print(r)

        # Check total case count
        print("\n=== CASE COUNT ===")
        cnt = await conn.execute(text("SELECT COUNT(*) FROM cases"))
        print(f"Total cases: {cnt.scalar()}")

        # Simulate the demo user scope (DGP rank => state scope)
        # Check how many cases visible with state scope
        print("\n=== CASES WITH STATE SCOPE (should be all) ===")
        await conn.execute(text("SET LOCAL app.scope = 'state'"))
        await conn.execute(text("SET LOCAL app.clearance = '4'"))
        try:
            cnt2 = await conn.execute(text("SELECT COUNT(*) FROM cases"))
            print(f"Cases visible with state scope: {cnt2.scalar()}")
        except Exception as e:
            print(f"Error: {e}")

        # Check with station scope station_id=1
        print("\n=== CASES WITH STATION SCOPE (station_id=1) ===")
        await conn.execute(text("SET LOCAL app.scope = 'station'"))
        await conn.execute(text("SET LOCAL app.station_id = '1'"))
        try:
            cnt3 = await conn.execute(text("SELECT COUNT(*) FROM cases"))
            print(f"Cases visible with station scope id=1: {cnt3.scalar()}")
        except Exception as e:
            print(f"Error: {e}")

asyncio.run(main())
