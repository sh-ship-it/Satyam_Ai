import sys
import os

from app.config import get_settings
from app.models.registry import get_embedder, get_reranker
import asyncio

async def test():
    print("Loading embedder...")
    embedder = get_embedder()
    print("Embedding warmup...")
    res1 = await embedder.embed(["warmup"])
    print("Embedder result shape:", len(res1))
    
    print("Loading reranker...")
    reranker = get_reranker()
    print("Reranking warmup...")
    res2 = await reranker.rerank("warmup", ["x"])
    print("Reranker result:", res2)
    print("Warmup done!")

if __name__ == "__main__":
    try:
        asyncio.run(test())
    except Exception as e:
        print("Warmup script failed with exception:", e)
        import traceback
        traceback.print_exc()
