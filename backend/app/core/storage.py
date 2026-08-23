"""Storage budget measurement and pre-flight projection.

The cloud database runs against a hard quota (see `Settings.neon_storage_cap_bytes`).
Exceeding it does not degrade gracefully: Neon fails writes that increase storage,
so `audit_log` — written on every audited query — starts failing. The budget is
therefore an availability control, and this module is what enforces it.

WHY A PROJECTION AND NOT A CHECK AFTER THE FACT
-----------------------------------------------
Observing that size has exceeded the ceiling is useless, because by then the rows
are written and the space is spent. Freeing it again needs a VACUUM FULL or an
index drop, both of which need working space that is no longer available. So the
only useful guard estimates the cost of an operation *before* the first write and
refuses it, which is what `project()` does.

WHY THE PER-ROW COSTS ARE MEASURED, NOT CONSTANTS
-------------------------------------------------
The measured cost of one embedded narrative on the cloud database is 4,792 bytes:
2,052 bytes for the `halfvec(1024)` datum plus 2,740 bytes of HNSW graph. Both
halves are properties of the current column type, dimension and index parameters,
all three of which are candidates for change. Hardcoding either would leave a
projection that is silently wrong by a factor of two after a migration nobody
thought to connect to this file. So both are read from the live database.

FAILS CLOSED
------------
If a cost cannot be measured, `read_state` raises rather than substituting a
default. A guard that cannot measure must not approve.

Run directly to check headroom without touching any data:

    python -m app.core.storage
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

MB = 1024 * 1024


def _mb(n: int | float) -> str:
    """Render bytes as MiB for humans. Never used in a comparison."""
    return f"{n / MB:.1f} MB"


class StorageUnmeasurable(RuntimeError):
    """A budget input could not be read, so no projection may be trusted."""


@dataclass(frozen=True)
class StorageState:
    """A measured snapshot of the database against its budget.

    All byte fields are exact. `embedding_bytes_per_row` and
    `index_bytes_per_vector` are measured from the live database rather than
    assumed, so a change to the vector type, dimension or index parameters is
    reflected without editing this module.
    """

    db_bytes: int
    cap_bytes: int
    peak_ceiling_bytes: int
    steady_ceiling_bytes: int
    reserve_floor_bytes: int
    total_narratives: int
    embedded_narratives: int
    embedding_bytes_per_row: int
    index_bytes_per_vector: int

    @property
    def free_bytes(self) -> int:
        """Space remaining against the hard cap. Can go negative."""
        return self.cap_bytes - self.db_bytes

    @property
    def transient_floor_bytes(self) -> int:
        """Free space a single migration may temporarily reduce the reserve to.

        Derived from the peak ceiling rather than configured separately, so the
        two can never disagree. At the default 93.75% peak this is 6.25% of the
        cap — half the steady 12.5% floor. That dip is what makes an index
        rebuild possible, and a rebuild is what frees space in the first place.
        """
        return max(0, self.cap_bytes - self.peak_ceiling_bytes)

    @property
    def cost_per_embedded_row(self) -> int:
        """All-in cost of embedding one more narrative: datum plus index share."""
        return self.embedding_bytes_per_row + self.index_bytes_per_vector

    @property
    def within_reserve(self) -> bool:
        """True when free space still honours the reserved headroom floor."""
        return self.free_bytes >= self.reserve_floor_bytes

    @property
    def within_steady_ceiling(self) -> bool:
        return self.db_bytes <= self.steady_ceiling_bytes

    @property
    def coverage_percent(self) -> float | None:
        if self.total_narratives <= 0:
            return None
        return round(self.embedded_narratives / self.total_narratives * 100, 1)

    def explain(self) -> str:
        flag = "OK" if (self.within_reserve and self.within_steady_ceiling) else "DEGRADED"
        return (
            f"[{flag}] size {_mb(self.db_bytes)} of {_mb(self.cap_bytes)} cap  "
            f"free {_mb(self.free_bytes)}  "
            f"steady ceiling {_mb(self.steady_ceiling_bytes)}  "
            f"reserve floor {_mb(self.reserve_floor_bytes)}  "
            f"cost/row {self.cost_per_embedded_row} B  "
            f"embedded {self.embedded_narratives}/{self.total_narratives}"
        )


@dataclass(frozen=True)
class Projection:
    """The estimated outcome of adding `rows_requested` embedded narratives."""

    rows_requested: int
    rows_affordable: int
    cost_per_row: int
    current_bytes: int
    projected_bytes: int
    ceiling_bytes: int
    ceiling_name: str
    reserve_floor_bytes: int
    cap_bytes: int

    @property
    def fits(self) -> bool:
        return self.projected_bytes <= self.ceiling_bytes

    def explain(self) -> str:
        verdict = "fits" if self.fits else "REFUSED"
        return (
            f"{verdict}: {self.rows_requested} rows x {self.cost_per_row} B "
            f"= {_mb(self.rows_requested * self.cost_per_row)} added.\n"
            f"  current   {_mb(self.current_bytes)}\n"
            f"  projected {_mb(self.projected_bytes)}\n"
            f"  {self.ceiling_name} ceiling {_mb(self.ceiling_bytes)} "
            f"(cap {_mb(self.cap_bytes)}, reserve floor {_mb(self.reserve_floor_bytes)})\n"
            f"  rows that fit within budget: {self.rows_affordable}"
        )


_SQL_DB_SIZE = "SELECT pg_database_size(current_database())"
_SQL_COUNTS = (
    "SELECT count(*) AS total, count(embedding) AS embedded FROM narratives"
)
_SQL_DATUM = (
    "SELECT avg(pg_column_size(embedding))::bigint "
    "FROM narratives WHERE embedding IS NOT NULL"
)
# Index cost per vector, derived rather than assumed. to_regclass keeps this
# working before the index exists (fresh database, embeddings not yet built).
_SQL_INDEX = (
    "SELECT CASE WHEN to_regclass('idx_nar_embedding') IS NULL THEN NULL "
    "ELSE pg_relation_size('idx_nar_embedding') END"
)


async def read_state(session: AsyncSession) -> StorageState:
    """Measure the database against its budget.

    Raises StorageUnmeasurable when an input cannot be read. Callers must not
    fall back to a default: an unmeasurable database is one where no projection
    can be trusted, and approving a write on a guessed cost is the failure this
    module exists to prevent.
    """
    s = get_settings()
    try:
        db_bytes = int((await session.execute(text(_SQL_DB_SIZE))).scalar() or 0)
        counts = (await session.execute(text(_SQL_COUNTS))).mappings().first()
        datum = (await session.execute(text(_SQL_DATUM))).scalar()
        index_total = (await session.execute(text(_SQL_INDEX))).scalar()
    except Exception as exc:  # noqa: BLE001
        raise StorageUnmeasurable(f"could not read storage figures: {exc}") from exc

    if not db_bytes:
        raise StorageUnmeasurable("pg_database_size returned no value")
    if counts is None:
        raise StorageUnmeasurable("narratives table is not readable")

    total = int(counts["total"] or 0)
    embedded = int(counts["embedded"] or 0)

    # Before anything is embedded there is nothing to measure, so fall back to the
    # arithmetic size of the configured vector. This is the one place a computed
    # value is acceptable: it depends only on settings that are themselves the
    # source of truth for the column definition, and it is exact for an empty table.
    if embedded == 0 or datum is None:
        bytes_per_dim = 2 if s.cloud_vector_type == "halfvec" else 4
        embedding_bytes = s.embedding_dim * bytes_per_dim + 4  # + varlena header
        index_bytes = 0
    else:
        embedding_bytes = int(datum)
        # An absent index is a real state (embeddings exist, index not yet built),
        # and its cost is genuinely zero until it is created. Do not invent one.
        index_bytes = int(index_total // embedded) if index_total else 0

    return StorageState(
        db_bytes=db_bytes,
        cap_bytes=s.neon_storage_cap_bytes,
        peak_ceiling_bytes=s.storage_peak_ceiling_bytes,
        steady_ceiling_bytes=s.storage_steady_ceiling_bytes,
        reserve_floor_bytes=s.storage_reserve_floor_bytes,
        total_narratives=total,
        embedded_narratives=embedded,
        embedding_bytes_per_row=embedding_bytes,
        index_bytes_per_vector=index_bytes,
    )


def project(state: StorageState, rows: int, *, peak: bool = False) -> Projection:
    """Estimate the effect of embedding `rows` more narratives.

    `peak=True` measures against the higher migration ceiling, which exists only
    for the duration of a single operation that must temporarily hold two copies
    of something. Ordinary backfills must use the steady ceiling.

    `rows_affordable` is computed on every path, including when the projection
    fits, because the useful thing to tell a refused caller is not "no" but how
    many rows would have been accepted. It is additionally capped so it never
    eats into the reserved headroom floor, which the ceiling alone does not
    guarantee once the cap and the ceiling percentages are configurable.
    """
    rows = max(0, int(rows))
    cost = state.cost_per_embedded_row
    ceiling = state.peak_ceiling_bytes if peak else state.steady_ceiling_bytes
    name = "peak" if peak else "steady"

    # TWO FLOORS, NOT ONE. The reserved headroom floor is a steady-state
    # guarantee; a migration is explicitly allowed to dip into part of it, which
    # is the entire reason the peak ceiling exists. Clamping the peak case to the
    # steady floor makes the peak allowance unreachable — at the default
    # percentages `cap - steady_floor` is exactly the steady ceiling, so the two
    # modes collapse into one and the index rebuild that would FREE space becomes
    # impossible. The transient floor is whatever the peak ceiling leaves.
    #
    # The clamp is retained in both modes because the percentages are
    # configurable: a misconfiguration such as steady=95% with floor=12.5% is
    # self-contradictory, and the stricter of the two must win rather than
    # whichever was written last.
    floor = state.transient_floor_bytes if peak else state.reserve_floor_bytes
    effective_ceiling = min(ceiling, state.cap_bytes - floor)
    room = max(0, effective_ceiling - state.db_bytes)
    affordable = room // cost if cost > 0 else 0

    return Projection(
        rows_requested=rows,
        rows_affordable=int(affordable),
        cost_per_row=cost,
        current_bytes=state.db_bytes,
        projected_bytes=state.db_bytes + rows * cost,
        ceiling_bytes=effective_ceiling,
        ceiling_name=name,
        reserve_floor_bytes=state.reserve_floor_bytes,
        cap_bytes=state.cap_bytes,
    )


async def _main() -> int:
    """Standalone headroom check. Reads only; writes nothing."""
    from app.db.session import get_engine, get_sessionmaker

    try:
        async with get_sessionmaker()() as session:
            try:
                state = await read_state(session)
            except StorageUnmeasurable as exc:
                print(f"UNMEASURABLE: {exc}")
                return 2
            print(state.explain())
            unembedded = state.total_narratives - state.embedded_narratives
            if unembedded > 0:
                p = project(state, unembedded)
                print()
                print(f"If all {unembedded} unembedded narratives were embedded:")
                print(p.explain())
            return 0 if (state.within_reserve and state.within_steady_ceiling) else 1
    finally:
        # Without an explicit dispose, asyncpg's SSL transport is torn down by the
        # interpreter after the event loop has closed, which prints a spurious
        # "Fatal error on SSL transport" traceback *after* the report. Harmless,
        # but it makes a clean run look like a crash.
        await get_engine().dispose()


if __name__ == "__main__":
    import asyncio
    import sys

    sys.exit(asyncio.run(_main()))
