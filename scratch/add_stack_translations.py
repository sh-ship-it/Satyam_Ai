import json

# Define the translations for all stack items
stack_translations = {
    # Frontend Core
    "React 19": "ರಿಯಾಕ್ಟ್ 19",
    "TanStack Start (SSR)": "ಟ್ಯಾನ್‌ಸ್ಟ್ಯಾಕ್ ಸ್ಟಾರ್ಟ್ (SSR)",
    "TanStack Router": "ಟ್ಯಾನ್‌ಸ್ಟ್ಯಾಕ್ ರೂಟರ್",
    "Vite 7": "ವೈಟ್ 7",
    "TypeScript": "ಟೈಪ್‌ಸ್ಕ್ರಿಪ್ಟ್",
    "Bun Runtime": "ಬನ್ ರನ್‌ಟೈಮ್",

    # UI & Visualization
    "Tailwind CSS v4": "ಟೈಲ್‌ವಿಂಡ್ CSS v4",
    "React Flow (Canvas)": "ರಿಯಾಕ್ಟ್ ಫ್ಲೋ (ಕ್ಯಾನ್ವಾಸ್)",
    "Leaflet Maps": "ಲೀಫ್‌ಲೆಟ್ ನಕ್ಷೆಗಳು",
    "Leaflet.heat (Hotspots)": "ಲೀಫ್‌ಲೆಟ್.ಹೀಟ್ (ಹಾಟ್‌ಸ್ಪಾಟ್‌ಗಳು)",
    "Lucide Icons": "ಲ್ಯೂಸೈಡ್ ಐಕಾನ್‌ಗಳು",
    "Neo-Brutalist System": "ನಿಯೋ-ಬ್ರೂಟಲಿಸ್ಟ್ ಸಿಸ್ಟಮ್",

    # Backend & Server
    "Python 3.11+": "ಪೈಥಾನ್ 3.11+",
    "FastAPI (Async)": "FastAPI (ಅಸಿಂಕ್)",
    "Uvicorn (ASGI)": "ಯುವಿಕಾರ್ನ್ (ASGI)",
    "SQLAlchemy ORM": "SQLAlchemy ORM",
    "asyncpg (Driver)": "asyncpg (ಡ್ರೈವರ್)",
    "Pydantic v2 Schemas": "Pydantic v2 ಸ್ಕೀಮಾಗಳು",
    "httpx (Async Client)": "httpx (ಅಸಿಂಕ್ ಕ್ಲೈಂಟ್)",
    "structlog": "structlog",

    # Database & Cache
    "PostgreSQL 16/17": "PostgreSQL 16/17",
    "pgvector (halfvec/vector)": "pgvector (halfvec/vector)",
    "Redis Session Cache": "ರೆಡಿಸ್ ಸೆಷನ್ ಕ್ಯಾಶ್",
    "Redis PubSub Locks": "ರೆಡಿಸ್ ಪಬ್‌ಸಬ್ ಲಾಕ್‌ಗಳು",
    "SQLGlot Parser Guard": "SQLGlot ಪಾರ್ಸರ್ ಗಾರ್ಡ್",
    "Postgres Advisory Locks": "ಪೋಸ್ಟ್‌ಗ್ರೆಸ್ ಅಡ್ವೈಸರಿ ಲಾಕ್‌ಗಳು",

    # AI Models & Engines
    "Gemini 2.5 Flash": "ಜೆಮಿನಿ 2.5 ಫ್ಲ್ಯಾಶ್",
    "OpenAI ChatGPT": "ಓಪನ್-AI ಚಾಟ್‌ಜಿಪಿಟಿ",
    "Groq Llama-3.3-70B": "ಗ್ರೋಕ್ ಲಾಮಾ-3.3-70B",
    "Groq Llama-3.1-70B": "ಗ್ರೋಕ್ ಲಾಮಾ-3.1-70B",
    "Ollama Cloud (Qwen)": "ಓಲಾಮಾ ಕ್ಲೌಡ್ (Qwen)",
    "Local BGE-M3 (FP16)": "ಸ್ಥಳೀಯ BGE-M3 (FP16)",
    "bge-reranker-v2-m3": "bge-ರೀರ‍್ಯಾಂಕರ್-v2-m3",
    "YOLOv8s Weapon Detect": "YOLOv8s ಆಯುಧ ಪತ್ತೆ",
    "sentence-transformers": "ಸೆಂಟೆನ್ಸ್-ಟ್ರಾನ್ಸ್‌ಫಾರ್ಮರ್ಸ್",
    "FlagEmbedding": "ಫ್ಲಾಗ್ ಎಂಬೆಡಿಂಗ್",

    # Voice & Language
    "Sarvam Bulbul v3 (TTS)": "ಸರ್ವಮ್ ಬುಲ್‌ಬುಲ್ v3 (TTS)",
    "Sarvam Saaras v3 (STT)": "ಸರ್ವಮ್ ಸಾರಸ್ v3 (STT)",
    "Sarvam Mayura v1 (MT)": "ಸರ್ವಮ್ ಮಯೂರ v1 (MT)",
    "Bhashini API (Govt)": "ಭಾಷಿಣಿ API (ಸರ್ಕಾರಿ)",
    "Browser Web Speech API": "ಬ್ರೌಸರ್ ವೆಬ್ ಸ್ಪೀಚ್ API",

    # Security & Integrity
    "SHA-256 Hash-Chaining": "SHA-256 ಹ್ಯಾಶ್-ಚೈನಿಂಗ್",
    "Tamper-Evident Audit": "ತಿರುಚುವಿಕೆ-ನಿರೋಧಕ ಆಡಿಟ್",
    "4-Tier PII Masking (L1-L4)": "4-ಹಂತದ PII ಮಾಸ್ಕಿಂಗ್ (L1-L4)",
    "Row-Level Security (RLS)": "ಸಾಲು-ಮಟ್ಟದ ಭದ್ರತೆ (RLS)",
    "PyJWT Auth Tokens": "PyJWT ದೃಢೀಕರಣ ಟೋಕನ್‌ಗಳು",
    "KSP Rank RBAC/ABAC": "ಕೆಎಸ್‌ಪಿ ಶ್ರೇಣಿ RBAC/ABAC",

    # DevOps & Infra
    "Docker & Compose": "ಡಾಕರ್ ಮತ್ತು ಕಂಪೋಸ್",
    "Zoho Catalyst Deploy": "ಜೋಹೋ ಕ್ಯಾಟಲಿಸ್ಟ್ ನಿಯೋಜನೆ",
    "OpenCV Image Processing": "OpenCV ಚಿತ್ರ ಸಂಸ್ಕರಣೆ",
    "ESLint & Prettier": "ESLint ಮತ್ತು Prettier",
    "CI Build Verification": "CI ಬಿಲ್ಡ್ ಪರಿಶೀಲನೆ"
}

# Load i18n.tsx
filepath = "d:/college/Projects/Satyam/frontend/src/lib/i18n.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Generate TS code for translations
ts_lines = ["  // ── Tech Stack items translations ────────────────────────────────────────"]
for k, v in stack_translations.items():
    k_esc = k.replace('"', '\\"')
    v_esc = v.replace('"', '\\"')
    ts_lines.append(f'  "{k_esc}": "{v_esc}",')

ts_block = "\n".join(ts_lines) + "\n"

# Insert right after the DICT opening
dict_start = "const DICT: Record<string, string> = {"
if dict_start in content:
    new_content = content.replace(dict_start, f"{dict_start}\n{ts_block}")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Stack translations added successfully!")
else:
    print("Error: DICT start not found!")
