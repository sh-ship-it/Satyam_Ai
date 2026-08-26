"""Daily OpenAI budget and the brain failover cascade.

No network, no Redis. These properties all fail silently in production if broken:
a cap that can be overshot gets the key throttled for the day, a retried 429
spends a second unit proving a request that cannot succeed, and a cascade that
falls to the wrong engine still returns an answer so nothing looks wrong.

pyproject sets asyncio_mode = "auto", so async tests need no marker and a
module-level pytestmark would warn on every sync test here.
"""
from __future__ import annotations

import httpx
import pytest

from app.models import quota as quota_mod
from app.models.quota import DailyQuota, QuotaExhausted, is_quota_error


# ── helpers ──────────────────────────────────────────────────────────────────

def fresh_quota(monkeypatch, limit: int = 50, day: str = "2026-03-01") -> DailyQuota:
    """A DailyQuota with no Redis and a pinned UTC date."""
    monkeypatch.setattr(quota_mod, "_memory", {})
    monkeypatch.setattr(quota_mod, "_memory_exhausted", set())
    q = DailyQuota("openai")
    q._redis = None  # force the memory fallback
    monkeypatch.setattr(DailyQuota, "_today", staticmethod(lambda: day))
    monkeypatch.setattr(
        quota_mod, "get_settings", lambda: type("S", (), {"openai_daily_limit": limit})()
    )
    return q


def http_error(status: int, body: str) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    resp = httpx.Response(status, text=body, request=req)
    return httpx.HTTPStatusError("boom", request=req, response=resp)


class FakeLLM:
    """Records calls and returns a scripted answer, or raises."""

    def __init__(self, answer="ok", raises=None):
        self.answer = answer
        self.raises = raises
        self.calls = 0

    async def complete(self, prompt, *, system=None, temperature=0.0, json_schema=None):
        self.calls += 1
        if self.raises:
            raise self.raises
        return self.answer


# ── the counter ──────────────────────────────────────────────────────────────

async def test_reserve_allows_exactly_the_limit_then_refuses(monkeypatch):
    q = fresh_quota(monkeypatch, limit=50)
    for i in range(50):
        assert await q.try_reserve() is True, f"call {i + 1} should be inside the budget"
    assert await q.try_reserve() is False, "the 51st call must be refused"


async def test_remaining_counts_down_and_floors_at_zero(monkeypatch):
    q = fresh_quota(monkeypatch, limit=3)
    assert await q.remaining() == 3
    await q.try_reserve()
    assert await q.remaining() == 2
    for _ in range(10):
        await q.try_reserve()
    assert await q.remaining() == 0, "remaining must never go negative"


async def test_mark_exhausted_blocks_further_reserves_same_day(monkeypatch):
    q = fresh_quota(monkeypatch, limit=50)
    assert await q.try_reserve() is True
    await q.mark_exhausted()
    assert await q.try_reserve() is False, "a provider 429 must stop further attempts"
    assert await q.remaining() == 0


async def test_a_new_utc_date_resets_the_counter(monkeypatch):
    q = fresh_quota(monkeypatch, limit=2, day="2026-03-01")
    assert await q.try_reserve() is True
    assert await q.try_reserve() is True
    assert await q.try_reserve() is False

    # Same object, next UTC day.
    monkeypatch.setattr(DailyQuota, "_today", staticmethod(lambda: "2026-03-02"))
    assert await q.try_reserve() is True, "the budget must reset on the new UTC date"
    assert await q.remaining() == 1


async def test_exhausted_flag_is_per_day_not_forever(monkeypatch):
    q = fresh_quota(monkeypatch, limit=5, day="2026-03-01")
    await q.mark_exhausted()
    assert await q.try_reserve() is False
    monkeypatch.setattr(DailyQuota, "_today", staticmethod(lambda: "2026-03-02"))
    assert await q.try_reserve() is True, "yesterday's 429 must not block today"


async def test_zero_limit_refuses_everything(monkeypatch):
    q = fresh_quota(monkeypatch, limit=0)
    assert await q.try_reserve() is False


async def test_memory_fallback_works_with_no_redis(monkeypatch):
    q = fresh_quota(monkeypatch, limit=2)
    assert q._redis is None
    assert await q.try_reserve() is True
    assert await q.used() == 1


