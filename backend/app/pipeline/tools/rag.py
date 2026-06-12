"""Narrative retrieval (RAG) over pgvector, with reranking.

Embeds the query with BGE-M3, does an ANN search on narratives.embedding via the
pgvector `<=>` cosine distance operator, then reranks the candidates. Runs in
the RLS-scoped session, so retrieval respects the caller's clearance.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.registry import get_embedder, get_reranker


def _to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


async def search_narratives(
    session: AsyncSession, query: str, *, k: int = 5
) -> list[dict]:
    embedder = get_embedder()
    [qvec] = await embedder.embed([query])
    sql = text(
        """
        SELECT n.case_id, n.text, (n.embedding <=> (:qvec)::vector) AS distance
        FROM narratives n
        WHERE n.embedding IS NOT NULL
        ORDER BY n.embedding <=> (:qvec)::vector
        LIMIT :k
        """
    )
    try:
        result = await session.execute(sql, {"qvec": _to_pgvector(qvec), "k": k * 3})
        rows = [dict(r) for r in result.mappings().all()]
    except Exception:
        # Vector op unavailable (e.g. demo without pgvector) -> lexical fallback.
        result = await session.execute(
            text("SELECT case_id, text FROM narratives LIMIT :k"), {"k": k * 3}
        )
        rows = [dict(r) for r in result.mappings().all()]

    if not rows:
        return []
    order = await get_reranker().rerank(query, [r["text"] for r in rows])
    return [rows[i] for i in order[:k]]
