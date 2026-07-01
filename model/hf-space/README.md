# Satyam Model Service — Deploy on Hugging Face Spaces

A standalone FastAPI microservice that serves BGE-M3 embeddings and
BGE-Reranker-v2-m3 cross-encoder reranking, secured with an API key.

## Quick Deploy on Hugging Face Spaces (Free)

### 1. Create a new Space

1. Go to https://huggingface.co/spaces → **Create new Space**
2. Name: `satyam-model-service`
3. SDK: **Docker**
4. Hardware: **CPU Basic (Free — 16 GB RAM, 2 vCPU)**
5. Visibility: **Public** (API key protects the endpoints)

### 2. Add your API key secret

Go to Space **Settings → Variables and secrets** and add:

| Type     | Name                     | Value                |
|----------|--------------------------|----------------------|
| Secret   | `MODEL_SERVICE_API_KEY`  | `your-strong-secret` |

### 3. Upload files

Upload these three files to the Space repository (via the web UI or `git`):

```
Dockerfile
requirements.txt
main.py
```

All three are in this `model/hf-space/` directory.

### 4. Wait for build

HF Spaces will auto-build the Docker image. First build takes ~8–10 minutes
(downloads ~3.5 GB of model weights). Subsequent restarts are faster because
the weights are cached in `/data/hf_cache`.

### 5. Get your service URL

Once the Space status shows **Running**, your URL will be:

```
https://<your-username>-satyam-model-service.hf.space
```

Test it:

```bash
curl https://<your-username>-satyam-model-service.hf.space/health
```

### 6. Configure the Satyam backend

Add these to your backend `.env`:

```env
MODEL_SERVICE_URL=https://<your-username>-satyam-model-service.hf.space
MODEL_SERVICE_API_KEY=your-strong-secret
```

That's it — the backend will now call your hosted model service for
embeddings and reranking instead of loading the models locally.

## API Reference

### `GET /health`
No auth required. Returns model status.

### `POST /embed`
**Headers:** `X-API-Key: <your-key>`

```json
{ "texts": ["first document", "second document"] }
```

**Response:**
```json
{
  "embeddings": [[0.012, -0.034, ...], [...]],
  "dim": 1024
}
```

### `POST /rerank`
**Headers:** `X-API-Key: <your-key>`

```json
{
  "query": "murder case in Bengaluru",
  "documents": ["doc A text", "doc B text", "doc C text"]
}
```

**Response:**
```json
{
  "indices": [2, 0, 1],
  "scores": [0.95, 0.42, 0.11]
}
```
