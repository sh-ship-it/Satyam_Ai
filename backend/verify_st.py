"""§6 verification suite from satyam_flagembedding_fix.md"""
import asyncio, sys
# Windows/Py3.10 fix: pre-load pandas+sklearn before sentence_transformers triggers them
sys.setrecursionlimit(5000)
import pandas as _pd   # noqa: F401
import sklearn as _sk  # noqa: F401

print("=== A: Embedder dim ===", flush=True)
from app.models.local.embedder_bge import BgeM3Embedder
v = asyncio.run(BgeM3Embedder(1024).embed(["theft in Mysuru"]))
assert len(v[0]) == 1024, f"Expected 1024, got {len(v[0])}"
print(f"dim {len(v[0])} ✓", flush=True)

print("\n=== B: Reranker order ===", flush=True)
from app.models.local.reranker_bge import BgeReranker
order = asyncio.run(BgeReranker().rerank(
    "theft case in Mysuru",
    ["a theft FIR in Mysuru", "a wedding invitation"]
))
assert order[0] == 0, f"Expected theft doc first, got {order}"
print(f"order {order} ✓", flush=True)

print("\n=== C: Pooling sanity (related > unrelated) ===", flush=True)
import numpy as np
e = BgeM3Embedder(1024)
vecs = asyncio.run(e.embed([
    "theft of a motorcycle",
    "two-wheeler stolen at night",
    "recipe for biryani"
]))
v = np.array(vecs)
related = float(v[0] @ v[1])
unrelated = float(v[0] @ v[2])
print(f"related={related:.4f}  unrelated={unrelated:.4f}", flush=True)
assert related > unrelated, f"related ({related:.4f}) should be > unrelated ({unrelated:.4f})"
print("related > unrelated ✓", flush=True)

print("\n=== D: Registry types ===", flush=True)
from app.models.registry import get_embedder, get_reranker
print(type(get_embedder()).__name__, type(get_reranker()).__name__)
assert type(get_embedder()).__name__ == "BgeM3Embedder"
assert type(get_reranker()).__name__ == "BgeReranker"
print("✓", flush=True)

print("\n=== ALL CHECKS PASSED ===", flush=True)
