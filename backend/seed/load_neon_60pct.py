"""
Reload Neon cloud with 60% of each dataset table.

Strategy:
  - Truncate all tables (clean slate)
  - Load 60% of stations, officers, cases, persons, case_persons, narratives
    using deterministic row selection (every row where rownum % 10 < 6)
  - Load ALL socio-economic indicators (only 41 rows, negligible)
  - Load 60% of financial_accounts and financial_transactions
    (only accounts/transactions whose related persons/cases were loaded)

Run from backend/ directory:
  python seed/load_neon_60pct.py

Expected final sizes on Neon:
  stations     ~645   rows
  officers     ~4169  rows
  cases        60000  rows
  persons      ~250k  rows
  case_persons ~250k  rows
  narratives   120000 rows
  district_socio_economic_indicators 41 rows
  financial_accounts  ~107k rows
  financial_transactions ~107k rows
  Total: ~280-320 MB
"""
from __future__ import annotations
import asyncio, csv, os, sys
from pathlib import Path
from decimal import Decimal
from datetime import date, datetime, timezone

try:
    import asyncpg
except ImportError:
    sys.exit("asyncpg not installed.")

ROOT    = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
CSV_DIR  = ROOT / "seed" / "satyam_synthetic_dataset"
RATIO    = 0.6   # 60%
BATCH    = 5000

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

def parse_url(url: str) -> tuple[str, str | None]:
    ssl = "require" if "ssl=require" in url or "sslmode=require" in url else None
    plain = url.replace("postgresql+asyncpg://", "postgresql://")
    plain = plain.split("?")[0]
    return plain, ssl

def take_60pct(rows: list) -> list:
    """Take deterministically ~60% of rows (every row where index % 10 < 6)."""
    return [r for i, r in enumerate(rows) if i % 10 < 6]

async def progress(conn, label: str):
    n = await conn.fetchval(f"SELECT count(*) FROM {label}")
    print(f"  {label}: {n:,}")

