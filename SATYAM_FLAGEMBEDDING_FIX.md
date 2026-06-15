# Satyam — Local-Model Crash Fix (FlagEmbedding → sentence-transformers)

> Deep scan of `Satyam_Ai-main.zip` (backend). Verdict on the crash theory + the
> exact code to make the local BGE-M3 embedder and bge-reranker-v2-m3 work 100%
> on Windows, end-to-end (runtime RAG **and** the seed embedding job).

---

## 0. Verdict on your theory

**Your FIX is correct. Your ROOT-CAUSE wording is partly wrong — read this.**

| Claim | Verdict |
|---|---|
| "The class body is fine, it's standard Python" | ✅ Correct. `embedder_bge.py` imports FlagEmbedding *lazily* inside `_load_model`, so importing the module never touches CUDA. The crash is inside FlagEmbedding. |
| "Use `sentence-transformers` directly for both models" | ✅ Correct and recommended. It loads the **same weights**, single-process, no multi-GPU spawn, and is already proven working (your reranker uses it). This sidesteps the FlagEmbedding crash entirely. |
| "`torch.cuda.device_count()` is called **at import time**, line 124" | ⚠️ Not quite. `device_count()` runs inside FlagEmbedding's `AbsEmbedder.get_target_devices()` at **model-construction time** (`BGEM3FlagModel(...)`), not at module import. |
| "DLL version conflict during CUDA init" | ❌ Unlikely. Your own verification already printed `cuda? True` + `NVIDIA GeForce RTX 4070`, which means `torch.cuda.is_available()` / `device_count()` and the CUDA DLLs **already initialise fine**. A plain CUDA-DLL conflict would have failed *that* command too. |

**What actually crashes:** FlagEmbedding's `AbsEmbedder` builds its own Python
`multiprocessing` encode pool (spawn on Windows) and enumerates CUDA devices
during construction. The spawn + re-import + CUDA-in-child pattern is a known
hard-crash/hang on Windows. Your debug scripts (`crash2.py` importing
`AbsEmbedder`, `crash3.py` importing `BaseEmbedder`) were circling exactly this
import/construction chain. The precise line number is irrelevant once we stop
using FlagEmbedding.

**Bottom line:** keep your fix (sentence-transformers for both), ignore the
"import-time DLL" explanation, and apply everything below. `torch` + CUDA are
healthy on your machine.

**Equivalence guarantee:** `BAAI/bge-m3` ships sentence-transformers config
(`modules.json` + `1_Pooling/config.json`, **CLS** pooling). Loading it with
`SentenceTransformer(...)` and `normalize_embeddings=True` yields the same
1024-d unit dense vectors as FlagEmbedding's `dense_vecs`. (Verify the folder
has those files — see §6, Step E.)

---

## Bug summary (deep scan)

| # | Severity | File | Problem |
|---|---|---|---|
| B1 | **Critical** | `app/models/local/embedder_bge.py` | Uses `BGEM3FlagModel` → Windows crash. Replace with `SentenceTransformer`. |
| B2 | **High** | `app/models/local/embedder_bge.py` | `self._device` is read from settings but **never passed** to the model (`BGEM3FlagModel(path, use_fp16=...)` ignores it) — `MODEL_DEVICE=cpu` would be silently ignored. Fixed by B1. |
| B3 | **Critical** | `seed/embed_narratives.py` | Still calls `BGEM3FlagModel("BAAI/bge-m3", ...)` → (a) **same crash** in the seed job, (b) loads from the **HF repo id** (re-download / needs network) instead of the local folder, (c) does **not** normalise → a *second*, divergent embedder. Must reuse the registry embedder. |
| B4 | Low (cleanup) | `crash2.py`, `crash3.py`, `find_crash.py`, `test_load.py` | Leftover debug scripts that import FlagEmbedding; `test_load.py` will crash. Delete them. |
| B5 | Low | `requirements.txt` | `FlagEmbedding` no longer used after B1/B3 — drop it to remove the crashing dependency. (Keep `sentence-transformers`.) |
| S1 | Note (Neon only) | `seed/embed_narratives.py` | Hardcodes `$1::vector` although you now have a `vector_type` setting. Fine for **local** pgvector; for **Neon halfvec** it must cast `::halfvec`. See §5. |

