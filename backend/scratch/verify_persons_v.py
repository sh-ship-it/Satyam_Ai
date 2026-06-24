import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

APP_URL = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"

async def main():
    engine = create_async_engine(APP_URL)
    try:
        async with engine.connect() as conn:
            # Set security context for RLS
            await conn.execute(text(
                "SELECT set_config('app.scope','state',true),"
                " set_config('app.range','',true),"
                " set_config('app.district','',true),"
                " set_config('app.station_id','',true),"
                " set_config('app.clearance','4',true),"
                " set_config('app.officer_id','',true)"
            ))
            res = await conn.execute(text("SELECT COUNT(*) FROM persons_v"))
            count = res.scalar()
            print(f"[SUCCESS] Successfully read persons_v view. Count: {count}")
    except Exception as e:
        print(f"[ERROR] Failed to read persons_v view: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
