"""Narrative retrieval (RAG) over pgvector, with reranking.

Embeds the query with BGE-M3, does an ANN search on narratives.embedding via the
pgvector cosine distance operator, then reranks the candidates.  Runs in the
RLS-scoped session, so retrieval respects the caller's clearance/jurisdiction.

Supports both `vector(1024)` (local, fp32) and `halfvec(1024)` (Neon, fp16)
via the `VECTOR_TYPE` config setting (BUG-D2 fix).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.registry import get_embedder, get_reranker


def _to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


async def search_narratives(
    session: AsyncSession, query: str, *, k: int = 5
) -> list[dict]:
    embedder = get_embedder()
    [qvec] = await embedder.embed([query])

    vt = get_settings().vector_type  # "vector" | "halfvec"
    vec_literal = _to_pgvector(qvec)

    sql = text(
        f"""
        SELECT n.case_id, n.body AS text,
               (n.embedding <=> (:qvec)::{vt}) AS distance
        FROM narratives n
        WHERE n.embedding IS NOT NULL
        ORDER BY n.embedding <=> (:qvec)::{vt}
        LIMIT :k
        """
    )
    try:
        result = await session.execute(sql, {"qvec": vec_literal, "k": k * 3})
        rows = [dict(r) for r in result.mappings().all()]
    except Exception:
        # Vector op unavailable (e.g. embeddings not yet generated) → lexical fallback.
        result = await session.execute(
            text(
                "SELECT case_id, body AS text FROM narratives "
                "WHERE body_tsv @@ plainto_tsquery('simple', :q) LIMIT :k"
            ),
            {"q": query, "k": k * 3},
        )
        rows = [dict(r) for r in result.mappings().all()]
        if not rows:
            result = await session.execute(
                text("SELECT case_id, body AS text FROM narratives LIMIT :k"),
                {"k": k * 3},
            )
            rows = [dict(r) for r in result.mappings().all()]

    if not rows:
        return []
    order = await get_reranker().rerank(query, [r["text"] for r in rows])
    return [rows[i] for i in order[:k]]