The reranker (`reranker_bge.py`) is **already correct** — it uses
`sentence_transformers.CrossEncoder`. No change needed.

---

## B1 — Replace `app/models/local/embedder_bge.py` (FULL FILE)

```python
"""BGE-M3 embedder (sole embedder for the whole system).

Real local inference via **sentence-transformers** (NOT FlagEmbedding).
Model: BAAI/bge-m3, dim 1024. Loads from local disk; GPU FP16 or CPU.
Path / device / precision come from Settings (single source of truth).

Why sentence-transformers and not FlagEmbedding:
  BGEM3FlagModel builds its own multiprocessing encode pool and enumerates CUDA
  devices at construction, which crashes on Windows. sentence-transformers loads
  the SAME weights single-process and is already working in this project (the
  reranker uses it). BGE-M3 ships ST config (CLS pooling), so the dense vectors
  are equivalent when L2-normalised.
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

import numpy as np

from app.config import get_settings


@lru_cache(maxsize=1)
def _load_model(path: str, use_fp16: bool, device: str):
    """Load BGE-M3 once and cache for the process lifetime (~1.3 GB FP16)."""
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(path, device=device)
    model.max_seq_length = 8192  # BGE-M3 supports long context; ST pads per-batch
    if use_fp16 and device != "cpu":
        try:
            model.half()
        except Exception:
            pass  # non-fatal — stays fp32
    return model


class BgeM3Embedder:
    """BGE-M3 dense embedder. Registry calls BgeM3Embedder(dim=1024)."""

    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        s = get_settings()
        self._path = s.embedding_model_path
        self._device = s.model_device
        self._use_fp16 = s.model_fp16

    # ── sync heavy work, run inside asyncio.to_thread ────────────────────────
    def _encode(self, texts: list[str]) -> list[list[float]]:
        model = _load_model(self._path, self._use_fp16, self._device)
        arr = model.encode(
            texts,
            batch_size=12,                # fits 8 GB VRAM alongside the reranker
            normalize_embeddings=True,    # unit vectors => cosine == pgvector <=>
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        arr = np.asarray(arr, dtype="float32").reshape(len(texts), -1)
        assert arr.shape[1] == self.dim, (
            f"BGE-M3 returned {arr.shape[1]}-d vectors; expected {self.dim}. "
            "Check EMBEDDING_MODEL_PATH points to the bge-m3 folder (and that it "
            "contains modules.json + 1_Pooling/ so ST uses CLS pooling)."
        )
        return arr.tolist()

    # ── public async interface ───────────────────────────────────────────────
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one L2-normalised 1024-float vector per input text."""
        if not texts:
            return []
        return await asyncio.to_thread(self._encode, texts)
```

### Key API differences this fixes (FlagEmbedding → ST)
- `SentenceTransformer.encode()` has **no** `max_length` / `return_dense` /
  `return_sparse` / `return_colbert_vecs` kwargs — passing them raises. Max
  length is set via `model.max_seq_length`.
- Normalisation is done with `normalize_embeddings=True` (no manual division).
- `device` is now actually honoured (fixes B2).

---

## B3 — Fix the seed job `seed/embed_narratives.py`

Replace the **entire `load_embedder()` function** with the version below so the
seed job uses the *same* sentence-transformers embedder (local path, GPU,
normalised). This kills the seed-time crash, stops the HF re-download, and
guarantees seed-time and query-time vectors share one space.

```python
def load_embedder():
    """Single source of truth: reuse the SAME embedder used at query time.

    This is the sentence-transformers BGE-M3 loaded from EMBEDDING_MODEL_PATH
    (local folder, GPU FP16, L2-normalised). Reusing it guarantees seed-time and
    query-time vectors live in the same space.
    """
    from app.models.registry import get_embedder

    embedder = get_embedder()

    async def embed(texts: list[str]) -> list[list[float]]:
        return await embedder.embed(texts)

    return embed
```