# ── error classification ─────────────────────────────────────────────────────

def test_is_quota_error_true_for_429_and_insufficient_quota():
    assert is_quota_error(http_error(429, "slow down")) is True
    assert is_quota_error(http_error(400, '{"error":{"code":"insufficient_quota"}}')) is True
    assert is_quota_error(http_error(429, '{"error":{"code":"rate_limit_exceeded"}}')) is True
    assert is_quota_error(QuotaExhausted("spent")) is True


def test_is_quota_error_false_for_a_server_fault():
    assert is_quota_error(http_error(500, "internal error")) is False
    assert is_quota_error(httpx.ConnectError("dns")) is False
    assert is_quota_error(ValueError("bad json")) is False


# ── retry behaviour ──────────────────────────────────────────────────────────

async def test_a_429_is_not_retried(monkeypatch):
    """The old stop_after_attempt(2) retried every exception, so a 429 for
    insufficient_quota spent a second reserved unit proving the obvious."""
    from app.models.api.openai_llm import OpenAILLM

    fresh_quota(monkeypatch, limit=50)
    monkeypatch.setattr(
        quota_mod.openai_quota, "try_reserve", lambda: _true()
    )
    monkeypatch.setattr(quota_mod.openai_quota, "mark_exhausted", lambda: _none())

    llm = OpenAILLM()
    llm._demo = False
    llm._key = "sk-test"
    attempts = {"n": 0}

    class Boom:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            attempts["n"] += 1
            raise http_error(429, '{"error":{"code":"insufficient_quota"}}')

    monkeypatch.setattr("app.models.api.openai_llm.httpx.AsyncClient", lambda **k: Boom())

    with pytest.raises(httpx.HTTPStatusError):
        await llm.complete("hi")
    assert attempts["n"] == 1, f"a quota error must not be retried, saw {attempts['n']} attempts"


async def test_a_transport_fault_is_still_retried(monkeypatch):
    from app.models.api.openai_llm import OpenAILLM

    fresh_quota(monkeypatch, limit=50)
    monkeypatch.setattr(quota_mod.openai_quota, "try_reserve", lambda: _true())

    llm = OpenAILLM()
    llm._demo = False
    llm._key = "sk-test"
    attempts = {"n": 0}

    class Flaky:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            attempts["n"] += 1
            raise httpx.ConnectError("dns")

    monkeypatch.setattr("app.models.api.openai_llm.httpx.AsyncClient", lambda **k: Flaky())
    # Skip tenacity's real backoff. The wait policy is baked into the decorator at
    # import time, so patching `wait_exponential` in the module would be too late;
    # the AsyncRetrying object hanging off the wrapped function is the live one.
    monkeypatch.setattr(OpenAILLM.complete.retry, "sleep", lambda _s: _none())

    with pytest.raises(httpx.ConnectError):
        await llm.complete("hi")
    assert attempts["n"] == 2, "a transient fault should get its one retry"


async def test_adapter_refuses_before_spending_when_budget_is_gone(monkeypatch):
    """The cap has to be enforced in the adapter, because board_brain and
    screen_agent both reach the brain through get_llm and know nothing about it."""
    from app.models.api.openai_llm import OpenAILLM

    fresh_quota(monkeypatch, limit=50)
    monkeypatch.setattr(quota_mod.openai_quota, "try_reserve", lambda: _false())

    llm = OpenAILLM()
    llm._demo = False
    llm._key = "sk-test"

    called = {"n": 0}

    class ShouldNotRun:
        async def __aenter__(self):
            called["n"] += 1
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            called["n"] += 1

    monkeypatch.setattr(
        "app.models.api.openai_llm.httpx.AsyncClient", lambda **k: ShouldNotRun()
    )

    with pytest.raises(QuotaExhausted):
        await llm.complete("hi")
    assert called["n"] == 0, "no HTTP request may be made once the budget is spent"


# ── the cascade ──────────────────────────────────────────────────────────────

