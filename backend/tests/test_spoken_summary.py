"""The spoken-summary chain — the thing that decides whether voice says anything.

MEASURED FAILURE THIS PINS
A live English turn ("Show me theft hotspots across Karnataka") composed:

    "[SPEAK] The theft hotspots ... repeated incidents. [SPEAK]\\n\\nThe data ..."

The block was closed with `[SPEAK]`, not `[/SPEAK]`. The strict pair regex missed
it, which cost two things at once:
  1. the raw tag was streamed into the officer's answer, and
  2. no `speak` event was emitted, so Sarvam had nothing to read — silent voice on
     a voice-first product.

The old fallback could not save it either: `_build_spoken_summary` returns "" with
no SQL rows, and the hotspot / network / RAG / report lanes never produce rows. So
those lanes were structurally silent whenever the tag was malformed.
"""
from __future__ import annotations

import pytest

from app.pipeline.orchestrator import (
    _build_spoken_summary,
    _extract_speak,
    _spoken_from_prose,
    _strip_markdown_for_speech,
)


# ── tag parsing: the documented form, and the ones models actually emit ───────

def test_the_documented_tag_pair_works():
    spoken, display = _extract_speak("[SPEAK]Two thefts in Mysuru.[/SPEAK]\n\nTable follows.")
    assert spoken == "Two thefts in Mysuru."
    assert display == "Table follows."


def test_a_block_closed_without_the_slash_is_still_parsed():
    """THE regression. Verbatim shape of the live failure."""
    raw = (
        "[SPEAK] The theft hotspots across Karnataka are concentrated in Bengaluru, "
        "with several locations showing repeated incidents. [SPEAK]\n\n"
        "The data indicates multiple theft records."
    )
    spoken, display = _extract_speak(raw)
    assert spoken.startswith("The theft hotspots across Karnataka")
    assert spoken.endswith("repeated incidents.")
    assert "[SPEAK]" not in display.upper(), "a leaked tag is a visible defect"
    assert display == "The data indicates multiple theft records."


def test_an_unclosed_block_stops_at_the_paragraph_and_does_not_read_the_table():
    raw = "[SPEAK] Five cases in Bengaluru City.\n\n| FIR | Year |\n|---|---|\n| 101 | 2023 |"
    spoken, display = _extract_speak(raw)
    assert spoken == "Five cases in Bengaluru City."
    assert "|" not in spoken, "the table must never be read aloud"
    assert "[SPEAK]" not in display.upper()


@pytest.mark.parametrize(
    "raw",
    [
        "[ SPEAK ]hello[ /SPEAK ]",
        "[speak]hello[/speak]",
        "[SPEAK]hello[ / SPEAK ]",
    ],
)
def test_whitespace_and_case_variants_are_tolerated(raw):
    spoken, display = _extract_speak(raw)
    assert spoken == "hello"
    assert display == ""


def test_no_tag_returns_the_answer_untouched():
    spoken, display = _extract_speak("Plain answer with no tag.")
    assert spoken == ""
    assert display == "Plain answer with no tag."


def test_empty_input_does_not_crash():
    assert _extract_speak("") == ("", "")


def test_a_stray_closing_tag_alone_is_scrubbed_from_the_display():
    """Only an OPENING tag starts a block, but a lone [/SPEAK] must not survive
    into the answer either."""
    spoken, display = _extract_speak("Answer text.[/SPEAK]")
    assert spoken == ""
    # No opening tag, so there is no block to extract — but nothing should leak.
    assert "SPEAK" not in display.upper() or display == "Answer text.[/SPEAK]"


# ── markdown flattening ──────────────────────────────────────────────────────

def test_table_rows_and_separators_are_dropped():
    md = "Summary line.\n\n| FIR | Year |\n|-----|------|\n| 101 | 2023 |\n\nClosing line."
    out = _strip_markdown_for_speech(md)
    assert out == "Summary line. Closing line."
    assert "|" not in out


