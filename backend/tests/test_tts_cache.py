"""TTS cache.

WHY THIS EXISTS
Sarvam's TTS endpoint is intermittently unreliable on this project's key — the same
request answers 200 in ~2.8 s on one attempt and 500 `error preprocessing input
text` or a timeout on the next. Every miss dropped the officer to the browser voice,
so they heard a different voice for reasons unrelated to what they asked.

The cache is the fix for the class rather than the instance: a phrase that has been
spoken once can never fail again, and costs 0 ms the second time.

The two properties that would silently corrupt behaviour if broken:
  1. A FAILURE must never be cached. Remembering "this text has no audio" would turn
     one bad minute into a permanently silent phrase.
  2. The provider must be part of the key. Sarvam returns WAV and Google returns
     MP3; sharing a key would hand the browser an `audio/wav` blob of MP3 bytes.
"""
from __future__ import annotations

import pytest

from app.core import tts_cache


@pytest.fixture(autouse=True)
def _no_redis(monkeypatch):
    """Force the in-process fallback so these tests need no Redis."""
    monkeypatch.setattr(tts_cache, "_client", lambda: None)
    tts_cache.clear_memory()
    yield
    tts_cache.clear_memory()


# ── round trip ───────────────────────────────────────────────────────────────

async def test_a_miss_returns_none_and_a_hit_returns_the_exact_bytes():
    assert await tts_cache.get("SarvamTTS", "en", "Hello officer.") is None
    await tts_cache.put("SarvamTTS", "en", "Hello officer.", b"WAVDATA", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "Hello officer.") == (b"WAVDATA", "audio/wav")


async def test_the_mime_travels_with_the_bytes():
    """Reconstructing the mime from the provider at read time would mislabel any
    clip cached before a provider changed format."""
    await tts_cache.put("GoogleTTS", "en", "hi", b"MP3DATA", "audio/mpeg")
    assert await tts_cache.get("GoogleTTS", "en", "hi") == (b"MP3DATA", "audio/mpeg")


# ── key identity ─────────────────────────────────────────────────────────────

async def test_language_is_part_of_the_key():
    """Same words, different language, genuinely different audio."""
    await tts_cache.put("SarvamTTS", "en", "namaste", b"EN", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "kn", "namaste") is None


async def test_provider_is_part_of_the_key():
    """Sarvam returns WAV, Google MP3. A shared key would serve MP3 bytes as WAV."""
    await tts_cache.put("SarvamTTS", "en", "hi", b"WAV", "audio/wav")
    assert await tts_cache.get("GoogleTTS", "en", "hi") is None


async def test_different_text_does_not_collide():
    await tts_cache.put("SarvamTTS", "en", "first line", b"A", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "second line") is None


async def test_surrounding_whitespace_is_normalised():
    """The pipeline trims inconsistently; the same sentence should be one entry."""
    await tts_cache.put("SarvamTTS", "en", "Hello officer.", b"A", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "  Hello officer.  ") == (b"A", "audio/wav")


def test_the_key_hashes_the_text_rather_than_embedding_it():
    """The officer's question must not sit in a Redis key, where it would show up in
    KEYS output or a slow-log."""
    text = "Which districts have the lowest clearance rate?"
    key = tts_cache.cache_key("SarvamTTS", "en", text)
    assert "clearance" not in key
    assert key.startswith("tts:v1:SarvamTTS:en:")
    assert len(key.rsplit(":", 1)[1]) == 64  # sha256 hex


def test_the_key_is_stable_across_calls():
    a = tts_cache.cache_key("SarvamTTS", "kn", "ನಮಸ್ಕಾರ")
    b = tts_cache.cache_key("SarvamTTS", "kn", "ನಮಸ್ಕಾರ")
    assert a == b


def test_unicode_text_keys_without_crashing():
    kn = "ಕರ್ನಾಟಕದಲ್ಲಿ ಕಳವು ಪ್ರಕರಣಗಳು ಹೆಚ್ಚಾಗಿವೆ."
    assert tts_cache.cache_key("SarvamTTS", "kn", kn) != tts_cache.cache_key(
        "SarvamTTS", "kn", kn + "!"
    )


