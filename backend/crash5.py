"""Test sentence-transformers path for both models."""
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), flush=True)

from sentence_transformers import SentenceTransformer, CrossEncoder
print("sentence_transformers imported OK", flush=True)

# Test embedder
print("Loading BGE-M3 via SentenceTransformer...", flush=True)
emb = SentenceTransformer("models/bge-m3", device="cuda")
vecs = emb.encode(["test theft case in Bengaluru"], normalize_embeddings=True)
print(f"Embed dim: {vecs.shape}, dtype: {vecs.dtype}", flush=True)

# Test reranker
print("Loading reranker...", flush=True)
ce = CrossEncoder("models/bge-reranker-v2-m3", max_length=512, device="cuda")
scores = ce.predict([("theft case", "a theft in Mysuru"), ("theft case", "a wedding")])
print(f"Reranker scores: {scores}", flush=True)

print("ALL OK", flush=True)
