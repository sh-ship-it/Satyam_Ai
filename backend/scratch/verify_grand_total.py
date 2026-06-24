import asyncio
import httpx

BASE = "http://localhost:8000"


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        # Login on cloud
        r = await c.post("/auth/login", json={"username": "demo", "password": ""})
        token = r.json()["token"]

        # Switch to local
        r2 = await c.post(
            "/settings/db-source",
            json={"source": "local"},
            headers={"Authorization": f"Bearer {token}"},
        )
        print("Switched to local:", r2.json())

        # Re-login on local DB
        r3 = await c.post("/auth/login", json={"username": "demo", "password": ""})
        token3 = r3.json()["token"]
        user3 = r3.json()["user"]
        print("Local user scope:", user3.get("scope"))

        # Station breakdown
        r4 = await c.post(
            "/map/station-breakdown",
            json={"mode": "by_crime", "limit": 25},
            headers={"Authorization": f"Bearer {token3}"},
        )
        print("Station breakdown status:", r4.status_code)
        if r4.status_code == 200:
            d = r4.json()
            total_rows = d.get("total")
            grand = d.get("grand_total")
            print(f"total (rows returned): {total_rows}")
            print(f"grand_total (real DB count): {grand}")
            top3 = [f"{r['station']}={r['firs']}" for r in d.get("rows", [])[:3]]
            print("Top 3 stations:", top3)
        else:
            print(r4.text[:300])

        # Switch back to cloud
        await c.post(
            "/settings/db-source",
            json={"source": "cloud"},
            headers={"Authorization": f"Bearer {token}"},
        )
        print("Switched back to cloud")


asyncio.run(main())
