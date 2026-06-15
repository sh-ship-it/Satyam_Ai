"""bge-reranker-v2-m3 (cross-encoder reranker for RAG).

Model: BAAI/bge-reranker-v2-m3 — ~568M params, ~1.1 GB FP16.
CPU-capable but lives on the demo GPU (RTX 4070, 8 GB VRAM) alongside the
BGE-M3 embedder. Combined weights: ~2.4 GB FP16; peak VRAM ~4–5 GB —
comfortable within the 8 GB budget.

Reranks hybrid pgvector + BM25 candidates after ANN retrieval.

DEMO stub: lexical overlap scoring. Replace with sentence-transformers
CrossEncoder for real relevance:

    from sentence_transformers import CrossEncoder
    self.model = CrossEncoder("BAAI/bge-reranker-v2-m3")
    scores = self.model.predict([(query, doc) for doc in docs])
"""
from __future__ import annotations


class BgeReranker:
    async def rerank(self, query: str, docs: list[str]) -> list[int]:
        q = set(query.lower().split())

        def score(doc: str) -> int:
            return len(q & set(doc.lower().split()))

        return sorted(range(len(docs)), key=lambda i: score(docs[i]), reverse=True)
