import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    url = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        # Get all rows
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
        total_rows = len(rows)
        total_cases = sum(int(row["cnt"]) for row in rows)
        print(f"Total combinations (rows): {total_rows}")
        print(f"Total cases: {total_cases}")
        
        # Test different limits
        for limit in [120, 500, 1000, 2000, 5000, 10000]:
            sub_rows = rows[:limit]
            sub_cases = sum(int(row["cnt"]) for row in sub_rows)
            pct = (sub_cases / total_cases) * 100
            print(f"Limit {limit:5d}: covers {sub_cases:6d} cases ({pct:.2f}%) using {len(sub_rows)} rows.")

if __name__ == "__main__":
    asyncio.run(main())
