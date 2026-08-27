"""Seed the 10 isolated demo dossiers. Safe and idempotent.
Usage: python -m seed.load_demo_dossier
Only TRUNCATEs demo_dossier_* tables — never the synthetic dataset.
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
from pathlib import Path
import datetime as dt
import asyncpg

SEED_FILE = Path(__file__).parent / "demo_dossier.json"


def _date(v):
    if v is None:
        return None
    if isinstance(v, str):
        return dt.date.fromisoformat(v)
    return v


from app.db.session import active_url


async def main() -> None:
    url = active_url()
    # Convert SQLAlchemy URL to asyncpg DSN
    dsn = url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        # ONLY clear demo tables — never real dataset tables
        await conn.execute("""
            DELETE FROM demo_dossier_contacts;
            DELETE FROM demo_dossier_crimes;
            DELETE FROM demo_dossier_bank_accounts;
            DELETE FROM demo_dossier_family;
            DELETE FROM demo_dossier_persons;
        """)
        data = json.loads(SEED_FILE.read_text())
        for p in data:
            pid = await conn.fetchval("""
                INSERT INTO demo_dossier_persons
                  (slug, full_name, aliases, gender, dob, age, height_cm, build,
                   complexion, identifying_marks, blood_group, nationality,
                   risk_level, wanted_status, primary_phone, secondary_phone,
                   email, home_address, district, pincode,
                   photo_front, photo_left, photo_right, summary)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                        $17,$18,$19,$20,$21,$22,$23,$24)
                RETURNING demo_id
            """,
                p["slug"], p["full_name"], p.get("aliases", []),
                p.get("gender"), _date(p.get("dob")), p.get("age"), p.get("height_cm"),
                p.get("build"), p.get("complexion"), p.get("identifying_marks"),
                p.get("blood_group"), p.get("nationality", "Indian"),
                p.get("risk_level"), p.get("wanted_status"),
                p.get("primary_phone"), p.get("secondary_phone"),
                p.get("email"), p.get("home_address"), p.get("district"),
                p.get("pincode"), p.get("photo_front"), p.get("photo_left"),
                p.get("photo_right"), p.get("summary"),
            )
            for f in p.get("family", []):
                await conn.execute("""
                    INSERT INTO demo_dossier_family
                      (demo_id, name, relation, age, phone, occupation, address, notes)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                """, pid, f["name"], f["relation"], f.get("age"), f.get("phone"),
                    f.get("occupation"), f.get("address"), f.get("notes"))
            for b in p.get("banks", []):
                await conn.execute("""
                    INSERT INTO demo_dossier_bank_accounts
                      (demo_id, bank_name, account_no, ifsc, branch, account_type,
                       balance_inr, status, opened_on, flagged, flag_reason)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                """, pid, b["bank_name"], b["account_no"], b.get("ifsc"),
                    b.get("branch"), b.get("account_type"), b.get("balance_inr"),
                    b.get("status", "Active"), _date(b.get("opened_on")), b.get("flagged", False),
                    b.get("flag_reason"))
            for c in p.get("crimes", []):
                await conn.execute("""
                    INSERT INTO demo_dossier_crimes
                      (demo_id, case_ref, crime_type, sections, role, status,
                       occurred_on, station, district, sentence, narrative)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                """, pid, c["case_ref"], c["crime_type"], c.get("sections"),
                    c.get("role"), c.get("status"), _date(c.get("occurred_on")),
                    c.get("station"), c.get("district"), c.get("sentence"),
                    c.get("narrative"))
            for ct in p.get("contacts", []):
                await conn.execute("""
                    INSERT INTO demo_dossier_contacts
                      (demo_id, label, name, relation, phone, notes)
                    VALUES ($1,$2,$3,$4,$5,$6)
                """, pid, ct.get("label"), ct.get("name"), ct.get("relation"),
                    ct.get("phone"), ct.get("notes"))
        count = await conn.fetchval("SELECT count(*) FROM demo_dossier_persons")
        print(f"[OK] Seeded {count} demo dossier persons.")
    finally:
        await conn.close()


if __name__ == "__main__":
    # Load .env
    env_file = Path(__file__).parents[1] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
    asyncio.run(main())
