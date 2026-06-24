import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

APP_URL = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"


async def main():
    app = create_async_engine(APP_URL)
    async with app.connect() as conn:
        # Replicate apply_rls_context for a DGP (state scope, clearance 4)
        await conn.execute(text(
            "SELECT set_config('app.scope','state',true),"
            " set_config('app.range','',true),"
            " set_config('app.district','',true),"
            " set_config('app.station_id','',true),"
            " set_config('app.clearance','4',true),"
            " set_config('app.officer_id','',true)"
        ))
        for tbl in ("cases", "persons", "narratives", "stations"):
            try:
                n = (await conn.execute(text(f"select count(*) from {tbl}"))).scalar()
                print(f"RLS-scoped {tbl:12} rows={n}")
            except Exception as e:
                print(f"RLS-scoped {tbl:12} ERR: {str(e)[:90]}")
    await app.dispose()

    # Which app tables exist at all in local?
    sup = create_async_engine("postgresql+asyncpg://postgres:postgres@localhost:5432/satyam")
    async with sup.connect() as conn:
        rows = (await conn.execute(text(
            "select tablename from pg_tables where schemaname='public' order by tablename"
        ))).fetchall()
        print("TABLES:", [r[0] for r in rows])
    await sup.dispose()


asyncio.run(main())
