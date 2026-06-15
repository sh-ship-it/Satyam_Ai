import sys, importlib
print("torch:", end=" ", flush=True)
import torch; print(torch.__version__)

# Walk FlagEmbedding submodules manually
mods = [
    "FlagEmbedding.abc",
    "FlagEmbedding.finetune",
    "FlagEmbedding.inference",
    "FlagEmbedding.inference.embedder",
    "FlagEmbedding.inference.embedder.encoder_only",
    "FlagEmbedding.inference.embedder.encoder_only.base",
    "FlagEmbedding.inference.reranker",
    "FlagEmbedding.inference.reranker.encoder_only",
]
for m in mods:
    try:
        importlib.import_module(m)
        print(f"OK: {m}")
    except Exception as e:
        print(f"FAIL: {m} — {type(e).__name__}: {e}")
        break

print("Done")
