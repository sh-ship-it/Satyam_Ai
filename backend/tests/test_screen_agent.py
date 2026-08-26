"""Screen-agent action validation.

`_sanitize_actions` used to filter param KEYS and pass any VALUE through, even
though SCREEN_CAPABILITIES already declared a domain for every one of them and
fed those domains to the LLM as a contract. The failures were silent by
construction: each screen's handler is an if/else chain that writes the value
into state and falls off the end when it does not recognise something, so a
`set_horizon days=9` blanked a control the officer was watching while the copilot
read back the plan as though it had worked.

These tests also pin the manifest against the screens it drives. A domain that
lists a value the screen cannot apply is worse than no domain at all now that the
domain is enforced.
"""
from __future__ import annotations

import pytest

from app.pipeline.screen_agent import (
    SCREEN_CAPABILITIES,
    _coerce_param,
    _sanitize_actions,
)


def one(screen: str, action: str, **params) -> list[dict]:
    return [{"screen": screen, "action": action, "params": params}]


# ── the structural guard that already existed ────────────────────────────────

def test_unknown_screen_and_action_are_dropped():
    assert _sanitize_actions(one("/hack", "search", query="x")) == []
    assert _sanitize_actions(one("/audit", "drop_table", query="x")) == []


def test_unlisted_param_key_is_stripped_but_the_action_survives():
    out = _sanitize_actions(one("/audit", "search", query="theft", sql="DROP TABLE cases"))
    assert out == [{"screen": "/audit", "action": "search", "params": {"query": "theft"}}]


def test_non_dict_entries_do_not_break_the_batch():
    raw = ["nope", None, 7] + one("/audit", "search", query="theft")
    assert len(_sanitize_actions(raw)) == 1


# ── numeric enums ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("days", [3, 7, 14, 30, "14", " 30 "])
def test_in_domain_horizon_survives_and_arrives_as_a_number(days):
    out = _sanitize_actions(one("/forecast", "set_horizon", days=days))
    assert len(out) == 1
    # The screen compares against its own [3,7,14,30]; a string would never match.
    assert out[0]["params"]["days"] == int(str(days).strip())
    assert isinstance(out[0]["params"]["days"], int)


@pytest.mark.parametrize("days", [9, 0, -7, 365, "soon", None, ""])
def test_out_of_domain_horizon_is_dropped_whole(days):
    """Not "dropped down to no params": an action with no `days` would be
    reported as applied and the officer told the horizon had changed."""
    assert _sanitize_actions(one("/forecast", "set_horizon", days=days)) == []


# ── booleans ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", [False, "false", "no", "off", "0", "hide", "OFF"])
def test_a_spoken_no_is_false_not_true(raw):
    """`Boolean("no")` is true. This is the bug that made "switch off the
    heatmap" switch it on."""
    out = _sanitize_actions(one("/vision", "toggle_layer", layer="crime_hex", on=raw))
    assert out[0]["params"]["on"] is False


@pytest.mark.parametrize("raw", [True, "true", "yes", "on", "1", "show"])
def test_a_spoken_yes_is_true(raw):
    out = _sanitize_actions(one("/vision", "toggle_layer", layer="crime_hex", on=raw))
    assert out[0]["params"]["on"] is True


def test_an_unparseable_flag_is_rejected_rather_than_guessed():
    assert _sanitize_actions(one("/vision", "toggle_layer", layer="crime_hex", on="maybe")) == []


def test_toggle_without_a_flag_is_still_a_valid_level_free_toggle():
    out = _sanitize_actions(one("/vision", "toggle_layer", layer="crime_hex"))
    assert out == [
        {"screen": "/vision", "action": "toggle_layer", "params": {"layer": "crime_hex"}}
    ]


def test_an_unknown_layer_is_dropped():
    assert _sanitize_actions(one("/vision", "toggle_layer", layer="payroll", on=True)) == []


# ── string enums, canonicalised ──────────────────────────────────────────────

def test_enum_matching_is_case_insensitive_and_returns_the_canonical_form():
    out = _sanitize_actions(one("/vision", "set_view", mode="3D"))
    assert out[0]["params"]["mode"] == "3d"


def test_street3d_is_reachable_now_that_the_manifest_lists_it():
    out = _sanitize_actions(one("/vision", "set_view", mode="street3d"))
    assert out[0]["params"]["mode"] == "street3d"


def test_a_value_outside_the_enum_is_dropped():
    assert _sanitize_actions(one("/vision", "set_view", mode="hologram")) == []
    assert _sanitize_actions(one("/network", "set_link_mode", mode="everything")) == []
    assert _sanitize_actions(one("/reports", "set_template", template="whatever")) == []


