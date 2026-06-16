import asyncio
from sqlalchemy import text, select, func
from app.db.session import get_sessionmaker
from app.db.models import User, Officer

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        async with session.begin():
            # Get max officer ID
            max_id_res = await session.execute(select(func.max(Officer.officer_id)))
            max_id = max_id_res.scalar() or 0
            new_officer_id = max_id + 1
            print("New officer ID:", new_officer_id)

            # Let's insert a new officer with a DB-valid rank e.g. "Dy.SP"
            new_officer = Officer(
                officer_id=new_officer_id,
                name="Test Officer Name 2",
                rank="Dy.SP",
                station_id=1
            )
            session.add(new_officer)
            await session.flush()
            print("Officer inserted.")

            # Let's insert a user mapping to this officer
            new_user = User(
                username="test_username_unique_2",
                password_hash="test_pwd",
                officer_id=new_officer_id,
                assigned_rank="Dy.SP",
                is_active=True
            )
            session.add(new_user)
            await session.flush()
            print("User inserted with ID:", new_user.user_id)

if __name__ == "__main__":
    asyncio.run(main())
