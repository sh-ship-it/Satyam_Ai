"""Sarvam AI clients — PRIMARY voice layer (Kannada + English STT/TTS/MT).

Services used:
  - Saaras v3 (STT)        → POST /speech-to-text   (multipart/form-data!)
  - Bulbul v2 (TTS)        → POST /text-to-speech    (JSON)
  - Mayura v1 (Translate)  → POST /translate         (JSON)

If SARVAM_API_KEY is unset the client runs in demo mode (deterministic stubs);
TTS demo returns b"" so the route 502s and the frontend uses its browser fallback.

VALID speaker/model pairs (speakers are NOT interchangeable across versions):
  - bulbul:v2  → DEPRECATED as of 2026-08-29. API returns HTTP 400.
  - bulbul:v3  → aditya, ritu, ashutosh, priya, neha, rahul, pooja, rohan, simran,
                 kavya, amit, dev, ishita, shreya, ratan, varun, manan, sumit, roopa,
                 kabir, aayan, shubh, advait, anand, tanya, tarun, sunny, mani, gokul,
                 vijay, shruti, suhani, mohit, kavitha, rehan, soham, rupali, niharika
We use bulbul:v3 + priya (female, supports kn-IN & en-IN, verified 2026-08-29).
v3 caps a single input at ~500 chars, so we trim on a sentence boundary.
"""
from __future__ import annotations

import base64
import logging

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import get_settings

log = logging.getLogger(__name__)


def _is_transient(exc: BaseException) -> bool:
    """Retry only a connection fault. Never an HTTP status, never a timeout.

    4xx was always excluded: an invalid speaker/model pair (anushka with bulbul:v3)
    is a permanent configuration error and retrying only delays the real message.
    """
    # Neither a TIMEOUT nor a 500 is retried any more.
    #
    # The retry was added when a 500 came back in under a second, which made a
    # second attempt nearly free. Re-measured during a Sarvam degradation: a 500
    # now takes ~30 s to arrive, so retrying it doubles a 30 s wait into 60 s of
    # dead air. Same reasoning as the timeout case — the budget is already spent by
    # the time the error appears.
    #
    # What replaced the retry is the cache in app/core/tts_cache.py: a phrase that
    # has been spoken once never needs the provider again, which protects repeats
    # far better than re-asking a provider that is currently failing. Only a
    # genuine connection fault (fails immediately, no wait spent) is still retried.
    if isinstance(exc, httpx.TimeoutException):
        return False
    if getattr(exc, "response", None) is not None:
        return False
    return isinstance(exc, httpx.TransportError)

_BASE = "https://api.sarvam.ai"
_TTS_MAX_CHARS = 480  # safety margin under Bulbul v2's ~500-char per-input limit


def _bcp(lang: str) -> str:
    return "kn-IN" if str(lang or "").lower().startswith("kn") else "en-IN"


def _trim_for_tts(text: str, limit: int = _TTS_MAX_CHARS) -> str:
    """Trim to <= limit chars, preferring the last sentence boundary."""
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    head = t[:limit]
    cut = max(
        head.rfind(". "),
        head.rfind("? "),
        head.rfind("! "),
        head.rfind("\u0964"),  # Devanagari/Kannada danda
    )
    return (head[: cut + 1] if cut > 80 else head).strip()


class _SarvamBase:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.sarvam_api_key
        self._demo = not self._key

    def _auth(self) -> dict[str, str]:
        # ONLY the subscription key header. Do NOT set Content-Type here:
        #  - httpx sets application/json automatically for `json=`
        #  - httpx sets the multipart boundary automatically for `files=`
        return {"api-subscription-key": self._key}


class SarvamSTT(_SarvamBase):
    """Saaras v3 speech-to-text. /speech-to-text is multipart/form-data.

    Sends language_code="unknown" to enable Saaras v3 auto-detection.
    Returns (transcript, detected_lang) where detected_lang is the BCP-47
    code returned by the API (e.g. "kn-IN", "en-IN").
    """

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        """Kept for Protocol compatibility — use transcribe_with_lang for auto-detect."""
        transcript, _ = await self.transcribe_with_lang(audio, lang=lang)
        return transcript

    async def transcribe_with_lang(
        self, audio: bytes, *, lang: str = "auto"
    ) -> tuple[str, str | None]:
        """Transcribe and return (transcript, detected_lang_bcp47).

        lang="auto" or lang="unknown" → Saaras v3 auto-detects the language.
        """
        if self._demo:
            return "[demo:sarvam-stt] ಕನ್ನಡ ಪ್ರಶ್ನೆ", "kn-IN"
        # Use "unknown" to let Saaras v3 auto-detect the spoken language.
        lang_code = "unknown" if lang in ("auto", "unknown") else _bcp(lang)
        # Sniff the container from magic bytes to set the right MIME type.
        # Saaras v3 accepts webm/opus (MediaRecorder default) and WAV.
        mime = "audio/wav"
        if len(audio) >= 4:
            if audio[:4] in (b"\x1a\x45\xdf\xa3",) or audio[:4] == b"webm":
                mime = "audio/webm"
            elif audio[:4] == b"OggS":
                mime = "audio/ogg"
        filename = (
            "audio.webm" if "webm" in mime else
            "audio.ogg"  if "ogg"  in mime else
            "audio.wav"
        )
        files = {"file": (filename, audio, mime)}
        data = {"model": "saaras:v3", "language_code": lang_code}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/speech-to-text",
                headers=self._auth(),   # NO Content-Type → multipart boundary preserved
                files=files,
                data=data,
            )
            r.raise_for_status()
        body = r.json() or {}
        transcript = body.get("transcript", "")
        # Saaras v3 returns the detected language_code in the response.
        detected = body.get("language_code") or body.get("detected_language_code") or None
        return transcript, detected


