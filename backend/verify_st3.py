import torch
print("torch ok", flush=True)

# Step through sentence_transformers imports manually
import importlib, traceback

submods = [
    "sentence_transformers.util",
    "sentence_transformers.models",
    "sentence_transformers.models.Transformer",
    "sentence_transformers.cross_encoder",
    "sentence_transformers.cross_encoder.CrossEncoder",
]
for m in submods:
    try:
        importlib.import_module(m)
        print(f"OK: {m}", flush=True)
    except Exception as e:
        print(f"FAIL {m}: {e}", flush=True)
        traceback.print_exc()
        break
