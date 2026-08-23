"""
Satyam — BGE-M3 narrative embedding job.

Fills narratives.embedding (vector(1024)) for all rows that currently have
NULL embeddings.  Resumable: only processes un-embedded rows.

Usage:
    # Cloud (Neon) — uses SEED_DATABASE_URL. Embeds ONE narrative per case,
    # which is the only selection that fits the free-plan storage quota.
    python -m seed.embed_narratives

    # Local Postgres — no provider quota, so the budget guard is skipped.
    python -m seed.embed_narratives --local

    # Batch size override (default 64)
    python -m seed.embed_narratives --batch 128

    # Every unembedded narrative. Still subject to the budget guard, so on the
    # cloud database this is refused: all 71,986 narratives need roughly 345 MB
    # of vectors plus index, against a 0.5 GB project quota. Useful on --local.
    python -m seed.embed_narratives --all-narratives

STORAGE BUDGET
--------------
Every cloud run projects its cost before writing anything and exits non-zero if
the projection breaches the ceiling in `app.core.storage`. This used to be the
other way round: one-per-case was opt-in via a flag, and the command documented
in AGENTS.md omitted it, so following the documentation embedded every remaining
narrative and overran the quota. The safe selection is now the default and there
is no flag that bypasses the guard.

Exit codes: 0 embedded (or nothing to do), 1 refused by the budget guard.

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

class _GuardResult:
    """The slice of a SQLAlchemy Result that `storage.read_state` actually uses."""

    def __init__(self, rows: list) -> None:
        self._rows = rows

    def scalar(self):
        if not self._rows:
            return None
        return list(self._rows[0].values())[0]

    def mappings(self):
        return self

    def first(self):
        return dict(self._rows[0]) if self._rows else None


class _GuardConn:
    """Adapt an asyncpg connection to what `storage.read_state` expects.

    Deliberately an adapter rather than opening a separate SQLAlchemy session:
    a session resolves its URL from DB_SOURCE, which is unrelated to the --local
    flag this job uses, so the guard could measure one database while the backfill
    writes to another. Measuring a different database than you write to is exactly
    the class of mistake the budget exists to prevent, so the guard is pointed at
    the same connection.
    """

    def __init__(self, conn) -> None:
        self._conn = conn

    async def execute(self, clause, *_args, **_kwargs):
        return _GuardResult(await self._conn.fetch(str(clause)))


async def _preflight(conn, rows_to_embed: int, *, local: bool) -> bool:
    """Project the cost of this backfill and refuse it if it breaches the budget.

    Returns True when the operation may proceed. Nothing has been written at the
    point this is called, which is the whole point: detecting the breach after
    the rows land is useless, because reclaiming the space then needs working
    room that is no longer there.

    Skipped for --local, which has no provider quota. Not skipped for anything
    else, and there is no override flag.
    """
    if local:
        print("Budget guard: skipped (local Postgres has no storage quota).")
        return True

    from app.core.storage import StorageUnmeasurable, project, read_state

    try:
        state = await read_state(_GuardConn(conn))
    except StorageUnmeasurable as exc:
        # Fail closed. A guard that cannot measure must not approve.
        print(f"Budget guard: REFUSED — cannot measure storage ({exc}).")
        return False

    print(f"Budget guard: {state.explain()}")
    projection = project(state, rows_to_embed)
    print(projection.explain())
    if not projection.fits:
        print(
            "\nRefused before writing any row. Either free space first "
            "(the HNSW index is the largest single reclaimable object), or embed "
            f"at most {projection.rows_affordable} rows."
        )
        return False
    if not state.within_reserve:
        print(
            "\nRefused: free space is already below the reserved headroom floor. "
            "Reclaim space before adding more."
        )
        return False
    return True


async def main() -> int:
    local = "--local" in sys.argv
    # DEFAULT IS ONE-PER-CASE. It used to be opt-in via --one-per-case while the
    # documented command omitted the flag, so following the documentation embedded
    # every remaining narrative and overran the cloud quota. The safe selection is
    # now what you get by default, and the unrestricted one has to be asked for by
    # name — and is still subject to the projection below, so naming it is not a
    # way around the budget.
    all_narratives = "--all-narratives" in sys.argv
    one_per_case = not all_narratives
    batch_size = DEFAULT_BATCH
    for i, arg in enumerate(sys.argv):
        if arg == "--batch" and i + 1 < len(sys.argv):
            batch_size = int(sys.argv[i + 1])

    url = get_url(local)
    target = url.split("@")[-1].split("/")[0]

    # The two databases use different pgvector types on purpose: local keeps fp32
    # `vector`, cloud uses fp16 `halfvec` because fp32 vectors plus an HNSW index
    # do not fit in a 512 MB Neon project. Pick by the target actually chosen, so
    # a --local run and a cloud run cannot both read one global and get it wrong.
    s = get_settings()
    vt = s.vector_type if local else s.cloud_vector_type

    # Restricting to the lowest narrative_id per case is how the cloud copy fits.
    # It is a coverage trade, not a truncation: every case stays reachable by
    # vector search, whereas simply stopping partway through narrative_id order
    # leaves a contiguous block of the newest cases with no embedding at all.
    # The full body text of every narrative remains lexically searchable either
    # way, and RRF fuses the two arms.
    where = "embedding IS NULL"
    if one_per_case:
        where += (
            " AND narrative_id IN "
            "(SELECT min(narrative_id) FROM narratives GROUP BY case_id)"
        )

    print(f"Target: {target}  batch={batch_size}  vector_type={vt}"
          f"  selection={'one-per-case' if one_per_case else 'ALL NARRATIVES'}")

    ssl = "require" if "neon.tech" in url else None
    conn: asyncpg.Connection = await asyncpg.connect(url, ssl=ssl)

    try:
        total = await conn.fetchval(f"SELECT count(*) FROM narratives WHERE {where}")
        print(f"Narratives to embed: {total:,}")
        if total == 0:
            print("Nothing to do.")
            return 0

        # Pre-flight BEFORE the embedder is loaded and before any write. Loading
        # 4.4 GB of model weights only to be refused wastes several minutes, and
        # more importantly the refusal must happen while the database is still
        # untouched.
        if not await _preflight(conn, total, local=local):
            return 1

        embed = load_embedder()
        done = 0

        while True:
            rows = await conn.fetch(
                f"SELECT narrative_id, body FROM narratives "
                f"WHERE {where} "
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
        return 0

    finally:
        await conn.close()


if __name__ == "__main__":
    # Non-zero exit on a refused projection, so a caller or a script can tell the
    # difference between "embedded" and "declined to embed".
    sys.exit(asyncio.run(main()) or 0)
