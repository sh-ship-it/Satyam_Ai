import asyncio
import httpx

BASE = "http://localhost:8000"

async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        # Login (empty password for cloud/dev demo)
        r = await c.post("/auth/login", json={"username": "demo", "password": ""})
        if r.status_code != 200:
            print(f"Login failed: {r.status_code} - {r.text}")
            return
        
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("Logged in successfully.")

        # Switch to local
        r = await c.post("/settings/db-source", json={"source": "local"}, headers=headers)
        print("Switched to local:", r.json())

        # Call trends endpoint
        r = await c.get("/api/trends", headers=headers)
        print("Trends response status:", r.status_code)
        if r.status_code == 200:
            data = r.json()
            series = data.get("series", [])
            print(f"Number of series points: {len(series)}")
            total_cases_in_series = sum(p["count"] for p in series)
            print(f"Sum of cases in trends series: {total_cases_in_series}")
            if len(series) > 0:
                print("First few points:")
                for p in series[:5]:
                    print("  ", p)
        
        # Switch back to cloud
        r = await c.post("/settings/db-source", json={"source": "cloud"}, headers=headers)
        print("Switched back to cloud:", r.json())

if __name__ == "__main__":
    asyncio.run(main())
