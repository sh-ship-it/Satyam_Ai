"""Voice pipeline endpoints: TTS / STT / MT.

Provider-agnostic: delegates to the model registry, which resolves
VOICE_BACKEND (sarvam -> google -> bhashini -> local) or an explicit
per-request override.

Guarded by the CHAT permission (clearance >= 1) so any signed-in officer
can use it.
"""
from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.api.deps import get_principal, get_scoped_session
from app.config import get_settings
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.models.registry import get_stt, get_translator, get_tts
from app.pipeline import screen_agent
from app.schemas.voice import (
    AgentPlan,
    AgentRequest,
    STTResponse,
    TranslateRequest,
    TranslateResponse,
    TTSRequest,
    TTSResponse,
)

router = APIRouter()


def _norm_lang(lang: str | None) -> str:
    """Collapse any locale string to the two supported voice languages."""
    return "kn" if str(lang or "").lower().startswith("kn") else "en"


def _guard(principal: Principal) -> None:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/tts", response_model=TTSResponse)
async def tts(
    req: TTSRequest,
    principal: Principal = Depends(get_principal),
) -> TTSResponse:
    _guard(principal)
    lang = _norm_lang(req.lang)
    engine = get_tts(req.backend)  # None => env default (sarvam)
    try:
        audio = await engine.synthesize(req.text, lang=lang)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS provider error: {e}")
    if not audio:
        raise HTTPException(status_code=502, detail="TTS produced no audio")
    # GoogleTTS emits MP3; Sarvam/Bhashini/local emit WAV.
    mime = getattr(engine, "mime", None) or (
        "audio/mpeg" if req.backend == "google" else "audio/wav"
    )
    return TTSResponse(
        audio_base64=base64.b64encode(audio).decode("ascii"),
        mime=mime,
        provider=type(engine).__name__,
    )


@router.post("/stt", response_model=STTResponse)
async def stt(
    file: UploadFile = File(...),
    lang: str = Form("auto"),       # "auto" → Saaras v3 auto-detects the language
    backend: str | None = Form(None),
    principal: Principal = Depends(get_principal),
) -> STTResponse:
    _guard(principal)
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio upload")
    engine = get_stt(backend)  # type: ignore[arg-type]

    # Use auto-detect path when available (SarvamSTT), else fall back to the
    # standard `transcribe()` Protocol method.
    detected_lang: str | None = None
    try:
        if hasattr(engine, "transcribe_with_lang"):
            transcript, detected_lang = await engine.transcribe_with_lang(
                audio, lang=lang
            )
        else:
            transcript = await engine.transcribe(audio, lang=_norm_lang(lang))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT provider error: {e}")

    return STTResponse(
        transcript=transcript,
        detected_lang=detected_lang,
        provider=type(engine).__name__,
    )


@router.post("/translate", response_model=TranslateResponse)
async def translate(
    req: TranslateRequest,
    principal: Principal = Depends(get_principal),
) -> TranslateResponse:
    _guard(principal)
    s = get_settings()
    engine = get_translator()
    try:
        out = await engine.translate(
            req.text, src=_norm_lang(req.src), tgt=_norm_lang(req.tgt)
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"MT provider error: {e}")
    return TranslateResponse(text=out, provider=s.voice_backend)


@router.post("/agent", response_model=AgentPlan)
async def voice_agent(
    req: AgentRequest,
    principal: Principal = Depends(get_principal),
    session=Depends(get_scoped_session),
) -> AgentPlan:
    """Voice Screen Agent: turn a spoken command into a navigation + in-screen
    action plan. The frontend executes only allow-listed actions from the plan.

    Sample sentinels in the plan (e.g. "__SAMPLE_PERSON__" for "seed any person")
    are resolved here to REAL values from the officer's RLS-scoped database, so a
    field never receives a placeholder/instruction phrase as data.
    """
    _guard(principal)
    result = await screen_agent.plan(
        command=req.command,
        current_route=req.current_route,
        lang=_norm_lang(req.lang),
        brain_engine=req.brain_engine,
        planner=req.planner,
    )
    result["actions"] = await screen_agent.resolve_samples(result.get("actions", []), session)
    return AgentPlan(**result)
