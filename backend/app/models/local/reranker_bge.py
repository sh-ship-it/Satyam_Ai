"""bge-reranker-v2-m3 (cross-encoder). DEMO stub: lexical overlap scoring.

Replace with sentence-transformers CrossEncoder for real relevance.
"""
from __future__ import annotations


class BgeReranker:
    async def rerank(self, query: str, docs: list[str]) -> list[int]:
        q = set(query.lower().split())

        def score(doc: str) -> int:
            return len(q & set(doc.lower().split()))

        return sorted(range(len(docs)), key=lambda i: score(docs[i]), reverse=True)
