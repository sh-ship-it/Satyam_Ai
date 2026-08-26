"""Runtime settings endpoint.

Allows the frontend Settings panel to flip the active database source (cloud
Neon vs local PostgreSQL) without restarting the server. The selection is stored
process-wide in `_db_source` and is picked up by `db/session.py` on the next
request. Protected by the CHAT permission — any authenticated officer can switch
their session's data source.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.session import set_db_source, get_db_source

router = APIRouter()


class DbSourceRequest(BaseModel):
    source: Literal["cloud", "local"]


class DbSourceResponse(BaseModel):
    db_source: str
    url_host: str


class ModelProviderStatus(BaseModel):
    default_brain_engine: str
    gemini_configured: bool
    openai_configured: bool
    groq_configured: bool
    local_available: bool
    # The OpenAI key allows 50 requests/day, so the remaining count is operational
    # information, not a statistic: at zero the brain has silently failed over to
    # Gemini and the officer should be able to see that without reading logs.
    openai_daily_limit: int
    openai_calls_remaining: int | None = None


@router.get("/models", response_model=ModelProviderStatus)
async def model_providers(
    principal: Principal = Depends(get_principal),
) -> ModelProviderStatus:
    """Return which AI providers are configured (booleans only — never the keys)."""
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    from app.config import get_settings
    from app.models.quota import openai_quota
    s = get_settings()
    return ModelProviderStatus(
        default_brain_engine=s.brain_engine,
        gemini_configured=bool(s.gemini_api_key),
        openai_configured=bool(s.openai_api_key),
        groq_configured=bool(s.groq_api_key),
        local_available=(s.model_backend == "local"),
        openai_daily_limit=openai_quota.limit,
        openai_calls_remaining=(
            await openai_quota.remaining() if s.openai_api_key else None
        ),
    )


@router.post("", response_model=DbSourceResponse)
async def switch_db_source(
    req: DbSourceRequest,
    principal: Principal = Depends(get_principal),
) -> DbSourceResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    set_db_source(req.source)
    host = get_db_source_host()
    return DbSourceResponse(db_source=req.source, url_host=host)


@router.get("", response_model=DbSourceResponse)
async def current_db_source(
    principal: Principal = Depends(get_principal),
) -> DbSourceResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    source = get_db_source()
    return DbSourceResponse(db_source=source, url_host=get_db_source_host())


def get_db_source_host() -> str:
    """Return host:port only — never expose credentials in the response."""
    from app.db.session import active_url
    url = active_url()
    try:
        return url.split("@")[-1].split("/")[0]
    except Exception:
        return "unknown"


# ── Kannada Translation Enrichment (Groq Llama-3.1-70B) ───────────────────

class TranslateRequest(BaseModel):
    strings: list[str]  # up to 25 English UI strings per request
    system_hint: str = ""  # optional context hint for better translations


class TranslateResponse(BaseModel):
    translations: dict[str, str]  # EN string → Kannada translation


TRANSLATE_SYSTEM = """You are a professional translator for a Karnataka State Police software system.
Translate each English UI string to formal Kannada (ಕನ್ನಡ) used in official government documents.

STRICT RULES:
1. Keep these EXACTLY in English (do NOT translate): FIR, IPC, GPS, CCTV, API, PDF, SQL, AI, ML, UI, KSP, BGE, RTX, SHA, URL, SSO, OIDC, TOTP, MFA, OTP
2. Keep proper nouns in English: Bengaluru, Karnataka, Mysuru, Mangaluru, KSP, Satyam, Groq, Gemini, Sarvam, Bhashini
3. Keep technical identifiers in English: L1, L2, L3, L4, SP, DGP, IGP, DIG, DySP, CI, PI, PSI, SI, ASI, HC, PC
4. Use formal/official Kannada — not colloquial
5. Return ONLY valid JSON — no markdown, no explanation
6. Format: {"english string": "ಕನ್ನಡ ಅನುವಾದ", ...}"""


@router.post("/translate", response_model=TranslateResponse)
async def translate_to_kannada(
    req: TranslateRequest,
    principal: Principal = Depends(get_principal),
) -> TranslateResponse:
    """Translate up to 20 English UI strings to Kannada using Groq Llama-3.1-70B.

    Called from Settings → Translation panel. Runs once per device — the
    frontend caches results in localStorage so no repeated API calls.
    """
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    if not req.strings:
        return TranslateResponse(translations={})

    # Cap at 25 strings per request to avoid token limits
    strings = req.strings[:25]

    from app.config import get_settings
    import httpx
    import json as _json

    s = get_settings()
    groq_key = s.groq_api_key
    if not groq_key:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY not configured on the server. Add it to .env and restart.",
        )

    # Build prompt: list the strings numbered
    lines = "\n".join(f'{i+1}. {s_}' for i, s_ in enumerate(strings))
    user_prompt = (
        f"Translate these {len(strings)} Kannada UI strings. "
        f"{req.system_hint + chr(10) if req.system_hint else ''}"
        f"Return ONLY JSON with each original English string as key:\n\n{lines}"
    )

    body = {
        "model": s.groq_model or "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": TRANSLATE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 2048,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            r.raise_for_status()
        data = r.json()
        raw = data["choices"][0]["message"]["content"]
        # Strip markdown fences if the model wraps JSON in ```json ... ```
        stripped = raw.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        translations: dict[str, str] = _json.loads(stripped)
        # Validate: only return strings that actually differ from the English input
        clean = {k: v for k, v in translations.items() if isinstance(v, str) and v.strip() and v != k}
        return TranslateResponse(translations=clean)
    except _json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Groq returned invalid JSON: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Groq API error {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Translation failed: {e}")


# ── Synthetic data values translation ─────────────────────────────────────

class DataValuesResponse(BaseModel):
    station_names: list[str]
    districts: list[str]
    crime_types: list[str]
    statuses: list[str]


@router.get("/data-values", response_model=DataValuesResponse)
async def get_data_values(
    session=Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> DataValuesResponse:
    """Return unique data values from the DB for LLM translation."""
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    from sqlalchemy import text as sql_text
    from app.db.session import AsyncSession as _AS

    async def query(q: str) -> list[str]:
        try:
            result = await session.execute(sql_text(q))
            return [str(r[0]) for r in result.fetchall() if r[0]]
        except Exception:
            return []

    stations = await query(
        "SELECT DISTINCT station_name FROM stations ORDER BY station_name LIMIT 200"
    )
    districts = await query(
        "SELECT DISTINCT district FROM cases WHERE district IS NOT NULL ORDER BY district LIMIT 60"
    )
    crime_types = await query(
        "SELECT DISTINCT crime_type FROM cases WHERE crime_type IS NOT NULL ORDER BY crime_type LIMIT 100"
    )
    statuses = await query(
        "SELECT DISTINCT status FROM cases WHERE status IS NOT NULL ORDER BY status LIMIT 30"
    )

    return DataValuesResponse(
        station_names=stations,
        districts=districts,
        crime_types=crime_types,
        statuses=statuses,
    )
