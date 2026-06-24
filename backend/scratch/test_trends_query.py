import asyncio
import time
from sqlalchemy import text
from app.db.session import get_sessionmaker, set_db_source

async def main():
    set_db_source("local")
    sm = get_sessionmaker()
    async with sm() as session:
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
        r = await session.execute(sql)
        rows = r.mappings().all()
        t1 = time.time()
        print(f"Query returned {len(rows)} rows in {t1 - t0:.3f} seconds.")
        total_cnt = sum(int(row["cnt"]) for row in rows)
        print(f"Sum of cnt: {total_cnt}")

if __name__ == "__main__":
    asyncio.run(main())
