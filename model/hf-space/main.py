"""Satyam — Model API Service (BGE-M3 Embedder + BGE-Reranker-v2-m3).

Deploy on Hugging Face Spaces (Docker SDK, free CPU-Basic tier, 16 GB RAM).
Secures all endpoints with an X-API-Key header.

Endpoints:
    POST /embed   — returns L2-normalised 1024-d dense vectors
    POST /rerank  — returns document indices sorted by relevance (best-first)
    GET  /health  — liveness probe
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from typing import List

import numpy as np
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

# ── API-key authentication ────────────────────────────────────────────────────

API_KEY = os.getenv("MODEL_SERVICE_API_KEY", "change-me")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _verify_key(key: str | None = Security(_api_key_header)):
    if not key or key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return key


# ── Model singletons (loaded once at startup) ────────────────────────────────

_embedder = None
_reranker = None

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-m3")
RERANK_MODEL = os.getenv("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
DEVICE = os.getenv("DEVICE", "cpu")


def _load_models():
    """Load both models into memory. Called once during app startup."""
    global _embedder, _reranker
    from sentence_transformers import SentenceTransformer, CrossEncoder

    print(f"[model-service] Loading embedder: {EMBED_MODEL} on {DEVICE} …")
    t0 = time.time()
    _embedder = SentenceTransformer(EMBED_MODEL, device=DEVICE)
    _embedder.max_seq_length = 8192
    print(f"[model-service] Embedder loaded in {time.time() - t0:.1f}s")

    print(f"[model-service] Loading reranker: {RERANK_MODEL} on {DEVICE} …")
    t0 = time.time()
    _reranker = CrossEncoder(RERANK_MODEL, max_length=512, device=DEVICE)
    print(f"[model-service] Reranker loaded in {time.time() - t0:.1f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_models()
    yield


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Satyam Model Service",
    description="BGE-M3 embeddings + BGE-Reranker-v2-m3, protected by API key.",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=256)


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dim: int


class RerankRequest(BaseModel):
    query: str
    documents: List[str] = Field(..., min_length=1, max_length=256)


class RerankResponse(BaseModel):
    indices: List[int]
    scores: List[float]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "embedder": EMBED_MODEL,
        "reranker": RERANK_MODEL,
        "device": DEVICE,
    }


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(_verify_key)])
async def embed(req: EmbedRequest):
    """Return L2-normalised 1024-d vectors for each input text."""
    import asyncio

    def _encode():
        arr = _embedder.encode(
            req.texts,
            batch_size=12,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        arr = np.asarray(arr, dtype="float32")
        return arr.tolist(), int(arr.shape[1])

    vecs, dim = await asyncio.to_thread(_encode)
    return EmbedResponse(embeddings=vecs, dim=dim)


@app.post("/rerank", response_model=RerankResponse, dependencies=[Depends(_verify_key)])
async def rerank(req: RerankRequest):
    """Return document indices sorted best-first by relevance to the query."""
    import asyncio

    def _score():
        pairs = [(req.query, d) for d in req.documents]
        scores = _reranker.predict(pairs)
        scores_list = [float(s) for s in scores]
        indices = sorted(range(len(scores_list)), key=lambda i: scores_list[i], reverse=True)
        sorted_scores = [scores_list[i] for i in indices]
        return indices, sorted_scores

    indices, scores = await asyncio.to_thread(_score)
    return RerankResponse(indices=indices, scores=scores)


# ── Main (for local dev / HF Spaces Docker) ──────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "7860"))  # HF Spaces expects port 7860
    uvicorn.run(app, host="0.0.0.0", port=port)
