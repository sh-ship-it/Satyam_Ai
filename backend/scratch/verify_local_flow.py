"""Quick verification that local demo user can login via HTTP."""
import asyncio
import httpx

BASE = "http://localhost:8000"


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        # 1. Test demo user login
        print("=== Testing demo user login ===")
        r = await c.post("/auth/login", json={"username": "demo", "password": "demo"})
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            user = data.get("user", {})
            print(f"User: {user.get('name')} | rank={user.get('rank')} | scope={user.get('scope')} | clearance={user.get('clearance')}")
            token = data["token"]

            # 2. Switch to local DB
            print("\n=== Switching to local DB ===")
            r2 = await c.post(
                "/settings",
                json={"source": "local"},
                headers={"Authorization": f"Bearer {token}"},
            )
            print(f"Status: {r2.status_code} | {r2.json()}")

            # 3. Re-login to pick up local DB user
            print("\n=== Re-login after switch ===")
            r3 = await c.post("/auth/login", json={"username": "demo", "password": "demo"})
            print(f"Status: {r3.status_code}")
            if r3.status_code == 200:
                user3 = r3.json().get("user", {})
                token3 = r3.json()["token"]
                print(f"User: {user3.get('name')} | rank={user3.get('rank')} | scope={user3.get('scope')}")

                # 4. Count hotspots
                print("\n=== Map hotspots (local DB) ===")
                r4 = await c.post(
                    "/map/hotspots",
                    json={"mode": "by_crime"},
                    headers={"Authorization": f"Bearer {token3}"},
                )
                print(f"Status: {r4.status_code}")
                if r4.status_code == 200:
                    d = r4.json()
                    print(f"Total: {d.get('total')} | Points: {len(d.get('points', []))}")
                else:
                    print(r4.text[:300])
            else:
                print(r3.text[:300])
        else:
            print(r.text[:300])

        # Switch back to cloud
        if r.status_code == 200:
            token_tmp = r.json()["token"]
            await c.post("/settings", json={"source": "cloud"}, headers={"Authorization": f"Bearer {token_tmp}"})
            print("\nSwitched back to cloud DB")


asyncio.run(main())
