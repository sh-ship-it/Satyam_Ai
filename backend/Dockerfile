FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps (build tools for asyncpg etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# Zoho Catalyst AppSail injects the port to listen on as
# X_ZOHO_CATALYST_LISTEN_PORT (default 9000; ports 0-1024 are reserved except
# 80/443). A hardcoded --port 8000 builds and starts fine but never receives
# traffic, which looks like an application fault rather than a config one.
# Falling back to 8000 keeps `docker compose` and local runs unchanged.
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS "http://localhost:${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-8000}}/health" || exit 1

# Exec form via sh so the env vars expand at runtime, not at build time.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-8000}}"]
