"""
Satyam — One-time geocoder for case crime locations.

Fills cases.latitude / cases.longitude from cases.place_of_offence using the
free OpenStreetMap Nominatim service (no API key). Run once after seeding so
the voice "show on map" action and the heatmap have coordinates to plot.

Usage:
    # Cloud (Neon) — default (uses DATABASE_URL / SEED_DATABASE_URL / settings)
    python -m seed.geocode_cases

    # Local Postgres
    python -m seed.geocode_cases --local

    # Limit how many rows to process this run (resumable — safe to re-run)
    python -m seed.geocode_cases --limit 500

    # Re-geocode everything, even rows that already have coordinates
    python -m seed.geocode_cases --force

Notes:
  - Respects Nominatim's usage policy: max ~1 request/second, descriptive
    User-Agent, results cached per unique place string (so repeated places cost
    one lookup).
  - Idempotent & resumable: only NULL-coordinate rows are processed unless
    --force is passed. Safe to Ctrl-C and re-run.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SatyamCrimeIntel/1.0 (KSP Datathon; geocoder)"
# Appended to every query to keep results in-state and improve match quality.
REGION_SUFFIX = ", Karnataka, India"
RATE_LIMIT_SECONDS = 1.1  # Nominatim policy: <= 1 request/second


def get_url(local: bool) -> str:
    """Resolve a plain asyncpg DSN, mirroring seed/load_seed.py."""
    if local:
        return "postgresql://satyam:satyam@localhost:5432/satyam"
    raw = os.environ.get("DATABASE_URL") or os.environ.get("SEED_DATABASE_URL")
    if raw:
        return raw.replace("postgresql+asyncpg://", "postgresql://")
    # Fall back to settings
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.config import get_settings
    url = get_settings().seed_database_url
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def geocode(client: httpx.AsyncClient, place: str) -> tuple[float, float] | None:
    """Return (lat, lng) for a place string, or None if not found."""
    params = {
        "q": f"{place}{REGION_SUFFIX}",
        "format": "json",
        "limit": "1",
        "countrycodes": "in",
    }
    try:
        resp = await client.get(
            NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # network / rate-limit / parse — skip, don't crash the run
        print(f"  ! geocode error for {place!r}: {exc}")
        return None
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Geocode cases.place_of_offence -> lat/lng"
    )
    parser.add_argument("--local", action="store_true", help="Use local Postgres")
    parser.add_argument("--limit", type=int, default=0, help="Max rows this run (0 = all)")
    parser.add_argument(
        "--force", action="store_true", help="Re-geocode rows that already have coords"
    )
    args = parser.parse_args()

    url = get_url(args.local)
    ssl = "require" if (".neon.tech" in url or "sslmode=require" in url) else None
    conn: asyncpg.Connection = await asyncpg.connect(url, ssl=ssl)

    where = "place_of_offence IS NOT NULL AND TRIM(place_of_offence) <> ''"
    if not args.force:
        where += " AND (latitude IS NULL OR longitude IS NULL)"
    limit_sql = f" LIMIT {int(args.limit)}" if args.limit > 0 else ""
    rows = await conn.fetch(
        f"SELECT case_id, place_of_offence FROM cases WHERE {where} "
        f"ORDER BY case_id{limit_sql}"
    )
    print(f"Geocoding {len(rows)} case(s)…")

    cache: dict[str, tuple[float, float] | None] = {}
    updated = 0
    misses = 0
    async with httpx.AsyncClient(timeout=20.0) as client:
        for i, row in enumerate(rows, 1):
            place = (row["place_of_offence"] or "").strip()
            key = place.lower()
            if key not in cache:
                cache[key] = await geocode(client, place)
                await asyncio.sleep(RATE_LIMIT_SECONDS)  # sleep only on real network calls
            coords = cache[key]
            if coords is None:
                misses += 1
                continue
            lat, lng = coords
            await conn.execute(
                "UPDATE cases SET latitude = $1, longitude = $2 WHERE case_id = $3",
                lat, lng, row["case_id"],
            )
            updated += 1
            if i % 25 == 0 or i == len(rows):
                print(
                    f"  [{i}/{len(rows)}] updated={updated} "
                    f"misses={misses} unique_places={len(cache)}"
                )

    await conn.close()
    print(
        f"Done. Updated {updated} row(s); {misses} unmatched; "
        f"{len(cache)} unique places looked up."
    )


if __name__ == "__main__":
    asyncio.run(main())
