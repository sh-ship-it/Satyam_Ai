"""bge-reranker-v2-m3 cross-encoder reranker.

Supports two modes:
  1. **Remote** — if MODEL_SERVICE_URL is set, sends query + docs to the
     hosted model-service over HTTP (zero local GPU/RAM needed).
  2. **Local** — loads weights from disk, runs on GPU (FP16) or CPU.

Model: BAAI/bge-reranker-v2-m3, ~568M params, ~1.1 GB FP16.
Path / device / precision come from Settings (single source of truth).
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

from app.config import get_settings


# ── Local model loader (unchanged from original) ─────────────────────────────

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
        # Remote model service config
        self._service_url = s.model_service_url.rstrip("/") if s.model_service_url else ""
        self._service_key = s.model_service_api_key

    # ── remote HTTP call ─────────────────────────────────────────────────────

    async def _rerank_remote(self, query: str, docs: list[str]) -> list[int]:
        """Call the hosted model service at MODEL_SERVICE_URL/rerank."""
        import httpx

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self._service_url}/rerank",
                json={"query": query, "documents": docs},
                headers={"X-API-Key": self._service_key},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["indices"]

    # ── local inference ──────────────────────────────────────────────────────

    def _order(self, query: str, docs: list[str]) -> list[int]:
        model = _load_model(self._path, self._use_fp16, self._device)
        scores = model.predict([(query, d) for d in docs])
        return sorted(range(len(docs)), key=lambda i: float(scores[i]), reverse=True)

    # ── public async interface ───────────────────────────────────────────────

    async def rerank(self, query: str, docs: list[str]) -> list[int]:
        """Return document indices sorted best-first (rag.py does order[:k])."""
        if not docs:
            return []
        # Prefer remote service when configured
        if self._service_url:
            return await self._rerank_remote(query, docs)
        return await asyncio.to_thread(self._order, query, docs)