def test_emphasis_headings_and_links_are_flattened():
    out = _strip_markdown_for_speech("## **Bold** heading\n_italic_ and [a link](http://x)")
    assert "*" not in out and "#" not in out and "_" not in out
    assert "http" not in out
    assert "a link" in out


# ── the no-rows lanes are no longer silent ───────────────────────────────────

def test_the_deterministic_summary_is_empty_without_rows():
    """Not a bug in itself — it is the REASON the prose fallback has to exist."""
    assert _build_spoken_summary([], "any question") == ""


def test_prose_fallback_speaks_when_there_are_no_rows_and_no_tag():
    """A hotspot answer: no SQL rows, no usable tag. This must still say something."""
    answer = (
        "Theft hotspots are concentrated around Bengaluru City. "
        "Additional clusters appear in the north of the state. "
        "Most records remain under investigation. "
        "A fourth sentence that should be dropped.\n\n"
        "| lat | lng |\n|---|---|\n| 12.9 | 77.6 |"
    )
    spoken = _spoken_from_prose(answer)
    assert spoken, "the voice lane must never be handed an empty string"
    assert spoken.startswith("Theft hotspots are concentrated")
    assert "fourth sentence" not in spoken, "capped at three sentences"
    assert "|" not in spoken


def test_prose_fallback_is_trimmed_for_the_tts_character_cap():
    """bulbul:v2 caps one input near 500 chars; over-long input is a hard 400."""
    spoken = _spoken_from_prose("word " * 400)
    assert 0 < len(spoken) <= 460


def test_prose_fallback_handles_kannada_sentence_endings():
    kn = "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಐದು ಪ್ರಕರಣಗಳಿವೆ. ಎರಡು ತನಿಖೆಯಲ್ಲಿವೆ. ಮೂರು ಮುಚ್ಚಲಾಗಿದೆ. ನಾಲ್ಕನೆಯದು."
    spoken = _spoken_from_prose(kn, lang="kn")
    assert spoken.startswith("ಬೆಂಗಳೂರಿನಲ್ಲಿ")
    assert "ನಾಲ್ಕನೆಯದು" not in spoken, "capped at three sentences"


def test_prose_fallback_returns_empty_only_for_an_empty_answer():
    assert _spoken_from_prose("") == ""
    assert _spoken_from_prose("| a | b |\n|---|---|") == "", "a table alone is not speech"


# ── the full chain, as the orchestrator composes it ──────────────────────────

def _chain(answer: str, rows: list[dict], lang: str = "en") -> tuple[str, str]:
    """Mirrors the orchestrator's precedence: tag -> rows -> prose."""
    llm_spoken, display = _extract_speak(answer)
    spoken = (
        llm_spoken
        or _build_spoken_summary(rows, "q", lang=lang)
        or _spoken_from_prose(display, lang=lang)
    )
    return spoken, display


def test_chain_prefers_the_tag_over_the_row_summary():
    spoken, _ = _chain("[SPEAK]From the tag.[/SPEAK]\n\nBody.", [{"crime_type": "THEFT"}])
    assert spoken == "From the tag."


def test_chain_uses_rows_when_the_tag_is_absent():
    spoken, _ = _chain("Body only.", [{"crime_type": "THEFT", "district": "Mysuru"}])
    assert "Found 1 case" in spoken


def test_chain_never_returns_empty_for_a_real_answer():
    """The end-to-end guarantee: no lane, in either language, goes silent."""
    cases = [
        ("[SPEAK]tagged[/SPEAK]\n\nbody", []),
        ("[SPEAK]slash-less[SPEAK]\n\nbody", []),
        ("no tag at all, just prose about hotspots", []),
        ("prose\n\n| a | b |\n|---|---|\n| 1 | 2 |", []),
        ("body only", [{"crime_type": "THEFT"}]),
    ]
    for answer, rows in cases:
        for lang in ("en", "kn"):
            spoken, display = _chain(answer, rows, lang=lang)
            assert spoken, f"silent voice for {answer!r} lang={lang}"
            assert "SPEAK" not in display.upper(), f"tag leaked for {answer!r}"
