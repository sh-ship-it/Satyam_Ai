import torch
print("torch ok", flush=True)

# Step through BaseEmbedder's imports manually
import logging
print("1", flush=True)
from typing import Any, Union, List, Optional, Tuple
print("2", flush=True)
import numpy as np
print("3", flush=True)
from tqdm import tqdm, trange
print("4", flush=True)
from transformers import AutoTokenizer
print("5 AutoTokenizer", flush=True)
from transformers import AutoModel
print("6 AutoModel", flush=True)
