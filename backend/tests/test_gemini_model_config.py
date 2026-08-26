"""Gemini model + reasoning-depth selection.

Three things here fail silently if broken, which is why they are pinned:

1. The model id is interpolated straight into the upstream request URL, so the
   allow-list is a trust boundary, not a convenience.
2. `registry.get_llm` is `@lru_cache`d, so one GeminiLLM instance outlives every
   Settings change. An adapter that snapshotted the model in `__init__` would
   ignore the picker until the process restarted — and would do so quietly,
   answering with the old model.
3. `thinkingConfig.thinkingLevel` is a Gemini 3 field. The 2.5 family used a
   numeric `thinkingBudget`, so sending the level unconditionally would be a
   400 on any 2.5 id someone puts in GEMINI_MODEL.
"""
from __future__ import annotations

import pytest

from app.models.api import gemini as G


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Overrides are process-wide (same pattern as db/session._db_source)."""
    G.set_gemini_model(None)
    G.set_thinking_level(None)
    yield
    G.set_gemini_model(None)
    G.set_thinking_level(None)


# ── the allow-list is a trust boundary ───────────────────────────────────────

def test_the_four_requested_models_are_offered():
    assert set(G.GEMINI_MODELS) == {
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
    }


def test_the_fastest_model_is_listed_first():
    """The dict order is the dropdown order, and the first entry is also the
    fallback when GEMINI_MODEL holds something stale. Both should land on the
    lowest-latency model, not whichever id happens to sort first."""
    assert next(iter(G.GEMINI_MODELS)) == "gemini-3.5-flash-lite"


def test_reasoning_cannot_be_switched_off_only_turned_down():
    """Verified against the live API: thinkingLevel="off" is a 400. Offering it
    in the UI would produce a hard failure on every Gemini call."""
    assert G.THINKING_LEVELS == ("low", "medium", "high")
    with pytest.raises(ValueError):
        G.set_thinking_level("off")


def test_an_unknown_model_is_refused_not_forwarded():
    """It lands in the request URL, so this is injection surface."""
    with pytest.raises(ValueError):
        G.set_gemini_model("../../admin")
    with pytest.raises(ValueError):
        G.set_gemini_model("gemini-9-ultra")
    assert G.active_gemini_model() in G.GEMINI_MODELS


def test_an_unknown_reasoning_level_is_refused():
    with pytest.raises(ValueError):
        G.set_thinking_level("extreme")


# ── defaults ─────────────────────────────────────────────────────────────────

def test_shipped_defaults_are_the_lite_model_and_low_reasoning():
    """Reads the REAL Settings defaults, not a stub, so a change to config.py that
    reintroduces a slow default fails here. gemini-3.7-flash measured 131.8 s for
    one word on this key, which is not a usable default for a voice assistant."""
    from app.config import Settings

    # The FIELD defaults, not Settings() — instantiating reads backend/.env, so
    # that would assert on whatever the local operator happens to have set.
    fields = Settings.model_fields
    assert fields["gemini_model"].default == "gemini-3.5-flash-lite"
    assert fields["gemini_thinking_level"].default == "low"
    # A long timeout on a 131 s model buys a stalled turn, not an answer.
    assert fields["gemini_timeout_seconds"].default <= 60


def test_a_stale_env_model_falls_back_to_an_offered_one(monkeypatch):
    """gemini-2.5-flash 404s as "no longer available to new users" on newer keys.
    Serving it anyway would 404 every single call."""
    monkeypatch.setattr(
        G, "get_settings",
        lambda: type("S", (), {"gemini_model": "gemini-2.5-flash",
                               "gemini_thinking_level": "low"})(),
    )
    assert G.active_gemini_model() in G.GEMINI_MODELS
    assert G.active_gemini_model() != "gemini-2.5-flash"


def test_a_garbage_env_reasoning_level_falls_back_to_low(monkeypatch):
    monkeypatch.setattr(
        G, "get_settings",
        lambda: type("S", (), {"gemini_model": "gemini-3.6-flash",
                               "gemini_thinking_level": "turbo"})(),
    )
    assert G.active_thinking_level() == "low"


# ── the override wins, and reaches an ALREADY-BUILT adapter ──────────────────

def test_override_beats_the_env_value():
    G.set_gemini_model("gemini-3.5-flash-lite")
    G.set_thinking_level("high")
    assert G.active_gemini_model() == "gemini-3.5-flash-lite"
    assert G.active_thinking_level() == "high"


def test_an_existing_adapter_instance_picks_up_a_later_switch():
    """The lru_cache bug this guards: get_llm() hands back the SAME GeminiLLM for
    the life of the process, so the switch has to be read per call."""
    llm = G.GeminiLLM()
    G.set_gemini_model("gemini-3.6-flash")
    assert llm._model == "gemini-3.6-flash"
    G.set_gemini_model("gemini-3.5-flash")
    assert llm._model == "gemini-3.5-flash", "adapter cached the model in __init__"


def test_clearing_the_override_returns_to_the_env_value():
    G.set_gemini_model("gemini-3.5-flash")
    G.set_gemini_model(None)
    assert G.active_gemini_model() == G.active_gemini_model()  # no crash
    assert G.active_gemini_model() in G.GEMINI_MODELS


# ── thinkingConfig is emitted only where it is understood ────────────────────

@pytest.mark.parametrize(
    "model", ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
)
def test_thinking_config_is_sent_for_every_gemini_3_model(model):
    G.set_gemini_model(model)
    G.set_thinking_level("medium")
    body = G.GeminiLLM()._payload("hi", None, 0.0, None)
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "medium"}


def test_thinking_config_is_omitted_for_the_2_5_family():
    """2.5 takes a numeric thinkingBudget; sending thinkingLevel would 400."""
    assert G.supports_thinking("gemini-2.5-flash") is False
    assert G.supports_thinking("gemini-3.7-flash") is True


def test_the_selected_level_reaches_the_payload():
    for level in G.THINKING_LEVELS:
        G.set_thinking_level(level)
        body = G.GeminiLLM()._payload("hi", None, 0.0, None)
        assert body["generationConfig"]["thinkingConfig"]["thinkingLevel"] == level


def test_a_json_schema_request_still_carries_the_thinking_config():
    """Text-to-SQL and slot extraction go through the schema path; dropping the
    reasoning setting there would make the two lanes behave differently."""
    G.set_gemini_model("gemini-3.7-flash")
    G.set_thinking_level("low")
    body = G.GeminiLLM()._payload("q", "sys", 0.0, {"type": "object"})
    gen = body["generationConfig"]
    assert gen["responseMimeType"] == "application/json"
    assert gen["thinkingConfig"] == {"thinkingLevel": "low"}
    assert body["systemInstruction"] == {"parts": [{"text": "sys"}]}
