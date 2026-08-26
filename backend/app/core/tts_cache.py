"""Content-addressed cache for synthesized speech.

WHY THIS EXISTS
Sarvam's text-to-speech endpoint is intermittently unreliable on this project's
key: the SAME request, unchanged, answers 200 in ~2.8 s on one attempt and 500
`error preprocessing input text` or a timeout on the next. Every miss meant the
frontend substituted the browser voice, so the officer heard a different voice for
reasons that had nothing to do with what they asked.

A cache fixes the class of problem rather than the instance:

  * A repeated question costs 0 ms instead of ~2.8 s, and TTS was the last
    remaining fixed cost in the voice path once the brain cascade was reordered.
  * A cached clip is IMMUNE to provider flakiness. Demo answers repeat constantly
    — the same greeting, the same hotspot summary — so the second time a line is
    spoken it can no longer fail at all.
  * It removes load from a quota'd provider.

KEYED ON (provider, lang, text)
All three change the audio, so all three are in the key. `provider` matters
because Sarvam returns WAV and Google returns MP3 — sharing a key across them
would hand the browser an `audio/wav` blob containing MP3 bytes. The text is
hashed rather than stored raw: keys stay a fixed length regardless of answer
size, and the officer's question never sits in a Redis key where it would show up
in `KEYS` output or a slow-log.

WHAT IS DELIBERATELY NOT CACHED
Empty audio, and failures. Only a successful non-empty synthesis is stored, so a
transient provider error is never remembered as "this text has no audio" — that
would turn one bad minute into a permanently silent phrase.

Storage mirrors `ConversationStore` in app/pipeline/slots.py: Redis when
reachable, a bounded process-local dict otherwise, so tests and offline demos work
with no Redis running.
"""
from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict

from app.config import get_settings

log = logging.getLogger(__name__)

# 7 days. Audio for a given string never changes, so the TTL exists only to stop
# unbounded growth, not for correctness.
_TTL_SECONDS = 7 * 24 * 3600

# Cap on the in-process fallback. A WAV clip for ~460 chars of speech is roughly
# 1 MB, so 64 entries is on the order of 64 MB — enough to cover a demo script
# many times over without letting a long session grow without limit.
#
# ponytail: strict LRU over an OrderedDict, single-process only. Deliberate — the
# Redis path is the real cache and this is the offline fallback. Upgrade path is
# to require Redis, which would make offline demos depend on a running service.
_MEMORY_MAX_ENTRIES = 64
_memory: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()

_redis = None
_redis_tried = False


def _client():
    """Lazy Redis handle. Built once; None forever after a failure to construct."""
    global _redis, _redis_tried
    if _redis_tried:
        return _redis
    _redis_tried = True
    try:
        import redis.asyncio as redis  # type: ignore

        _redis = redis.from_url(get_settings().redis_url, decode_responses=False)
    except Exception:  # noqa: BLE001
        _redis = None
    return _redis


def _disable_redis(exc: BaseException) -> None:
    """Drop to the in-process store permanently after the first Redis failure.

    `redis.from_url()` does NOT connect, it only builds a client, so a Redis that
    is simply not running is discovered on the first command — and then again on
    every command after it. Measured: with Redis down, a cache lookup spent ~6 s
    on a connection attempt before falling through to the memory store, which made
    the cache SLOWER than no cache at all and defeated its whole purpose.

    One failure is enough to conclude Redis is unavailable for this process. It is
    an optional accelerator, so the right response is to stop asking.
    """
    global _redis
    if _redis is not None:
        log.warning("tts_cache.redis_unavailable using in-process store err=%s", exc)
        _redis = None


def cache_key(provider: str, lang: str, text: str) -> str:
    """Stable key for one (provider, lang, text) triple.

    sha256 of the text, not the text itself: fixed-length keys, and the officer's
    words never land in a Redis key name.
    """
    digest = hashlib.sha256((text or "").strip().encode("utf-8")).hexdigest()
    return f"tts:v1:{provider}:{lang}:{digest}"


async def get(provider: str, lang: str, text: str) -> tuple[bytes, str] | None:
    """Return `(audio_bytes, mime)` on a hit, else None."""
    key = cache_key(provider, lang, text)

    r = _client()
    if r is not None:
        try:
            # Two fields, so the mime type travels with the bytes. Reconstructing
            # it from the provider name at read time would silently mislabel any
            # clip cached before a provider changed formats.
            vals = await r.hmget(key, "audio", "mime")
            if vals and vals[0]:
                mime = (vals[1] or b"audio/wav").decode("ascii", "replace")
                return bytes(vals[0]), mime
        except Exception as exc:  # noqa: BLE001  (a cache must never break the request)
            _disable_redis(exc)

    hit = _memory.get(key)
    if hit is not None:
        _memory.move_to_end(key)  # LRU: a hit is a recent use
        return hit
    return None


async def put(provider: str, lang: str, text: str, audio: bytes, mime: str) -> None:
    """Store a SUCCESSFUL synthesis. Empty audio is ignored on purpose."""
    if not audio:
        return
    key = cache_key(provider, lang, text)

    r = _client()
    if r is not None:
        try:
            await r.hset(key, mapping={"audio": audio, "mime": mime.encode("ascii")})
            await r.expire(key, _TTL_SECONDS)
            return
        except Exception as exc:  # noqa: BLE001
            _disable_redis(exc)

    _memory[key] = (audio, mime)
    _memory.move_to_end(key)
    while len(_memory) > _MEMORY_MAX_ENTRIES:
        _memory.popitem(last=False)  # evict least-recently-used


def clear_memory() -> None:
    """Test hook — drops the in-process entries only."""
    _memory.clear()
