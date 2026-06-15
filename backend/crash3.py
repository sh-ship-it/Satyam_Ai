import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), flush=True)
from FlagEmbedding.inference.embedder.encoder_only.base import BaseEmbedder
print("BaseEmbedder OK", flush=True)
