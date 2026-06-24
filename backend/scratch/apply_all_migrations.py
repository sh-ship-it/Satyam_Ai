import asyncio
import os
import sys
import asyncpg

# Connection URL for superuser/owner privileges
# Converting postgresql+asyncpg:// to postgresql:// for standard asyncpg
ADMIN_URL = "postgresql://postgres:postgres@localhost:5432/satyam"

# Order of incremental migrations to apply
MIGRATIONS = [
    "003_add_ps4_ps7_tables.sql",
    "003_users_extend.sql",
    "004_demo_dossier.sql",
    "005_boards.sql",
    "006_admin_access_control.sql",
    "008_local_app_grants.sql"
]

async def apply_migrations():
    print("[INFO] Connecting to local DB as superuser/postgres using raw asyncpg...")
    try:
        conn = await asyncpg.connect(ADMIN_URL)
        print("[SUCCESS] Connected to local DB.")
    except Exception as e:
        print(f"[ERROR] Failed to connect to local DB: {e}")
        sys.exit(1)

    migrations_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations")
    print(f"[INFO] Migrations directory: {migrations_dir}")

    try:
        for migration_file in MIGRATIONS:
            filepath = os.path.join(migrations_dir, migration_file)
            if not os.path.exists(filepath):
                print(f"[WARNING] Migration file not found, skipping: {migration_file}")
                continue

            print(f"\n[INFO] Applying migration: {migration_file}...")
            with open(filepath, "r", encoding="utf-8") as f:
                sql_content = f.read()

            try:
                # asyncpg's execute method natively supports multi-statement scripts
                await conn.execute(sql_content)
                print(f"[SUCCESS] Applied: {migration_file}")
            except Exception as e:
                print(f"[ERROR] Failed to apply {migration_file}: {e}")

        # Re-verify all tables in public schema
        print("\n[INFO] Verification: Checking all tables in public schema...")
        rows = await conn.fetch("""
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename;
        """)
        print("All Current Tables:")
        for r in rows:
            print(f"  - {r['tablename']}")

    finally:
        await conn.close()
        print("\n[INFO] Connection closed.")

if __name__ == "__main__":
    asyncio.run(apply_migrations())
