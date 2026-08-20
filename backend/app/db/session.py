"""Async SQLAlchemy engine + session, with runtime database-source switching.

The Settings panel can flip between "cloud" (Neon) and "local" (localhost
Postgres) via POST /settings/db-source. The active source is stored in
`_db_source` and picked up on the next request — no restart required.

Two separate engines are lazily created and cached so switching is instant
(both connection pools warm up independently).
"""
from __future__ import annotations

from typing import AsyncIterator, Literal

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

# ── Active source (process-wide, toggled by /settings/db-source) ─────────────
# Seeded from settings rather than hardcoded, so DB_SOURCE=local in the
# environment is honoured at startup. Previously this was a literal "cloud",
# which made local_database_url and set_db_source() unreachable dead code.
_db_source: Literal["cloud", "local"] = get_settings().db_source

# Separate engine + sessionmaker caches for each source
_engines: dict[str, AsyncEngine] = {}
_sessionmakers: dict[str, async_sessionmaker[AsyncSession]] = {}


def set_db_source(source: Literal["cloud", "local"]) -> None:
    global _db_source
    _db_source = source


def get_db_source() -> Literal["cloud", "local"]:
    return _db_source


def active_url() -> str:
    """Return the URL for the currently active source."""
    s = get_settings()
    if _db_source == "local":
        return s.local_database_url or s.database_url
    return s.database_url


def active_vector_type() -> str:
    """Return the pgvector column type of the ACTIVE source: vector | halfvec.

    The two databases differ on purpose — local stores fp32 `vector`, cloud
    stores fp16 `halfvec` because a 512 MB Neon project cannot hold fp32 vectors
    plus an HNSW index. Since the source is switchable at runtime, the cast has
    to be resolved per request; a query vector cast to the wrong type makes the
    `<=>` operator fail to find a match and the whole vector arm goes dark.
    """
    s = get_settings()
    return s.vector_type if _db_source == "local" else s.cloud_vector_type


def _get_engine(source: Literal["cloud", "local"]) -> AsyncEngine:
    if source not in _engines:
        s = get_settings()
        url = s.local_database_url if source == "local" else s.database_url
        _engines[source] = create_async_engine(
            url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            future=True,
        )
    return _engines[source]


def get_engine() -> AsyncEngine:
    """Return the engine for the currently active source."""
    return _get_engine(_db_source)


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _db_source not in _sessionmakers:
        _sessionmakers[_db_source] = async_sessionmaker(
            bind=_get_engine(_db_source),
            expire_on_commit=False,
            class_=AsyncSession,
        )
    return _sessionmakers[_db_source]


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a transactional session."""
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
