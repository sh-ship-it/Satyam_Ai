"""BGE-M3 embedder (sole embedder for the whole system).

Supports two modes:
  1. **Remote** — if MODEL_SERVICE_URL is set, sends texts to the hosted
     model-service over HTTP (zero local GPU/RAM needed).
  2. **Local** — loads BAAI/bge-m3 weights via sentence-transformers and
     runs inference on the local CPU/GPU.

Model: BAAI/bge-m3, dim 1024. GPU FP16 or CPU.
Path / device / precision come from Settings (single source of truth).

Why sentence-transformers and not FlagEmbedding:
  BGEM3FlagModel builds its own multiprocessing encode pool and enumerates CUDA
  devices at construction, which crashes on Windows. sentence-transformers loads
  the SAME weights single-process and is already working in this project (the
  reranker uses it). BGE-M3 ships ST config (CLS pooling), so the dense vectors
  are equivalent when L2-normalised.
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

import numpy as np

from app.config import get_settings


# ── Local model loader (unchanged from original) ─────────────────────────────

@lru_cache(maxsize=1)
def _load_model(path: str, use_fp16: bool, device: str):
    """Load BGE-M3 once and cache for the process lifetime (~1.3 GB FP16)."""
    from sentence_transformers import SentenceTransformer  # type: ignore[import]

    model = SentenceTransformer(path, device=device)
    model.max_seq_length = 8192  # BGE-M3 supports long context; ST pads per-batch
    if use_fp16 and device != "cpu":
        try:
            model.half()
        except Exception:
            pass  # non-fatal — stays fp32
    return model


class BgeM3Embedder:
    """BGE-M3 dense embedder.  Registry calls BgeM3Embedder(dim=1024)."""

    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        s = get_settings()
        self._path = s.embedding_model_path
        self._device = s.model_device
        self._use_fp16 = s.model_fp16
        # Remote model service config
        self._service_url = s.model_service_url.rstrip("/") if s.model_service_url else ""
        self._service_key = s.model_service_api_key

    # ── remote HTTP call ─────────────────────────────────────────────────────

    async def _embed_remote(self, texts: list[str]) -> list[list[float]]:
        """Call the hosted model service at MODEL_SERVICE_URL/embed."""
        import httpx

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self._service_url}/embed",
                json={"texts": texts},
                headers={"X-API-Key": self._service_key},
            )
            resp.raise_for_status()
            data = resp.json()
            vecs = data["embeddings"]
            dim = data.get("dim", self.dim)
            assert dim == self.dim, (
                f"Remote embedder returned {dim}-d vectors; expected {self.dim}."
            )
            return vecs

    # ── local inference ──────────────────────────────────────────────────────

    def _encode(self, texts: list[str]) -> list[list[float]]:
        model = _load_model(self._path, self._use_fp16, self._device)
        arr = model.encode(
            texts,
            batch_size=12,             # fits 8 GB VRAM alongside the reranker
            normalize_embeddings=True, # unit vectors => cosine == pgvector <=>
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        arr = np.asarray(arr, dtype="float32").reshape(len(texts), -1)
        assert arr.shape[1] == self.dim, (
            f"BGE-M3 returned {arr.shape[1]}-d vectors; expected {self.dim}. "
            "Check EMBEDDING_MODEL_PATH points to the bge-m3 folder (and that it "
            "contains modules.json + 1_Pooling/ so ST uses CLS pooling)."
        )
        return arr.tolist()

    # ── public async interface ───────────────────────────────────────────────

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one L2-normalised 1024-float vector per input text."""
        if not texts:
            return []
        # Prefer remote service when configured
        if self._service_url:
            return await self._embed_remote(texts)
        return await asyncio.to_thread(self._encode, texts)
