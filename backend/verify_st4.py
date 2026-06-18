import asyncio
from app.db.session import get_sessionmaker
from app.db.models import Station
from sqlalchemy import select

async def main():
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        rows = (await session.execute(select(Station).order_by(Station.district, Station.station_name).limit(30))).scalars().all()
        for r in rows:
            print(f"{r.station_id}: {r.station_name} -> district={repr(r.district)} range={repr(r.range_name)}")

if __name__ == '__main__':
    asyncio.run(main())