class SarvamTTS(_SarvamBase):
    """Bulbul v2 text-to-speech for Kannada and English. Returns WAV bytes."""

    mime = "audio/wav"

    # Two attempts, not three, and a 12 s per-attempt timeout below rather than 30 s.
    # MEASURED: a persistently failing Kannada call cost 93.4 s of wall clock under
    # 3 x 30 s, and the officer is waiting in silence for every one of those
    # seconds. A retry is worth having for the intermittent 500, but the budget has
    # to stay inside what a person will tolerate before giving up — worst case is
    # now ~25 s, and the frontend's browser-voice fallback covers the rest.
    @retry(
        retry=retry_if_exception(_is_transient),
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=0.3, min=0.3, max=1),
        reraise=True,
    )
    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if self._demo:
            return b""  # no key → 502 → frontend browser fallback
        spoken = _trim_for_tts(text)
        if not spoken:
            return b""
        # 25 s on a SINGLE attempt. A healthy call is ~2.8 s, but Sarvam stalls past
        # 12 s often enough that a 12 s ceiling was handing turns to the browser
        # voice that would have succeeded. Because timeouts are no longer retried
        # (see _is_transient), one 25 s wait costs less worst-case wall clock than
        # the previous 2 x 12 s did, and succeeds far more often — strictly better
        # on both axes. Long answers are the slow case, which is why _trim_for_tts
        # caps the input at 480 chars.
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(
                f"{_BASE}/text-to-speech",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "inputs": [spoken],
                    "target_language_code": _bcp(lang),
                    "speaker": "priya",         # valid bulbul:v3 female voice (kn-IN + en-IN)
                    "model": "bulbul:v3",       # bulbul:v2 was deprecated 2026-08-29 (HTTP 400)
                    "speech_sample_rate": 22050,
                    # MUST stay False. With preprocessing ON, en-IN answered
                    # HTTP 500 "error preprocessing input text" after ~30s on
                    # EVERY English request, deterministically — measured
                    # 30.3s/500 with it on against 0.4s/49,196 bytes with it off,
                    # same key, same text, same speaker. kn-IN works either way.
                    #
                    # This is what made English voice feedback look like random
                    # provider flakiness for so long: the failure was total for one
                    # language and absent for the other, and the 30s stall before
                    # the error read like a network problem rather than a rejected
                    # parameter. Sarvam's own message named the cause all along.
                    "enable_preprocessing": False,
                },
            )
            if r.status_code >= 400:
                # Log the provider's own message before raising. Without it the
                # route reports a bare "TTS provider error:" and the actual cause
                # (bad speaker/model pair, transient preprocessing failure) is lost.
                log.warning(
                    "sarvam.tts_failed status=%s lang=%s body=%s",
                    r.status_code, _bcp(lang), (r.text or "")[:300],
                )
            r.raise_for_status()
        audio_b64 = (r.json() or {}).get("audios", [""])[0]
        if not audio_b64:
            log.warning("sarvam.tts_empty lang=%s chars=%d", _bcp(lang), len(spoken))
        return base64.b64decode(audio_b64) if audio_b64 else b""


class SarvamTranslator(_SarvamBase):
    """Mayura v1 — neural MT between Kannada and English."""

    async def translate(self, text: str, *, src: str, tgt: str) -> str:
        if self._demo:
            return f"[demo:sarvam-mt {src}->{tgt}] {text}"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{_BASE}/translate",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "input": text,
                    "source_language_code": _bcp(src),
                    "target_language_code": _bcp(tgt),
                    "speaker_gender": "Female",
                    "mode": "formal",
                    "model": "mayura:v1",
                    "enable_preprocessing": False,
                },
            )
            r.raise_for_status()
        return (r.json() or {}).get("translated_text", text)