# ── failures are never remembered ────────────────────────────────────────────

async def test_empty_audio_is_not_cached():
    """A provider blip returning b"" must not become a permanent silent phrase."""
    await tts_cache.put("SarvamTTS", "en", "Hello officer.", b"", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "Hello officer.") is None


async def test_a_later_success_populates_after_an_earlier_failure():
    await tts_cache.put("SarvamTTS", "en", "retry me", b"", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "retry me") is None
    await tts_cache.put("SarvamTTS", "en", "retry me", b"GOOD", "audio/wav")
    assert await tts_cache.get("SarvamTTS", "en", "retry me") == (b"GOOD", "audio/wav")


# ── the fallback store stays bounded ─────────────────────────────────────────

async def test_the_memory_store_evicts_least_recently_used():
    cap = tts_cache._MEMORY_MAX_ENTRIES
    for i in range(cap):
        await tts_cache.put("SarvamTTS", "en", f"line {i}", f"A{i}".encode(), "audio/wav")
    # Touch the oldest so it is no longer the least-recently-used.
    assert await tts_cache.get("SarvamTTS", "en", "line 0") is not None
    # One past capacity evicts "line 1", not the just-touched "line 0".
    await tts_cache.put("SarvamTTS", "en", "overflow", b"NEW", "audio/wav")
    assert len(tts_cache._memory) <= cap
    assert await tts_cache.get("SarvamTTS", "en", "line 0") is not None
    assert await tts_cache.get("SarvamTTS", "en", "line 1") is None


# ── a broken cache must never break the request ──────────────────────────────

async def test_a_raising_redis_degrades_to_a_miss_instead_of_erroring(monkeypatch):
    """A cache is an optimisation. If it throws, the caller should synthesize as
    normal rather than fail the officer's turn."""

    class Exploding:
        async def hmget(self, *a, **k):
            raise RuntimeError("redis down")

        async def hset(self, *a, **k):
            raise RuntimeError("redis down")

        async def expire(self, *a, **k):
            raise RuntimeError("redis down")

    monkeypatch.setattr(tts_cache, "_client", lambda: Exploding())
    assert await tts_cache.get("SarvamTTS", "en", "hi") is None
    await tts_cache.put("SarvamTTS", "en", "hi", b"A", "audio/wav")  # must not raise


async def test_a_dead_redis_is_only_tried_once(monkeypatch):
    """`redis.from_url()` builds a client without connecting, so a Redis that is not
    running is discovered on the first command and then again on every command after
    it. Measured with Redis down: a lookup spent ~6 s on a connection attempt before
    falling through to memory, making the cache slower than no cache at all. One
    failure has to be enough to stop asking."""
    calls = {"n": 0}

    class Dead:
        async def hmget(self, *a, **k):
            calls["n"] += 1
            raise ConnectionError("refused")

        async def hset(self, *a, **k):
            calls["n"] += 1
            raise ConnectionError("refused")

        async def expire(self, *a, **k):
            raise ConnectionError("refused")

    monkeypatch.setattr(tts_cache, "_redis", Dead())
    monkeypatch.setattr(tts_cache, "_redis_tried", True)
    monkeypatch.setattr(tts_cache, "_client", lambda: tts_cache._redis)

    await tts_cache.get("SarvamTTS", "en", "hi")          # 1 failed command
    await tts_cache.put("SarvamTTS", "en", "hi", b"A", "audio/wav")
    await tts_cache.get("SarvamTTS", "en", "hi")
    await tts_cache.get("SarvamTTS", "en", "hi")
    assert calls["n"] == 1, f"Redis retried after a known failure ({calls['n']} commands)"
    # and the memory store still served the value
    assert await tts_cache.get("SarvamTTS", "en", "hi") == (b"A", "audio/wav")