def _install(monkeypatch, lanes: dict):
    """Point registry.get_llm at scripted fakes and pin brain_engine=openai."""
    from app.models import registry

    monkeypatch.setattr(registry, "get_llm", lambda name=None: lanes[name])
    monkeypatch.setattr(
        registry,
        "get_settings",
        lambda: type("S", (), {"model_backend": "api", "brain_engine": "openai"})(),
    )
    return registry


async def test_cascade_falls_to_gemini_when_openai_is_exhausted(monkeypatch):
    """Gemini is the user's explicitly requested failover target — NOT Groq."""
    from app.models import registry

    lanes = {
        "openai": FakeLLM("from openai"),
        "gemini": FakeLLM("from gemini"),
        "groq": FakeLLM("from groq"),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(registry, "get_classifier_llm", lambda: lanes["groq"])
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _zero())

    text, used = await registry.complete_with_brain("q")

    assert used == "gemini", f"exhausted OpenAI must fail over to Gemini, got {used}"
    assert text == "from gemini"
    assert lanes["openai"].calls == 0, "OpenAI must not be called with no budget"
    assert lanes["groq"].calls == 0, "Groq is the last lane, not the second"


async def test_cascade_uses_openai_when_budget_remains(monkeypatch):
    from app.models import registry

    lanes = {
        "openai": FakeLLM("from openai"),
        "gemini": FakeLLM("from gemini"),
        "groq": FakeLLM("from groq"),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _int(7))

    text, used = await registry.complete_with_brain("q")
    assert (text, used) == ("from openai", "openai")
    assert lanes["gemini"].calls == 0


async def test_a_429_at_call_time_still_falls_to_gemini(monkeypatch):
    from app.models import registry

    lanes = {
        "openai": FakeLLM(raises=http_error(429, "insufficient_quota")),
        "gemini": FakeLLM("from gemini"),
        "groq": FakeLLM("from groq"),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _int(9))

    text, used = await registry.complete_with_brain("q")
    assert used == "gemini"
    assert lanes["openai"].calls == 1


async def test_groq_is_the_final_lane_when_gemini_also_fails(monkeypatch):
    from app.models import registry

    lanes = {
        "openai": FakeLLM(raises=http_error(429, "insufficient_quota")),
        "gemini": FakeLLM(raises=httpx.ConnectError("down")),
        "groq": FakeLLM("from groq"),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _int(9))

    text, used = await registry.complete_with_brain("q")
    assert (text, used) == ("from groq", "groq")


async def test_a_demo_echo_falls_through_instead_of_being_answered(monkeypatch):
    """A `[demo:` reply means the key is missing. Returning it would ship a
    placeholder to an officer as though it were a grounded answer."""
    from app.models import registry

    lanes = {
        "openai": FakeLLM("[demo:openai] hello"),
        "gemini": FakeLLM("real answer"),
        "groq": FakeLLM("from groq"),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _int(9))

    text, used = await registry.complete_with_brain("q")
    assert (text, used) == ("real answer", "gemini")


async def test_all_lanes_failing_raises_so_the_caller_can_degrade(monkeypatch):
    from app.models import registry

    boom = httpx.ConnectError("down")
    lanes = {
        "openai": FakeLLM(raises=boom),
        "gemini": FakeLLM(raises=boom),
        "groq": FakeLLM(raises=boom),
    }
    _install(monkeypatch, lanes)
    monkeypatch.setattr(quota_mod.openai_quota, "remaining", lambda: _int(9))

    with pytest.raises(RuntimeError):
        await registry.complete_with_brain("q")


async def test_classifier_lane_is_never_openai(monkeypatch):
    """Routing and screen planning must not spend the answer budget."""
    from app.models import registry

    registry.get_classifier_llm.cache_clear()
    monkeypatch.setattr(
        registry,
        "get_settings",
        lambda: type("S", (), {"groq_api_key": "gsk_x"})(),
    )
    assert type(registry.get_classifier_llm()).__name__ == "GroqLLM"
    registry.get_classifier_llm.cache_clear()


# ── tiny awaitables, so monkeypatched async methods stay one-liners ──────────

async def _true():
    return True


async def _false():
    return False


async def _none():
    return None


async def _zero():
    return 0


def _int(n):
    async def _v():
        return n

    return _v()
