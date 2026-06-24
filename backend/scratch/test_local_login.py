import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import select, text
from app.db.session import set_db_source, get_sessionmaker
from app.db.models import User

async def main():
    print("[INFO] Setting database source to 'local'...")
    set_db_source("local")
    
    sessionmaker = get_sessionmaker()
    print("[INFO] Attempting to query User table on local database...")
    try:
        async with sessionmaker() as session:
            async with session.begin():
                stmt = select(User).where(User.username == "officer1")
                result = await session.execute(stmt)
                db_user = result.scalar_one_or_none()
                if db_user:
                    print(f"[SUCCESS] Found user: {db_user.username}, Hash: {db_user.password_hash[:20]}...")
                else:
                    print("[INFO] User 'officer1' not found, but query succeeded.")
    except Exception as e:
        print("[ERROR] Query failed!")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
