"""Load synthetic data into Postgres and compute narrative embeddings.

Usage:  python -m seed.seed
Requires DATABASE_URL and an applied 001_init.sql. Idempotent (upserts).
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.models.registry import get_embedder
from seed.synthetic import generate


def _seed_engine():
    # Seeding performs INSERTs, so it must connect with the owner/superuser URL
    # (SEED_DATABASE_URL), never the least-privilege runtime role used by the API.
    url = os.environ.get("SEED_DATABASE_URL") or get_settings().database_url
    return create_async_engine(url, future=True)


async def _vec_literal(embedder, txt: str) -> str:
    [v] = await embedder.embed([txt])
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


async def main() -> None:
    data = generate()
    embedder = get_embedder()
    engine = _seed_engine()
    async with engine.begin() as conn:
        for s in data["stations"]:
            await conn.execute(text(
                "INSERT INTO stations(station_id,name,zone,district,lat,lng) "
                "VALUES(:station_id,:name,:zone,:district,:lat,:lng) "
                "ON CONFLICT (station_id) DO NOTHING"), s)
        for o in data["officers"]:
            await conn.execute(text(
                "INSERT INTO officers(officer_id,name,rank,station_id) "
                "VALUES(:officer_id,:name,:rank,:station_id) "
                "ON CONFLICT (officer_id) DO NOTHING"), o)
        for p in data["persons"]:
            await conn.execute(text(
                "INSERT INTO persons(person_id,name,age,gender,role_type) "
                "VALUES(:person_id,:name,:age,:gender,:role_type) "
                "ON CONFLICT (person_id) DO NOTHING"), p)
        import datetime
        for c in data["cases"]:
            c_data = dict(c)
            if isinstance(c_data.get("date"), str):
                c_data["date"] = datetime.date.fromisoformat(c_data["date"])
            await conn.execute(text(
                "INSERT INTO cases(fir_no,date,ipc_sections,crime_type,status,"
                "station_id,lat,lng,district,zone,sensitivity_flag,jurisdiction_id) "
                "VALUES(:fir_no,:date,:ipc_sections,:crime_type,:status,:station_id,"
                ":lat,:lng,:district,:zone,:sensitivity_flag,:jurisdiction_id) "
                "ON CONFLICT (fir_no) DO NOTHING"), c_data)
        for cp in data["case_persons"]:
            await conn.execute(text(
                "INSERT INTO case_persons(case_id,person_id,role) "
                "VALUES(:case_id,:person_id,:role) ON CONFLICT DO NOTHING"), cp)
        for n in data["narratives"]:
            vec = await _vec_literal(embedder, n["text"])
            await conn.execute(text(
                "INSERT INTO narratives(case_id,text,embedding) "
                "VALUES(:case_id,:text,CAST(:embedding AS vector)) "
                "ON CONFLICT (case_id) DO UPDATE SET text=EXCLUDED.text, "
                "embedding=EXCLUDED.embedding"),
                {"case_id": n["case_id"], "text": n["text"], "embedding": vec})
    print(f"Seeded {len(data['cases'])} cases, {len(data['persons'])} persons.")


if __name__ == "__main__":
    asyncio.run(main())
