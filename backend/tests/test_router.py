"""Intent router tests.

The router had no tests, and the defect that mattered was not a wrong keyword
list: it was that `route()` caught bare Exception and silently returned the
keyword guess. When the Gemini key began answering 401 the primary lane failed on
every single request and emitted no log line, so a dead brain presented as bad
routing. These tests pin the lane ordering, the validation of the LLM's reply, and
the fact that a downgrade is always announced.
"""
from __future__ import annotations

import logging

import pytest

from app.pipeline import router as R


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeLLM:
    """Returns a scripted body, or raises, and records that it was called."""

    def __init__(self, reply=None, fail: Exception | None = None):
        self.reply = reply
        self.fail = fail
        self.calls = 0

    async def complete(self, message, system=None, temperature=0.0, json_schema=None):
        self.calls += 1
        if self.fail is not None:
            raise self.fail
        return self.reply


class OtherFakeLLM(FakeLLM):
    """Distinct type so _llm_lanes treats it as a separate provider."""


def install_lanes(monkeypatch, primary, fallback=None):
    # Both, because the primary lane is get_classifier_llm() when no engine is
    # named (routing is classification and stays on the cheap lane) and get_llm()
    # only when the Settings panel names one explicitly.
    monkeypatch.setattr(R, "get_llm", lambda engine=None: primary)
    monkeypatch.setattr(R, "get_classifier_llm", lambda: primary)
    if fallback is None:
        monkeypatch.setattr(R, "get_fallback_llm", lambda: primary)
    else:
        monkeypatch.setattr(R, "get_fallback_llm", lambda: fallback)


# ---------------------------------------------------------------------------
# The LLM lane is preferred and its slots are passed through
# ---------------------------------------------------------------------------


def test_valid_intents_came_from_the_schema():
    """The allow-list must track the schema, not be a hand-copied duplicate."""
    from app.pipeline.prompts import ROUTER_SCHEMA

    assert R.VALID_INTENTS == frozenset(ROUTER_SCHEMA["properties"]["intent"]["enum"])
    assert "narrative_search" in R.VALID_INTENTS


async def test_route_prefers_the_llm(monkeypatch):
    primary = FakeLLM('{"intent": "narrative_search", "slots": {"district": "Mysuru"}}')
    install_lanes(monkeypatch, primary)

    intent, slots = await R.route("house broken into while the family was away")

    assert intent == "narrative_search"
    assert slots == {"district": "Mysuru"}
    assert primary.calls == 1


async def test_markdown_fences_are_stripped(monkeypatch):
    primary = FakeLLM('```json\n{"intent": "hotspot", "slots": {}}\n```')
    install_lanes(monkeypatch, primary)

    intent, _ = await R.route("show hotspots in Mysuru")

    assert intent == "hotspot"


# ---------------------------------------------------------------------------
# Validation: the LLM's reply is not trusted
# ---------------------------------------------------------------------------


async def test_intent_outside_the_schema_enum_is_rejected(monkeypatch):
    """A hallucinated intent must not reach the orchestrator.

    "narrative" is not a dispatchable intent; before validation it was returned
    verbatim and matched no orchestrator branch.
    """
    primary = FakeLLM('{"intent": "narrative", "slots": {}}')
    install_lanes(monkeypatch, primary)

    intent, slots = await R.route("find cases involving a white car")

    assert intent in R.VALID_INTENTS
    assert intent == R._keyword_intent("find cases involving a white car")
    assert slots == {}


async def test_unparseable_reply_falls_through(monkeypatch):
    """Reasoning models wrap JSON in <think> prose; that must not become an intent."""
    primary = FakeLLM("<think>\nThe user is asking about...\n</think>")
    install_lanes(monkeypatch, primary)

    intent, _ = await R.route("top crimes in Bengaluru City")

    assert intent == "sql_query"  # keyword lane, not a crash


async def test_non_dict_slots_are_coerced(monkeypatch):
    primary = FakeLLM('{"intent": "hotspot", "slots": ["not", "a", "dict"]}')
    install_lanes(monkeypatch, primary)

    _, slots = await R.route("hotspots near Mysuru")

    assert slots == {}


# ---------------------------------------------------------------------------
# Lane ordering: primary -> fallback -> keywords
# ---------------------------------------------------------------------------


async def test_fallback_llm_runs_when_primary_fails(monkeypatch):
    primary = FakeLLM(fail=RuntimeError("401 Unauthorized"))
    fallback = OtherFakeLLM('{"intent": "narrative_search", "slots": {}}')
    install_lanes(monkeypatch, primary, fallback)

    intent, _ = await R.route("house broken into while the family was away")

    assert primary.calls == 1
    assert fallback.calls == 1, "fallback lane was skipped"
    assert intent == "narrative_search", "should use the fallback LLM, not keywords"


