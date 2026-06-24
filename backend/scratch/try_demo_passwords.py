import asyncio
import httpx


async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=10) as c:
        for pw in ["DGP", "", "demo", "admin", "officer1"]:
            r = await c.post("/auth/login", json={"username": "demo", "password": pw})
            detail = r.json().get("detail") or r.json().get("user", {}).get("scope")
            print(f"  pw={pw!r}: {r.status_code} {detail}")


asyncio.run(main())
