"""BGE-M3 embedder (sole embedder for the whole system).

Real local inference via **sentence-transformers** (NOT FlagEmbedding).
Model: BAAI/bge-m3, dim 1024. Loads from local disk; GPU FP16 or CPU.
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

    # ── sync heavy work, run inside asyncio.to_thread ────────────────────────

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
        return await asyncio.to_thread(self._encode, texts)
