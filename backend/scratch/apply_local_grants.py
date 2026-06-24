import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Connection URLs to try for superuser / owner privileges
ADMIN_URLS = [
    "postgresql+asyncpg://postgres:postgres@localhost:5432/satyam",
    "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
]

# Connection URL for the runtime app role
APP_URL = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"

async def run_grants():
    engine = None
    connected_url = None
    
    # 1. Connect as admin/owner
    for url in ADMIN_URLS:
        try:
            temp_engine = create_async_engine(url)
            async with temp_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            engine = temp_engine
            connected_url = url
            print(f"[INFO] Successfully connected to local DB using admin URL: {url.replace(':postgres@', ':***@').replace(':satyam@', ':***@')}")
            break
        except Exception as e:
            print(f"[INFO] Could not connect using {url.split('@')[-1]}: {e}")
            
    if not engine:
        print("[ERROR] Failed to connect to local database with any admin credentials. Please ensure PostgreSQL is running locally on port 5432.")
        sys.exit(1)
        
    try:
        async with engine.connect() as conn:
            # 2. Check existing tables and their owners
            print("[INFO] Inspecting tables and their owners...")
            result = await conn.execute(text("""
                SELECT tablename, tableowner 
                FROM pg_tables 
                WHERE schemaname = 'public'
                ORDER BY tablename;
            """))
            tables = result.fetchall()
            print("Current Tables:")
            for t in tables:
                print(f"  - {t[0]} (Owner: {t[1]})")
                
            # 3. Apply the grants from 008_local_app_grants.sql
            print("\n[INFO] Applying grants to satyam_app role...")
            
            statements = [
                "GRANT USAGE ON SCHEMA public TO satyam_app;",
                "GRANT SELECT ON ALL TABLES IN SCHEMA public TO satyam_app;",
                "GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO satyam_app;",
                "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO satyam_app;",
                "REVOKE UPDATE, DELETE ON audit_log FROM satyam_app;"
            ]
            
            # Add default privilege alters for both postgres and satyam roles to be safe
            for role in ["postgres", "satyam"]:
                statements.extend([
                    f"ALTER DEFAULT PRIVILEGES FOR ROLE {role} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satyam_app;",
                    f"ALTER DEFAULT PRIVILEGES FOR ROLE {role} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO satyam_app;"
                ])
                
            for stmt in statements:
                try:
                    await conn.execute(text(stmt))
                    print(f"  [SUCCESS] {stmt}")
                except Exception as e:
                    print(f"  [FAILED] {stmt}: {e}")
                    
            await conn.commit()
            print("[INFO] All grant statements executed and committed.")
            
    finally:
        await engine.dispose()
        
    # 4. Verify using the satyam_app role
    print("\n[INFO] Verifying permissions as satyam_app...")
    app_engine = create_async_engine(APP_URL)
    try:
        async with app_engine.connect() as conn:
            # Replicate security context setting if RLS is enabled, so queries don't fail RLS checks
            try:
                await conn.execute(text(
                    "SELECT set_config('app.scope','state',true),"
                    " set_config('app.range','',true),"
                    " set_config('app.district','',true),"
                    " set_config('app.station_id','',true),"
                    " set_config('app.clearance','4',true),"
                    " set_config('app.officer_id','',true)"
                ))
            except Exception as e:
                print(f"  [WARNING] Could not set RLS context: {e}")
                
            # Query each table
            for t in tables:
                table_name = t[0]
                try:
                    res = await conn.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
                    count = res.scalar()
                    print(f"  [OK] Readable table '{table_name}': {count} rows")
                except Exception as e:
                    print(f"  [ERROR] Cannot read table '{table_name}': {e}")
    except Exception as e:
        print(f"[ERROR] Failed to connect or query as satyam_app: {e}")
    finally:
        await app_engine.dispose()

if __name__ == "__main__":
    asyncio.run(run_grants())
