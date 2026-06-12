import os

# Ensure tests run in demo mode (no external models / DB needed for unit tests).
os.environ.setdefault("MODEL_BACKEND", "api")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam")