Delete the old `try: from FlagEmbedding ... except ImportError: <hash stub>`
body entirely. Keep `vec_literal()` and the rest of the file as-is for local
runs.

---

## B4 — Delete leftover debug scripts (from `backend/`)

```powershell
Remove-Item crash2.py, crash3.py, find_crash.py, test_load.py
```
These only exist to chase the FlagEmbedding crash and import it directly.

---

## B5 — `requirements.txt`: drop FlagEmbedding (optional but recommended)

Remove the `FlagEmbedding` line. Keep:
```
sentence-transformers
```
`torch` stays as installed via the cu121 index. Nothing else uses FlagEmbedding
after B1 + B3, so removing it eliminates the crashing dependency from the env.
(If you prefer not to touch the env, leaving it installed-but-unused is harmless.)

---

## 5. Local vs Neon (S1) — leave for now if you're local

`embed_narratives.py` hardcodes `UPDATE ... SET embedding = $1::vector` and
builds the HNSW index with `vector_cosine_ops`. That is **correct for local
pgvector** (`vector_type="vector"`). Only if/when you embed against **Neon free
tier** (`halfvec(1024)`) do you need to cast `::halfvec` and use
`halfvec_cosine_ops`. Don't change it for the local run.

---

## 6. Verify it works (run from `backend/`, venv active)

**A. Embedder loads from LOCAL disk, correct dim, no crash:**
```powershell
.venv\Scripts\python -c "import asyncio; from app.models.local.embedder_bge import BgeM3Embedder; v=asyncio.run(BgeM3Embedder(1024).embed(['theft in Mysuru'])); print('dim', len(v[0]))"
```
Expect `dim 1024`, no FlagEmbedding, no crash.

**B. Reranker orders by relevance (unchanged, sanity):**
```powershell
.venv\Scripts\python -c "import asyncio; from app.models.local.reranker_bge import BgeReranker; print(asyncio.run(BgeReranker().rerank('theft case in Mysuru', ['a theft FIR in Mysuru','a wedding invitation'])))"
```
Expect `[0, 1]`.

**C. Pooling sanity — related > unrelated (catches wrong/mean pooling):**
```powershell
.venv\Scripts\python -c "import asyncio,numpy as np; from app.models.local.embedder_bge import BgeM3Embedder; e=BgeM3Embedder(1024); v=asyncio.run(e.embed(['theft of a motorcycle','two-wheeler stolen at night','recipe for biryani'])); v=np.array(v); print('related', float(v[0]@v[1]), 'unrelated', float(v[0]@v[2]))"
```
Expect `related` clearly higher than `unrelated` (e.g. ~0.6+ vs <0.4).

**D. Registry resolves to the real classes:**
```powershell
.venv\Scripts\python -c "from app.models.registry import get_embedder,get_reranker; print(type(get_embedder()).__name__, type(get_reranker()).__name__)"
```
Expect `BgeM3Embedder BgeReranker`.

**E. Confirm the model folder is a real ST model (CLS pooling present):**
```powershell
Get-ChildItem models\bge-m3\modules.json, models\bge-m3\1_Pooling\config.json
```
Both must exist. If `encode` ever logs *"No sentence-transformers model found, creating with MEAN pooling"*, the folder is incomplete — re-download with
`.venv\Scripts\huggingface-cli download BAAI/bge-m3 --local-dir models\bge-m3`.

**F. Seed job no longer crashes / re-downloads (after load_seed):**
```powershell
.venv\Scripts\python -m seed.embed_narratives --local
```
It should embed via the local ST model on GPU. **Re-embed note:** any rows
embedded earlier with the demo hash-stub are not comparable to real vectors —
clear and re-run:
```sql
UPDATE narratives SET embedding = NULL;
```
then re-run the seed command above.

---

## Apply order
1. B1 — replace `embedder_bge.py`.
2. B3 — fix `load_embedder()` in `seed/embed_narratives.py`.
3. B4 — delete the 4 debug scripts.
4. B5 — drop `FlagEmbedding` from `requirements.txt` (optional).
5. Run §6 A–F. All green = 100% wired, crash gone.