def test_hex_radius_accepts_auto_and_the_offered_bins_only():
    for good in ("auto", 100, "500", 1000):
        assert len(_sanitize_actions(one("/vision", "set_hex_radius", radius_m=good))) == 1
    # 50 was in the old manifest and is not one of the control's choices.
    for bad in (50, 250, 0, "wide"):
        assert _sanitize_actions(one("/vision", "set_hex_radius", radius_m=bad)) == []


def test_a_name_enum_stays_fuzzy_because_the_screen_resolves_it():
    """/news set_channel lists human-readable names. The frontend owns the
    verified slug table and matches loosely, so a strict enum here would drop
    "public tv" and the officer would keep watching the previous channel."""
    out = _sanitize_actions(one("/news", "set_channel", channel="public tv"))
    assert out[0]["params"]["channel"] == "public tv"


# ── free text ────────────────────────────────────────────────────────────────

def test_blank_free_text_is_rejected():
    assert _sanitize_actions(one("/audit", "search", query="   ")) == []


def test_free_text_is_trimmed():
    out = _sanitize_actions(one("/audit", "search", query="  Ramesh  "))
    assert out[0]["params"]["query"] == "Ramesh"


# ── number domain ────────────────────────────────────────────────────────────

def test_depth_is_a_number_domain_so_it_coerces_but_the_screen_bounds_it():
    """`set_depth` is declared "number", not an enum, so 7 passes the backend.
    The 1-3 bound lives in the Network screen next to the select that defines it."""
    out = _sanitize_actions(one("/network", "set_depth", depth="2"))
    assert out[0]["params"]["depth"] == 2
    assert _sanitize_actions(one("/network", "set_depth", depth="deep")) == []
    assert _sanitize_actions(one("/network", "set_depth", depth=True)) == []


# ── the manifest itself ──────────────────────────────────────────────────────

def test_every_declared_domain_is_one_the_validator_understands():
    """A typo'd domain would silently degrade to free-text validation, which is
    how "fine|med|coarse" stayed wrong against a screen wanting "medium"."""
    for route, spec in SCREEN_CAPABILITIES.items():
        for action, meta in spec["actions"].items():
            for param, domain in meta["params"].items():
                where = f"{route} {action} {param}"
                assert isinstance(domain, str) and domain, where
                assert domain in ("string", "number", "boolean") or "|" in domain, (
                    f"{where}: {domain!r} is neither a known scalar nor an enum"
                )


def test_every_enum_option_is_accepted_by_the_validator():
    """Round-trip: whatever the prompt advertises must survive validation, or the
    LLM is being told to emit values that get thrown away."""
    for route, spec in SCREEN_CAPABILITIES.items():
        for action, meta in spec["actions"].items():
            for param, domain in meta["params"].items():
                if "|" not in domain:
                    continue
                for opt in domain.split("|"):
                    assert _coerce_param(opt, domain) is not None, f"{route} {action} {param}={opt}"


# ── the rule planner goes through the same gate ──────────────────────────────

@pytest.mark.parametrize(
    "command,on_screen",
    [
        ("switch to the earth globe", None),
        ("turn on thermal vision", None),
        ("hide the patrol layer", "/vision"),
        ("set the bin radius to auto", "/vision"),
        ("set the bin radius to 500", "/vision"),
        ("show me the network for Ramesh at depth 2", None),
        ("forecast burglary in Mysuru for 14 days", None),
        ("show weekly trends", None),
        ("put on public tv", None),
        ("mute the news", None),
        ("generate the pdf report", None),
        ("search the audit log for Ramesh", None),
        ("switch the dashboard to heat mode", None),
    ],
)
def test_rule_planner_output_survives_its_own_validator(command, on_screen):
    """The rule planner used to return unvalidated, on the reasoning that it only
    emits canonical values. That was true but unenforced, and the hex-radius
    domain had already drifted from the control it describes. If this fails, the
    rule planner and the manifest disagree - fix whichever one is wrong.

    `on_screen` is the officer's current route, because a follow-up like "hide the
    patrol layer" carries no screen keyword and is only routable in context.
    """
    from app.pipeline.screen_agent import _rule_plan

    plan = _rule_plan(command, on_screen, "en")
    assert plan["actions"], f"{command!r} produced no actions at all"
    # Idempotent: passing an already-clean plan back through changes nothing.
    assert _sanitize_actions(plan["actions"]) == plan["actions"], (
        f"{command!r} produced actions its own validator rejects: {plan['actions']}"
    )
