import torch
print("torch ok", flush=True)
import multiprocessing as mp
print("mp ok", flush=True)
from tqdm import tqdm
print("tqdm ok", flush=True)
from transformers import is_torch_npu_available
print("transformers ok", flush=True)
from FlagEmbedding.abc.inference.AbsEmbedder import AbsEmbedder
print("AbsEmbedder ok", flush=True)
