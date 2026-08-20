"""
Satyam — BGE-M3 narrative embedding job.

Fills narratives.embedding (vector(1024)) for all rows that currently have
NULL embeddings.  Resumable: only processes un-embedded rows.

Usage:
    # Cloud (Neon) — uses SEED_DATABASE_URL
    python -m seed.embed_narratives

    # Local Postgres
    python -m seed.embed_narratives --local

    # Batch size override (default 64)
    python -m seed.embed_narratives --batch 128

Hardware:
  - GPU (RTX 4070, FP16): ~25k rows/min → ~8 min for 200k narratives
  - CPU only: ~1k rows/min → ~3 h for 200k narratives (feasible overnight)

NOTE: Run load_seed.py FIRST to populate narratives without embeddings.
NOTE: On Neon free tier the embedding column is halfvec(1024) — see DATABASE.md.
      This script casts to the correct type automatically.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.config import get_settings

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_BATCH = 64


def get_url(local: bool) -> str:
    if local:
        return "postgresql://satyam:satyam@localhost:5432/satyam"
    raw = os.environ.get("SEED_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if raw:
        return raw.replace("postgresql+asyncpg://", "postgresql://")
    from app.config import get_settings
    return get_settings().seed_database_url.replace("postgresql+asyncpg://", "postgresql://")


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def load_embedder():
    """Single source of truth: reuse the SAME embedder used at query time.

    This is the sentence-transformers BGE-M3 loaded from EMBEDDING_MODEL_PATH
    (local folder, GPU FP16, L2-normalised). Reusing it guarantees seed-time and
    query-time vectors live in the same space — no divergent embeddings.
    """
    from app.models.registry import get_embedder

    embedder = get_embedder()

    async def embed(texts: list[str]) -> list[list[float]]:
        return await embedder.embed(texts)

    return embed


def vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    local = "--local" in sys.argv
    batch_size = DEFAULT_BATCH
    for i, arg in enumerate(sys.argv):
        if arg == "--batch" and i + 1 < len(sys.argv):
            batch_size = int(sys.argv[i + 1])

    url = get_url(local)
    target = url.split("@")[-1].split("/")[0]
    print(f"Target: {target}  batch={batch_size}")

    ssl = "require" if "neon.tech" in url else None
    conn: asyncpg.Connection = await asyncpg.connect(url, ssl=ssl)
    embed = load_embedder()

    try:
        total = await conn.fetchval("SELECT count(*) FROM narratives WHERE embedding IS NULL")
        print(f"Narratives to embed: {total:,}")
        if total == 0:
            print("Nothing to do.")
            return

        done = 0
        vt = get_settings().vector_type  # "vector" | "halfvec"

        while True:
            rows = await conn.fetch(
                "SELECT narrative_id, body FROM narratives "
                "WHERE embedding IS NULL "
                "ORDER BY narrative_id "
                "LIMIT $1",
                batch_size,
            )
            if not rows:
                break

            texts = [r["body"] for r in rows]
            vecs = await embed(texts)

            # Bulk update.
            # executemany sends the whole batch over the extended protocol instead
            # of issuing one round trip per row. Against a remote Neon instance the
            # per-row form cost ~1 RTT each (measured: 234 ms/row, ~4.3 rows/s,
            # which put a 72k backfill at ~4.6 h). Batching collapses that to
            # roughly one round trip per batch.
            async with conn.transaction():
                await conn.executemany(
                    f"UPDATE narratives SET embedding = $1::{vt} WHERE narrative_id = $2",
                    [
                        (vec_literal(vec), row["narrative_id"])
                        for row, vec in zip(rows, vecs)
                    ],
                )

            done += len(rows)
            pct = done / total * 100 if total else 0
            print(f"  {done:,}/{total:,} ({pct:.1f}%)", end="\r", flush=True)

        # Build HNSW index after all embeddings are populated
        print(f"\nBuilding HNSW index on narratives.embedding…")
        # `vt` is already resolved above from the module-level get_settings import.
        # Re-importing it here made get_settings function-local, which turned the
        # earlier read into an UnboundLocalError and meant this job could never run.
        ops = "halfvec_cosine_ops" if vt == "halfvec" else "vector_cosine_ops"

        # HNSW builds the whole graph in maintenance_work_mem and spills to disk
        # when it does not fit, which is drastically slower. The default here is
        # 64 MB, while 200k 1024-dim vectors need roughly 860 MB. These are
        # SET LOCAL-style session settings on a maintenance connection only, so
        # they do not affect the running application.
        try:
            await conn.execute("SET maintenance_work_mem = '1GB'")
            await conn.execute("SET max_parallel_maintenance_workers = 4")
        except Exception as exc:  # noqa: BLE001
            # Managed providers may forbid these; the build still succeeds.
            print(f"  (could not raise build memory: {exc})")

        await conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_nar_embedding "
            f"ON narratives USING hnsw (embedding {ops})"
        )
        print("Done.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
