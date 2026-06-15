"""bge-reranker-v2-m3 cross-encoder reranker.

Real local inference — loads weights from disk, runs on GPU (FP16) or CPU.
Model: BAAI/bge-reranker-v2-m3, ~568M params, ~1.1 GB FP16.
Path / device / precision come from Settings (single source of truth).
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

from app.config import get_settings


@lru_cache(maxsize=1)
def _load_model(path: str, use_fp16: bool, device: str):
    """Load CrossEncoder once and cache for the process lifetime (~1.1 GB weights)."""
    from sentence_transformers import CrossEncoder  # type: ignore[import]

    ce = CrossEncoder(path, max_length=512, device=device)
    if use_fp16 and device != "cpu":
        try:
            ce.model.half()
        except Exception:
            pass  # non-fatal — model stays in fp32
    return ce


class BgeReranker:
    """bge-reranker-v2-m3 cross-encoder.  Registry calls BgeReranker()."""

    def __init__(self) -> None:
        s = get_settings()
        self._path = s.reranker_model_path
        self._device = s.model_device
        self._use_fp16 = s.model_fp16

    # ── sync heavy work, called inside asyncio.to_thread ─────────────────────

    def _order(self, query: str, docs: list[str]) -> list[int]:
        model = _load_model(self._path, self._use_fp16, self._device)
        scores = model.predict([(query, d) for d in docs])
        return sorted(range(len(docs)), key=lambda i: float(scores[i]), reverse=True)

    # ── public async interface ────────────────────────────────────────────────

    async def rerank(self, query: str, docs: list[str]) -> list[int]:
        """Return document indices sorted best-first (rag.py does order[:k])."""
        if not docs:
            return []
        return await asyncio.to_thread(self._order, query, docs)
