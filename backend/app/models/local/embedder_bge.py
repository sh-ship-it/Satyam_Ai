"""BGE-M3 embedder (sole embedder for the whole system).

DEMO stub: deterministic hash-based pseudo-embedding so retrieval works without
GPU/weights. Replace `embed` with:

    from FlagEmbedding import BGEM3FlagModel
    self.model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
    out = self.model.encode(texts)["dense_vecs"]

Keep `dim` aligned with the pgvector column (1024).
"""
from __future__ import annotations

import hashlib
import math


class BgeM3Embedder:
    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        seed = hashlib.sha256(text.lower().encode("utf-8")).digest()
        vals: list[float] = []
        i = 0
        while len(vals) < self.dim:
            h = hashlib.sha256(seed + i.to_bytes(2, "big")).digest()
            for b in h:
                if len(vals) >= self.dim:
                    break
                vals.append((b / 255.0) * 2 - 1)
            i += 1
        norm = math.sqrt(sum(v * v for v in vals)) or 1.0
        return [v / norm for v in vals]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]
