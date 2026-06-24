import asyncio
import time
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    # Connect directly as the superuser/owner to bypass RLS
    url = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        t0 = time.time()
        # Query without LIMIT
        sql = text("""
            SELECT to_char(date_trunc('month', report_date), 'YYYY-MM') AS period,
                   crime_type, district, COUNT(*) AS cnt
            FROM cases 
            WHERE report_date IS NOT NULL
            GROUP BY 1, crime_type, district
            ORDER BY 1 DESC, cnt DESC
        """)
        r = await conn.execute(sql)
        rows = r.mappings().all()
        t1 = time.time()
        print(f"Query returned {len(rows)} rows in {t1 - t0:.3f} seconds.")
        total_cnt = sum(int(row["cnt"]) for row in rows)
        print(f"Sum of cnt: {total_cnt}")
        
        # Also let's check total rows in cases table
        r_total = await conn.execute(text("SELECT count(*) FROM cases"))
        print("Total cases in DB:", r_total.scalar())

if __name__ == "__main__":
    asyncio.run(main())
