"""
Load the 3 new PS4/PS7 CSV files into Postgres (Neon or local).

Usage:
  python seed/load_new_tables.py --db neon
  python seed/load_new_tables.py --db local
  python seed/load_new_tables.py --db both   (default)

The script reads DATABASE_URL / LOCAL_DATABASE_URL / SEED_DATABASE_URL
from the .env file (same as the rest of the project).
"""
from __future__ import annotations

import asyncio
import csv
import os
import sys
import argparse
from pathlib import Path

# ── locate the .env and CSV dir ───────────────────────────────────────────────
ROOT    = Path(__file__).resolve().parents[1]          # backend/
ENV_FILE = ROOT / ".env"
CSV_DIR  = ROOT / "seed" / "satyam_synthetic_dataset"

def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# ── asyncpg helpers ───────────────────────────────────────────────────────────
try:
    import asyncpg
except ImportError:
    sys.exit("asyncpg not installed. Run: pip install asyncpg")


def _parse_url(url: str) -> str:
    """Convert SQLAlchemy+asyncpg URL to plain asyncpg URL."""
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def _get_conn(url: str) -> "asyncpg.Connection":
    plain = _parse_url(url)
    ssl = "require" if "ssl=require" in plain or "sslmode=require" in plain else None
    plain = plain.split("?")[0]  # strip query string; asyncpg takes ssl kwarg
    return await asyncpg.connect(plain, ssl=ssl)


# ── loaders ───────────────────────────────────────────────────────────────────

async def load_socio(conn: "asyncpg.Connection") -> int:
    path = CSV_DIR / "district_socio_economic_indicators.csv"
    rows = []
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append((
                r["district"],
                int(r["population"]) if r["population"] else None,
                float(r["literacy_rate"]) if r["literacy_rate"] else None,
                float(r["urbanization_percent"]) if r["urbanization_percent"] else None,
                float(r["income_index"]) if r["income_index"] else None,
                float(r["unemployment_proxy"]) if r["unemployment_proxy"] else None,
            ))
    sql = """
        INSERT INTO district_socio_economic_indicators
            (district, population, literacy_rate, urbanization_percent, income_index, unemployment_proxy)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (district) DO UPDATE SET
            population           = EXCLUDED.population,
            literacy_rate        = EXCLUDED.literacy_rate,
            urbanization_percent = EXCLUDED.urbanization_percent,
            income_index         = EXCLUDED.income_index,
            unemployment_proxy   = EXCLUDED.unemployment_proxy
    """
    await conn.executemany(sql, rows)
    return len(rows)


async def load_accounts(conn: "asyncpg.Connection") -> int:
    path = CSV_DIR / "financial_accounts.csv"
    batch, total, batch_size = [], 0, 5000
    sql = """
        INSERT INTO financial_accounts
            (account_id, person_id, account_type, bank_name, district, opened_date, kyc_risk_level)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (account_id) DO NOTHING
    """
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            from datetime import date as _date
            od = None
            if r.get("opened_date"):
                try:
                    od = _date.fromisoformat(r["opened_date"])
                except ValueError:
                    pass
            batch.append((
                int(r["account_id"]),
                int(r["person_id"]),
                r["account_type"],
                r["bank_name"],
                r["district"] or None,
                od,
                r["kyc_risk_level"] or None,
            ))
            if len(batch) >= batch_size:
                await conn.executemany(sql, batch)
                total += len(batch)
                batch = []
                print(f"  accounts: {total:,} loaded…", end="\r")
    if batch:
        await conn.executemany(sql, batch)
        total += len(batch)
    return total


