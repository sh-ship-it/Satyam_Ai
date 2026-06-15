"""
Satyam — Bulk CSV loader for the synthetic dataset.

Usage:
    # Cloud (Neon) — default
    python -m seed.load_seed

    # Local Postgres
    python -m seed.load_seed --local

    # Custom path to generated CSVs
    python -m seed.load_seed --dir /abs/path/to/csvs

    # Target URL override
    DATABASE_URL=postgresql://... python -m seed.load_seed

Run AFTER applying migrations/002_schema_v2.sql.

Strategy:
  - Uses asyncpg COPY FROM STDIN (fastest bulk path, no ORM overhead).
  - Idempotent: TRUNCATE ... CASCADE before each load.
  - FK-safe order: stations → officers → cases → persons → case_persons → narratives.
  - Indexes are built AFTER load for speed (see bottom of script).
  - embedding + body_tsv columns are NOT loaded here:
      embedding → filled later by seed/embed_narratives.py (BGE-M3 job)
      body_tsv  → GENERATED ALWAYS column (auto-maintained by Postgres)
  - sections_arr → also GENERATED ALWAYS, auto-maintained.
"""
from __future__ import annotations

import asyncio
import csv
import io
import os
import sys
from pathlib import Path

import asyncpg

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_DIR = Path(__file__).parent / "satyam_synthetic_dataset"


def get_url(local: bool) -> str:
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


# ---------------------------------------------------------------------------
# COPY helpers
# ---------------------------------------------------------------------------

