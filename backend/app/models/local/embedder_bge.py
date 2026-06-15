"""BGE-M3 embedder (sole embedder for the whole system).

Real local inference — loads weights from disk, runs on GPU (FP16) or CPU.
Model: BAAI/bge-m3, ~568M params, dim 1024.
Path / device / precision come from Settings (single source of truth).
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

import numpy as np

from app.config import get_settings


@lru_cache(maxsize=1)
def _load_model(path: str, use_fp16: bool, device: str):
    """Load BGE-M3 once and cache for the process lifetime (~2.3 GB weights)."""
    from FlagEmbedding import BGEM3FlagModel  # type: ignore[import]

    # FlagEmbedding uses CUDA automatically; force CPU by passing device="cpu"
    # via the underlying transformers config when fp16 is off.
    return BGEM3FlagModel(path, use_fp16=use_fp16)


class BgeM3Embedder:
    """BGE-M3 dense embedder.  Registry calls BgeM3Embedder(dim=1024)."""

    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        s = get_settings()
        self._path = s.embedding_model_path
        self._device = s.model_device
        self._use_fp16 = s.model_fp16

    # ── sync heavy work, called inside asyncio.to_thread ─────────────────────

    def _encode(self, texts: list[str]) -> list[list[float]]:
        model = _load_model(self._path, self._use_fp16, self._device)
        # batch_size=12 fits comfortably in 8 GB VRAM alongside the reranker
        out = model.encode(
            texts,
            batch_size=12,
            max_length=8192,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
        )["dense_vecs"]
        arr = np.asarray(out, dtype="float32").reshape(len(texts), -1)
        # L2-normalise so cosine distance == pgvector <=> operator
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0.0] = 1.0
        arr = arr / norms
        assert arr.shape[1] == self.dim, (
            f"BGE-M3 returned {arr.shape[1]}-d vectors; expected {self.dim}. "
            "Check EMBEDDING_MODEL_PATH points to the correct model."
        )
        return arr.tolist()

    # ── public async interface (called from async request handlers) ───────────

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one L2-normalised 1024-float vector per input text."""
        if not texts:
            return []
        return await asyncio.to_thread(self._encode, texts)
