"""Verify real local model inference works end-to-end."""
import asyncio

def test_embedder():
    from app.models.local.embedder_bge import BgeM3Embedder
    vecs = asyncio.run(BgeM3Embedder(1024).embed(["test FIR in Bengaluru"]))
    assert len(vecs) == 1
    assert len(vecs[0]) == 1024, f"Expected 1024, got {len(vecs[0])}"
    # verify L2-normalised (norm ≈ 1.0)
    import math
    norm = math.sqrt(sum(x*x for x in vecs[0]))
    assert abs(norm - 1.0) < 1e-4, f"Not normalised: norm={norm}"
    print(f"✓ Embedder: 1024-d, norm={norm:.6f}")

def test_reranker():
    from app.models.local.reranker_bge import BgeReranker
    order = asyncio.run(BgeReranker().rerank(
        "theft case",
        ["a theft of motor vehicle in Mysuru on 12 Jan", "a wedding celebration in Bengaluru"]
    ))
    assert order[0] == 0, f"Expected theft doc first, got order={order}"
    print(f"✓ Reranker: order={order} (theft doc ranked first)")

if __name__ == "__main__":
    print("Loading models (first call — ~2.3 GB, may take 30–60 s on first load)…")
    test_embedder()
    test_reranker()
    print("\nAll checks passed. No network access needed — loaded from local disk.")