async def copy_csv(
    conn: asyncpg.Connection,
    table: str,
    columns: list[str],
    csv_path: Path,
) -> int:
    """Stream a CSV into Postgres via COPY ... FROM STDIN."""
    col_list = ", ".join(f'"{c}"' for c in columns)
    copy_sql = (
        f"COPY {table} ({col_list}) "
        f"FROM STDIN WITH (FORMAT CSV, HEADER TRUE, NULL '')"
    )
    rows_loaded = 0
    with open(csv_path, encoding="utf-8", newline="") as f:
        # asyncpg copy_to_table uses binary; use copy_records_to_table for text.
        # For CSV we use the raw COPY protocol via copy_from_query.
        # asyncpg >= 0.24 supports copy_to_table from stdin as bytes.
        data = f.read().encode("utf-8")
        await conn.copy_to_table(
            table,
            source=io.BytesIO(data),
            columns=columns,
            format="csv",
            header=True,
            null="",
        )
    # Count rows (quick)
    rows_loaded = await conn.fetchval(f"SELECT count(*) FROM {table}")
    return rows_loaded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    local = "--local" in sys.argv
    data_dir = DEFAULT_DIR
    for i, arg in enumerate(sys.argv):
        if arg == "--dir" and i + 1 < len(sys.argv):
            data_dir = Path(sys.argv[i + 1])

    if not data_dir.exists():
        print(f"ERROR: CSV directory not found: {data_dir}")
        sys.exit(1)

    url = get_url(local)
    target = url.split("@")[-1].split("/")[0]
    print(f"Target: {target}")
    print(f"CSV dir: {data_dir}")

    ssl = "require" if "neon.tech" in url else None
    conn: asyncpg.Connection = await asyncpg.connect(url, ssl=ssl)

    try:
        async with conn.transaction():
            # ----------------------------------------------------------------
            # Idempotent wipe (FK-safe order, reverse of load order)
            # ----------------------------------------------------------------
            print("Truncating existing data…")
            await conn.execute(
                "TRUNCATE narratives, case_persons, persons, cases, officers, stations "
                "RESTART IDENTITY CASCADE"
            )

            # ----------------------------------------------------------------
            # 1) stations
            # ----------------------------------------------------------------
            print("Loading stations…", end=" ", flush=True)
            n = await copy_csv(
                conn, "stations",
                ["station_id", "station_name", "district", "range", "latitude", "longitude"],
                data_dir / "stations.csv",
            )
            print(f"{n:,} rows")

            # ----------------------------------------------------------------
            # 2) officers  (FK → stations)
            # ----------------------------------------------------------------
            print("Loading officers…", end=" ", flush=True)
            n = await copy_csv(
                conn, "officers",
                ["officer_id", "name", "rank", "station_id"],
                data_dir / "officers.csv",
            )
            print(f"{n:,} rows")

            # ----------------------------------------------------------------
            # 3) cases  (FK → stations, officers)
            # sections_arr is GENERATED ALWAYS — do NOT include in COPY
            # ----------------------------------------------------------------
            print("Loading cases (100k rows — may take a moment)…", end=" ", flush=True)
            n = await copy_csv(
                conn, "cases",
                [
                    "case_id", "fir_number", "fir_year", "station_id", "station_name",
                    "district", "range", "crime_type", "crime_category", "legal_code",
                    "sections", "fir_type", "status", "complaint_mode", "motive",
                    "incident_date", "incident_time", "report_date",
                    "latitude", "longitude", "place_of_offence",
                    "io_officer_id", "io_name",
                    "victim_count", "accused_count", "is_group",
                    "arrested_count", "charge_sheeted", "convicted",
                ],
                data_dir / "cases.csv",
            )
            print(f"{n:,} rows")

            # ----------------------------------------------------------------
            # 4) persons  (no FKs)
            # ----------------------------------------------------------------
            print("Loading persons…", end=" ", flush=True)
            n = await copy_csv(
                conn, "persons",
                ["person_id", "name", "gender", "age", "district"],
                data_dir / "persons.csv",
            )
            print(f"{n:,} rows")

            # ----------------------------------------------------------------
            # 5) case_persons  (FK → cases, persons)
            # ----------------------------------------------------------------
            print("Loading case_persons…", end=" ", flush=True)
            n = await copy_csv(
                conn, "case_persons",
                ["case_id", "person_id", "role"],
                data_dir / "case_persons.csv",
            )
            print(f"{n:,} rows")

            # ----------------------------------------------------------------
            # 6) narratives  (FK → cases)
            # embedding + body_tsv are NOT loaded — filled by embed job / generated
            # ----------------------------------------------------------------
            print("Loading narratives (200k rows)…", end=" ", flush=True)
            n = await copy_csv(
                conn, "narratives",
                ["narrative_id", "case_id", "language", "body"],
                data_dir / "narratives.csv",
            )
            print(f"{n:,} rows")

        # ----------------------------------------------------------------
        # Build indexes AFTER load (much faster than during)
        # ----------------------------------------------------------------
        print("Building indexes…")
        idx_stmts = [
            "CREATE INDEX IF NOT EXISTS idx_cases_district   ON cases (district)",
            'CREATE INDEX IF NOT EXISTS idx_cases_range       ON cases ("range")',
            "CREATE INDEX IF NOT EXISTS idx_cases_crime_type ON cases (crime_type)",
            "CREATE INDEX IF NOT EXISTS idx_cases_report_dt  ON cases (report_date)",
            "CREATE INDEX IF NOT EXISTS idx_cases_status     ON cases (status)",
            "CREATE INDEX IF NOT EXISTS idx_cases_station    ON cases (station_id)",
            "CREATE INDEX IF NOT EXISTS idx_cases_legalcode  ON cases (legal_code)",
            "CREATE INDEX IF NOT EXISTS idx_cp_case          ON case_persons (case_id)",
            "CREATE INDEX IF NOT EXISTS idx_cp_person        ON case_persons (person_id)",
            "CREATE INDEX IF NOT EXISTS idx_persons_district ON persons (district)",
            "CREATE INDEX IF NOT EXISTS idx_nar_case         ON narratives (case_id)",
            "CREATE INDEX IF NOT EXISTS idx_nar_bodytsv      ON narratives USING GIN (body_tsv)",
        ]
        for stmt in idx_stmts:
            await conn.execute(stmt)
            print(f"  ✓ {stmt.split(' ON ')[0].split('INDEX ')[-1].strip()}")

        print("Running ANALYZE…")
        for tbl in ("stations", "officers", "cases", "persons", "case_persons", "narratives"):
            await conn.execute(f"ANALYZE {tbl}")

        # ----------------------------------------------------------------
        # Sanity counts
        # ----------------------------------------------------------------
        print("\nFinal row counts:")
        for tbl in ("stations", "officers", "cases", "persons", "case_persons", "narratives"):
            c = await conn.fetchval(f"SELECT count(*) FROM {tbl}")
            print(f"  {tbl:<16} {c:>10,}")

    finally:
        await conn.close()

    print("\nLoad complete.")


if __name__ == "__main__":
    asyncio.run(main())