async def test_keywords_only_after_every_lane_fails(monkeypatch):
    primary = FakeLLM(fail=RuntimeError("401 Unauthorized"))
    fallback = OtherFakeLLM(fail=RuntimeError("404 Not Found"))
    install_lanes(monkeypatch, primary, fallback)

    intent, slots = await R.route("show hotspots in Mysuru")

    assert primary.calls == 1
    assert fallback.calls == 1
    assert intent == "hotspot"
    assert slots == {}


async def test_same_provider_is_not_retried_twice(monkeypatch):
    """When primary and fallback are the same class, don't spend a second request."""
    primary = FakeLLM(fail=RuntimeError("401 Unauthorized"))
    install_lanes(monkeypatch, primary)  # fallback is the *same object*

    await R.route("show hotspots in Mysuru")

    assert primary.calls == 1, "the already-failed provider was called again"


# ---------------------------------------------------------------------------
# Every downgrade must be logged. This is the guard for the original defect.
# ---------------------------------------------------------------------------


async def test_llm_failure_is_logged(monkeypatch, caplog):
    primary = FakeLLM(fail=RuntimeError("401 Unauthorized"))
    install_lanes(monkeypatch, primary)

    with caplog.at_level(logging.WARNING, logger="satyam.router"):
        await R.route("show hotspots in Mysuru")

    text = caplog.text
    assert "router.llm_failed" in text, "a dead LLM lane produced no log line"
    assert "401" in text, "the underlying error was swallowed"
    assert "router.keyword_fallback" in text, "silent downgrade to keywords"


async def test_successful_llm_route_logs_no_warning(monkeypatch, caplog):
    primary = FakeLLM('{"intent": "sql_query", "slots": {}}')
    install_lanes(monkeypatch, primary)

    with caplog.at_level(logging.WARNING, logger="satyam.router"):
        await R.route("how many theft cases last year")

    assert caplog.text == "", f"healthy routing should be quiet, got: {caplog.text}"


# ---------------------------------------------------------------------------
# Keyword lane: the last resort, but it still must not misfile obvious cases
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "what is my name",
        "what is my rank",
        "who am i",
        "who are you",
        "what can you do",
    ],
)
def test_personal_questions_are_smalltalk_not_sql(message):
    """Regression: "rank" is also a SQL signal word.

    Before the personal-question check ran first, "what is my rank" matched the
    SQL branch and the officer got a SQL error instead of an answer.
    """
    assert R._keyword_intent(message) == "smalltalk"


@pytest.mark.parametrize(
    "message,expected",
    [
        ("top crimes in Bengaluru City", "sql_query"),
        ("how many theft cases last year", "sql_query"),
        ("show hotspots in Mysuru", "hotspot"),
        ("modus operandi of the robbery", "narrative_search"),
        ("hello", "smalltalk"),
        ("link between Ramesh and the robbery", "network"),
        ("generate a pdf report", "report"),
    ],
)
def test_keyword_lane_baseline(message, expected):
    assert R._keyword_intent(message) == expected


@pytest.mark.parametrize(
    "message",
    [
        "show hotspots in Mysuru",
        "show me the heatmap",
        "show the cluster map for Mysuru",
    ],
)
def test_generic_verb_does_not_shadow_a_domain_noun(message):
    """Regression: "show" is a SQL signal and used to beat "hotspot"."""
    assert R._keyword_intent(message) == "hotspot"


def test_strong_aggregation_still_beats_a_domain_noun():
    """"top crime zones" is a ranking question, not a map request."""
    assert R._keyword_intent("top crime zones in Mysuru") == "sql_query"


@pytest.mark.parametrize(
    "message",
    [
        "victim was threatened with a knife near a bus stand",
        "house broken into while the family was away",
        "suspect fled on a motorcycle after grabbing a bag",
    ],
)
def test_incident_prose_is_not_routed_to_the_map_or_dropped(message):
    """The two live misroutes that started this work.

    "near" used to make the first one a hotspot query, and the others matched
    nothing and defaulted to smalltalk, so a corpus question got no data lane.
    """
    assert R._keyword_intent(message) == "narrative_search"


def test_every_keyword_result_is_dispatchable():
    """The keyword lane must only ever emit intents the orchestrator handles."""
    probes = [
        "top crimes", "how many cases", "show hotspots near me", "link between A and B",
        "generate a report", "modus operandi", "what is my rank", "hello",
        "victim was threatened with a knife", "which station", "asdfqwer",
    ]
    for p in probes:
        assert R._keyword_intent(p) in R.VALID_INTENTS, p