async def main():
    env = load_env()
    url, ssl = parse_url(env.get("SEED_DATABASE_URL") or env.get("DATABASE_URL", ""))
    conn = await asyncpg.connect(url, ssl=ssl)
    print(f"Connected to: {url.split('@')[-1].split('/')[0]}")

    # ── 1. Truncate all (reverse FK order) ───────────────────────────────────
    print("\n[1/10] Truncating all tables…")
    await conn.execute("""
        TRUNCATE financial_transactions, financial_accounts,
                 district_socio_economic_indicators,
                 audit_log, narratives, case_persons, persons,
                 cases, officers, stations, users
        RESTART IDENTITY CASCADE
    """)
    print("  Done.")

    # ── 2. Stations (~645 of 1074) ────────────────────────────────────────────
    print("\n[2/10] Loading stations (60%)…")
    with (CSV_DIR/"stations.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = take_60pct(all_rows)
    loaded_station_ids = {int(r["station_id"]) for r in rows}
    await conn.executemany(
        "INSERT INTO stations (station_id,station_name,district,\"range\",latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [(int(r["station_id"]),r["station_name"],r["district"],r["range"],
          float(r["latitude"]) if r["latitude"] else None,
          float(r["longitude"]) if r["longitude"] else None) for r in rows])
    await progress(conn, "stations")

    # ── 3. Officers (only those at loaded stations) ───────────────────────────
    print("\n[3/10] Loading officers (filtered to loaded stations)…")
    with (CSV_DIR/"officers.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in all_rows if int(r["station_id"]) in loaded_station_ids]
    loaded_officer_ids = {int(r["officer_id"]) for r in rows}
    batch = [(int(r["officer_id"]),r["name"],r["rank"],int(r["station_id"])) for r in rows]
    for i in range(0, len(batch), BATCH):
        await conn.executemany("INSERT INTO officers VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", batch[i:i+BATCH])
    await progress(conn, "officers")

    # ── 4. Cases (60k of 100k, only at loaded stations) ───────────────────────
    print("\n[4/10] Loading cases (60%)…")
    with (CSV_DIR/"cases.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in take_60pct(all_rows) if int(r["station_id"]) in loaded_station_ids]
    loaded_case_ids = {int(r["case_id"]) for r in rows}
    print(f"  Preparing {len(rows):,} case rows…")
    SQL_CASE = """
        INSERT INTO cases (case_id,fir_number,fir_year,station_id,station_name,district,"range",
          crime_type,crime_category,legal_code,sections,fir_type,status,complaint_mode,motive,
          incident_date,incident_time,report_date,latitude,longitude,place_of_offence,
          io_officer_id,io_name,victim_count,accused_count,is_group,arrested_count,
          charge_sheeted,convicted)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
        ON CONFLICT DO NOTHING
    """
    def parse_case(r):
        def d(v): return date.fromisoformat(v) if v else None
        def i(v): return int(v) if v else None
        def f(v): return float(v) if v else None
        def b(v): return v.strip().lower() in ("1","true","t","yes")
        io_id = i(r.get("io_officer_id"))
        if io_id and io_id not in loaded_officer_ids: io_id = None
        return (int(r["case_id"]),r["fir_number"],int(r["fir_year"]),int(r["station_id"]),
                r["station_name"],r["district"],r["range"],r["crime_type"],r["crime_category"],
                r["legal_code"],r["sections"] or None,r["fir_type"],r["status"],
                r.get("complaint_mode") or None,r.get("motive") or None,
                d(r.get("incident_date")),r.get("incident_time") or None,d(r["report_date"]),
                f(r.get("latitude")),f(r.get("longitude")),r.get("place_of_offence") or None,
                io_id,r.get("io_name") or None,
                int(r["victim_count"]),int(r["accused_count"]),b(r.get("is_group","0")),
                int(r["arrested_count"]),b(r.get("charge_sheeted","0")),b(r.get("convicted","0")))
    batch = [parse_case(r) for r in rows]
    for i in range(0, len(batch), BATCH):
        await conn.executemany(SQL_CASE, batch[i:i+BATCH])
        print(f"  cases: {min(i+BATCH, len(batch)):,}/{len(batch):,}", end="\r")
    await progress(conn, "cases")

    # ── 5. Persons (60% of full list) ─────────────────────────────────────────
    print("\n[5/10] Loading persons (60%)…")
    with (CSV_DIR/"persons.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = take_60pct(all_rows)
    loaded_person_ids = {int(r["person_id"]) for r in rows}
    batch = [(int(r["person_id"]),r["name"],r.get("gender") or None,
              int(r["age"]) if r.get("age") else None, r.get("district") or None) for r in rows]
    for i in range(0, len(batch), BATCH):
        await conn.executemany("INSERT INTO persons VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", batch[i:i+BATCH])
        print(f"  persons: {min(i+BATCH, len(batch)):,}/{len(batch):,}", end="\r")
    await progress(conn, "persons")

    # ── 6. Case_persons (only loaded case+person pairs) ───────────────────────
    print("\n[6/10] Loading case_persons (filtered)…")
    with (CSV_DIR/"case_persons.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in all_rows
            if int(r["case_id"]) in loaded_case_ids and int(r["person_id"]) in loaded_person_ids]
    batch = [(int(r["case_id"]),int(r["person_id"]),r["role"]) for r in rows]
    for i in range(0, len(batch), BATCH):
        await conn.executemany(
            "INSERT INTO case_persons VALUES($1,$2,$3) ON CONFLICT DO NOTHING", batch[i:i+BATCH])
        print(f"  case_persons: {min(i+BATCH, len(batch)):,}/{len(batch):,}", end="\r")
    await progress(conn, "case_persons")

    # ── 7. Narratives (2 per case → 120k for 60k cases) ─────────────────────
    print("\n[7/10] Loading narratives (for loaded cases only)…")
    with (CSV_DIR/"narratives.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in all_rows if int(r["case_id"]) in loaded_case_ids]
    batch = [(int(r["narrative_id"]),int(r["case_id"]),r["language"],r["body"]) for r in rows]
    for i in range(0, len(batch), BATCH):
        await conn.executemany(
            "INSERT INTO narratives (narrative_id,case_id,language,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            batch[i:i+BATCH])
        print(f"  narratives: {min(i+BATCH, len(batch)):,}/{len(batch):,}", end="\r")
    await progress(conn, "narratives")

    # ── 8. Socio-economic (all 41 rows) ──────────────────────────────────────
    print("\n[8/10] Loading district_socio_economic_indicators (all 41)…")
    with (CSV_DIR/"district_socio_economic_indicators.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    await conn.executemany(
        """INSERT INTO district_socio_economic_indicators
           (district,population,literacy_rate,urbanization_percent,income_index,unemployment_proxy)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""",
        [(r["district"],int(r["population"]) if r["population"] else None,
          float(r["literacy_rate"]) if r["literacy_rate"] else None,
          float(r["urbanization_percent"]) if r["urbanization_percent"] else None,
          float(r["income_index"]) if r["income_index"] else None,
          float(r["unemployment_proxy"]) if r["unemployment_proxy"] else None) for r in all_rows])
    await progress(conn, "district_socio_economic_indicators")

    # ── 9. Financial accounts (60%, only for loaded persons) ─────────────────
    print("\n[9/10] Loading financial_accounts (60%, persons filter)…")
    with (CSV_DIR/"financial_accounts.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in take_60pct(all_rows) if int(r["person_id"]) in loaded_person_ids]
    loaded_account_ids = {int(r["account_id"]) for r in rows}
    batch_data = []
    for r in rows:
        od = date.fromisoformat(r["opened_date"]) if r.get("opened_date") else None
        batch_data.append((int(r["account_id"]),int(r["person_id"]),r["account_type"],
                           r["bank_name"],r.get("district") or None,od,r.get("kyc_risk_level") or None))
    for i in range(0, len(batch_data), BATCH):
        await conn.executemany(
            "INSERT INTO financial_accounts VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
            batch_data[i:i+BATCH])
        print(f"  financial_accounts: {min(i+BATCH, len(batch_data)):,}/{len(batch_data):,}", end="\r")
    await progress(conn, "financial_accounts")

    # ── 10. Financial transactions (60%, filter by loaded accounts+cases) ────
    print("\n[10/10] Loading financial_transactions (60%, account+case filter)…")
    with (CSV_DIR/"financial_transactions.csv").open(newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    rows = [r for r in take_60pct(all_rows)
            if int(r["from_account_id"]) in loaded_account_ids
            and int(r["to_account_id"]) in loaded_account_ids]
    batch_data = []
    for r in rows:
        ts_raw = r["transaction_time"].strip()
        if ts_raw.endswith("Z"): ts_raw = ts_raw[:-1] + "+00:00"
        ts = datetime.fromisoformat(ts_raw)
        if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)
        case_id = int(r["case_id"]) if r.get("case_id","").strip() and int(r.get("case_id","0") or 0) in loaded_case_ids else None
        is_susp = r["is_suspicious"].strip().lower() in ("1","true","t","yes")
        batch_data.append((int(r["transaction_id"]),int(r["from_account_id"]),int(r["to_account_id"]),
                           Decimal(r["amount"]),ts,r["channel"],case_id,r.get("pattern_flag") or None,is_susp))
    for i in range(0, len(batch_data), BATCH):
        await conn.executemany(
            """INSERT INTO financial_transactions
               (transaction_id,from_account_id,to_account_id,amount,transaction_time,
                channel,case_id,pattern_flag,is_suspicious)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING""",
            batch_data[i:i+BATCH])
        print(f"  financial_transactions: {min(i+BATCH, len(batch_data)):,}/{len(batch_data):,}", end="\r")
    await progress(conn, "financial_transactions")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("FINAL ROW COUNTS ON NEON")
    print("="*60)
    for t in ["stations","officers","cases","persons","case_persons","narratives",
              "district_socio_economic_indicators","financial_accounts","financial_transactions"]:
        n = await conn.fetchval(f"SELECT count(*) FROM {t}")
        print(f"  {t:42s} {n:>10,}")

    # FK checks
    print("\nFK VERIFICATION")
    orphan_acc = await conn.fetchval(
        "SELECT count(*) FROM financial_accounts fa LEFT JOIN persons p ON p.person_id=fa.person_id WHERE p.person_id IS NULL")
    orphan_txn = await conn.fetchval(
        "SELECT count(*) FROM financial_transactions ft LEFT JOIN financial_accounts a1 ON a1.account_id=ft.from_account_id LEFT JOIN financial_accounts a2 ON a2.account_id=ft.to_account_id WHERE a1.account_id IS NULL OR a2.account_id IS NULL")
    orphan_case = await conn.fetchval(
        "SELECT count(*) FROM financial_transactions ft LEFT JOIN cases c ON c.case_id=ft.case_id WHERE ft.case_id IS NOT NULL AND c.case_id IS NULL")
    print(f"  orphan accounts→persons:  {orphan_acc}  (expected 0)")
    print(f"  orphan txn→accounts:      {orphan_txn}  (expected 0)")
    print(f"  orphan txn→cases:         {orphan_case} (expected 0)")

    # Storage check
    size_rows = await conn.fetch(
        "SELECT pg_size_pretty(sum(pg_total_relation_size(schemaname||'.'||tablename))) AS total "
        "FROM pg_tables WHERE schemaname='public'")
    print(f"\nTotal DB size: {size_rows[0]['total']}")

    await conn.close()
    print("\nDone.")

if __name__ == "__main__":
    asyncio.run(main())
