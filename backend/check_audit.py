import asyncio
from sqlalchemy import text
from app.db.session import get_sessionmaker

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        # Check audit log rows
        res = await session.execute(text("SELECT * FROM audit_log LIMIT 5"))
        print("Audit logs:")
        for r in res.mappings().all():
            print(dict(r))

        # Check users count
        res = await session.execute(text("SELECT count(*) FROM users"))
        print("Users count:", res.scalar())

        # Check officers count
        res = await session.execute(text("SELECT count(*) FROM officers"))
        print("Officers count:", res.scalar())

if __name__ == "__main__":
    asyncio.run(main())
