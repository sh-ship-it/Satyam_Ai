import sys
print("Python", sys.version, flush=True)

import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), flush=True)

print("importing sentence_transformers...", flush=True)
import sentence_transformers
print("sentence_transformers", sentence_transformers.__version__, flush=True)

print("importing SentenceTransformer class...", flush=True)
from sentence_transformers import SentenceTransformer
print("SentenceTransformer imported OK", flush=True)

print("loading model from disk...", flush=True)
m = SentenceTransformer("models/bge-m3", device="cuda")
print("model loaded", flush=True)

print("encoding...", flush=True)
v = m.encode(["test"], normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
print("dim:", v.shape, flush=True)
