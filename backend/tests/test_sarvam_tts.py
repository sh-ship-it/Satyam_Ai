"""Sarvam TTS retry policy.

WHY THIS EXISTS
Sarvam intermittently answers HTTP 500 `error preprocessing input text` for a
request that succeeds unchanged on the next attempt. That single blip used to
travel: adapter raises -> /voice/tts returns 502 -> the frontend catches it and
speaks with the BROWSER voice instead, with no visible signal. The officer hears a
different voice and reasonably concludes the Sarvam key is misconfigured, when the
key is fine and the call just needed retrying.

The 4xx case is the other half of the guard. An invalid speaker/model pair (Sarvam
rejects `anushka` with `bulbul:v3`) is permanent, and retrying it three times only
delays the message that actually explains the problem.
"""
from __future__ import annotations

import httpx
import pytest

from app.models.api import sarvam as S


def resp(status: int, body: str = "", json_body: dict | None = None) -> httpx.Response:
    req = httpx.Request("POST", "https://api.sarvam.ai/text-to-speech")
    if json_body is not None:
        return httpx.Response(status, json=json_body, request=req)
    return httpx.Response(status, text=body, request=req)


class FakeClient:
    """Replays a scripted list of responses, one per POST."""

    def __init__(self, script: list[httpx.Response]):
        self.script = list(script)
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **k):
        self.calls += 1
        return self.script.pop(0) if self.script else resp(500, "exhausted")


@pytest.fixture
def tts(monkeypatch):
    """A live (non-demo) adapter, and no real backoff sleeping."""
    monkeypatch.setattr(
        S, "get_settings", lambda: type("S", (), {"sarvam_api_key": "sk_test"})()
    )
    t = S.SarvamTTS()
    assert t._demo is False
    # The wait policy is baked into the decorator at import time; the AsyncRetrying
    # object on the wrapped function is the live one.
    monkeypatch.setattr(S.SarvamTTS.synthesize.retry, "sleep", _no_sleep)
    return t


async def _no_sleep(_seconds):
    return None


def install(monkeypatch, script: list[httpx.Response]) -> FakeClient:
    client = FakeClient(script)
    monkeypatch.setattr(S.httpx, "AsyncClient", lambda **k: client)
    return client


AUDIO = {"audios": ["QUJD"]}  # base64 for b"ABC"


# ── classification ───────────────────────────────────────────────────────────

def test_a_500_is_transient_and_a_400_is_not():
    assert S._is_transient(httpx.HTTPStatusError("x", request=None, response=resp(500))) is True
    assert S._is_transient(httpx.HTTPStatusError("x", request=None, response=resp(503))) is True
    # Permanent config error: anushka is not a valid bulbul:v3 speaker.
    assert S._is_transient(httpx.HTTPStatusError("x", request=None, response=resp(400))) is False
    assert S._is_transient(httpx.HTTPStatusError("x", request=None, response=resp(401))) is False


def test_connect_faults_retry_but_timeouts_do_not():
    """A 500 returns in under a second, so retrying it is nearly free. A timeout has
    already spent the whole budget waiting, and retrying doubles it — measured at
    26.5 s of silence for two timed-out attempts against ~2.8 s for a healthy call.
    Failing fast to the browser-voice fallback beats making the officer wait."""
    assert S._is_transient(httpx.ConnectError("dns")) is True
    assert S._is_transient(httpx.ReadTimeout("slow")) is False
    assert S._is_transient(httpx.ConnectTimeout("slow")) is False
    assert S._is_transient(ValueError("not http")) is False


# ── the behaviour that matters ───────────────────────────────────────────────

async def test_an_intermittent_500_is_retried_and_then_succeeds(monkeypatch, tts):
    """This is the exact failure that made Sarvam sound like the browser voice."""
    client = install(
        monkeypatch,
        [
            resp(500, '{"error":{"message":"error preprocessing input text"}}'),
            resp(200, json_body=AUDIO),
        ],
    )
    out = await tts.synthesize("Hello officer.", lang="en")
    assert out == b"ABC", "a retryable blip must still produce audio"
    assert client.calls == 2


async def test_a_400_is_not_retried(monkeypatch, tts):
    client = install(
        monkeypatch,
        [resp(400, '{"error":{"message":"Speaker \'anushka\' is not compatible with bulbul:v3"}}')],
    )
    with pytest.raises(httpx.HTTPStatusError):
        await tts.synthesize("Hello officer.", lang="en")
    assert client.calls == 1, "a permanent config error must not be retried"


async def test_retries_are_bounded_tightly_because_a_person_is_waiting(monkeypatch, tts):
    """Two attempts, not three. A persistently failing Kannada call was measured at
    93.4 s of wall clock under 3 attempts x a 30 s timeout, and the officer hears
    silence for every one of those seconds. The retry budget has to fit inside human
    patience — the frontend's browser-voice fallback covers what is left."""
    client = install(monkeypatch, [resp(500), resp(500), resp(500), resp(500)])
    with pytest.raises(httpx.HTTPStatusError):
        await tts.synthesize("Hello officer.", lang="en")
    assert client.calls == 2, "two attempts total, not an unbounded or slow loop"


async def test_empty_audio_is_returned_as_empty_not_crashed(monkeypatch, tts):
    """The route turns b"" into a 502 so the frontend can degrade deliberately."""
    install(monkeypatch, [resp(200, json_body={"audios": [""]})])
    assert await tts.synthesize("Hello officer.", lang="en") == b""


async def test_demo_mode_returns_empty_without_calling_out(monkeypatch):
    monkeypatch.setattr(S, "get_settings", lambda: type("S", (), {"sarvam_api_key": ""})())
    t = S.SarvamTTS()
    called = {"n": 0}

    class Boom:
        async def __aenter__(self):
            called["n"] += 1
            return self

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(S.httpx, "AsyncClient", lambda **k: Boom())
    assert await t.synthesize("hi", lang="en") == b""
    assert called["n"] == 0


# ── request shape ────────────────────────────────────────────────────────────

async def test_the_speaker_and_model_pair_stays_valid(monkeypatch, tts):
    """anushka is a bulbul:v2 voice. Pairing it with v3 is a hard 400, so the two
    values have to move together — pinning them here is what catches a lone edit."""
    sent: dict = {}

    class Capture(FakeClient):
        async def post(self, *a, **k):
            sent.update(k.get("json") or {})
            return await super().post(*a, **k)

    client = Capture([resp(200, json_body=AUDIO)])
    monkeypatch.setattr(S.httpx, "AsyncClient", lambda **k: client)
    await tts.synthesize("Hello officer.", lang="en")
    assert sent["model"] == "bulbul:v2"
    assert sent["speaker"] == "anushka"
    assert sent["target_language_code"] == "en-IN"


@pytest.mark.parametrize("lang,expected", [("kn", "kn-IN"), ("en", "en-IN"), ("KN", "kn-IN")])
def test_language_maps_to_bcp47(lang, expected):
    assert S._bcp(lang) == expected


def test_long_text_is_trimmed_on_a_sentence_boundary():
    """bulbul:v2 caps a single input near 500 chars; an over-long input is a 400."""
    text = ("This is a sentence. " * 60).strip()
    out = S._trim_for_tts(text)
    assert len(out) <= S._TTS_MAX_CHARS
    assert out.endswith("."), "should cut at a sentence end, not mid-word"