async def load_transactions(conn: "asyncpg.Connection") -> int:
    path = CSV_DIR / "financial_transactions.csv"
    batch, total, batch_size = [], 0, 5000
    sql = """
        INSERT INTO financial_transactions
            (transaction_id, from_account_id, to_account_id, amount,
             transaction_time, channel, case_id, pattern_flag, is_suspicious)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (transaction_id) DO NOTHING
    """
    from decimal import Decimal
    from datetime import datetime, timezone
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ts_raw = r["transaction_time"].strip()
            if ts_raw.endswith("Z"):
                ts_raw = ts_raw[:-1] + "+00:00"
            ts = datetime.fromisoformat(ts_raw)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            case_id = int(r["case_id"]) if r.get("case_id") and r["case_id"].strip() else None
            is_susp = r["is_suspicious"].strip().lower() in ("1", "true", "t", "yes")
            batch.append((
                int(r["transaction_id"]),
                int(r["from_account_id"]),
                int(r["to_account_id"]),
                Decimal(r["amount"]),
                ts,
                r["channel"],
                case_id,
                r["pattern_flag"] or None,
                is_susp,
            ))
            if len(batch) >= batch_size:
                await conn.executemany(sql, batch)
                total += len(batch)
                batch = []
                print(f"  transactions: {total:,} loaded…", end="\r")
    if batch:
        await conn.executemany(sql, batch)
        total += len(batch)
    return total


async def run_for_db(label: str, url: str) -> None:
    print(f"\n{'='*60}")
    print(f"  Target: {label}")
    host = url.split("@")[-1].split("/")[0] if "@" in url else url[:40]
    print(f"  Host:   {host}")
    print(f"{'='*60}")

    conn = await _get_conn(url)
    try:
        # Verify tables exist
        tables = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_name IN ('district_socio_economic_indicators','financial_accounts','financial_transactions')"
        )
        found = {r["table_name"] for r in tables}
        missing = {"district_socio_economic_indicators", "financial_accounts", "financial_transactions"} - found
        if missing:
            print(f"  ERROR: Tables missing (run 003_add_ps4_ps7_tables.sql first): {missing}")
            return

        print("  Loading district_socio_economic_indicators…")
        n = await load_socio(conn)
        cnt = await conn.fetchval("SELECT count(*) FROM district_socio_economic_indicators")
        print(f"  ✅ socio: {n} upserted  →  {cnt} total in DB")

        print("  Loading financial_accounts…")
        n = await load_accounts(conn)
        cnt = await conn.fetchval("SELECT count(*) FROM financial_accounts")
        print(f"\n  ✅ accounts: {n:,} inserted  →  {cnt:,} total in DB")

        print("  Loading financial_transactions…")
        n = await load_transactions(conn)
        cnt = await conn.fetchval("SELECT count(*) FROM financial_transactions")
        print(f"\n  ✅ transactions: {n:,} inserted  →  {cnt:,} total in DB")

        # FK verification
        orphan_acc = await conn.fetchval(
            "SELECT count(*) FROM financial_accounts fa "
            "LEFT JOIN persons p ON p.person_id = fa.person_id WHERE p.person_id IS NULL"
        )
        orphan_txn = await conn.fetchval(
            "SELECT count(*) FROM financial_transactions ft "
            "LEFT JOIN financial_accounts a1 ON a1.account_id = ft.from_account_id "
            "LEFT JOIN financial_accounts a2 ON a2.account_id = ft.to_account_id "
            "WHERE a1.account_id IS NULL OR a2.account_id IS NULL"
        )
        orphan_case = await conn.fetchval(
            "SELECT count(*) FROM financial_transactions ft "
            "LEFT JOIN cases c ON c.case_id = ft.case_id "
            "WHERE ft.case_id IS NOT NULL AND c.case_id IS NULL"
        )
        print(f"  FK orphan_accounts→persons:  {orphan_acc}  (expected 0)")
        print(f"  FK orphan_txn→accounts:      {orphan_txn}  (expected 0)")
        print(f"  FK orphan_txn→cases:         {orphan_case} (expected 0)")

    finally:
        await conn.close()


async def main(targets: list[str]) -> None:
    env = load_env()

    NEON  = env.get("SEED_DATABASE_URL") or env.get("DATABASE_URL", "")
    LOCAL = "postgresql://satyam:satyam@localhost:5432/satyam"

    if "neon"  in targets: await run_for_db("Neon cloud",        NEON)
    if "local" in targets: await run_for_db("Local PostgreSQL 17", LOCAL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="both", choices=["neon", "local", "both"])
    args = parser.parse_args()
    targets = ["neon", "local"] if args.db == "both" else [args.db]
    asyncio.run(main(targets))
