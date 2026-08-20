"""Router-first orchestration.

Given a user message + RLS-scoped session + principal, route to a lane, call the
appropriate grounded tool(s), compose a cited answer, and emit pipeline events.
Events are consumed by the SSE endpoint for live streaming.

Engine overrides (brain_engine, sql_engine) are passed from the per-request
ChatRequest so the Settings panel can flip lanes live without redeploying.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import AsyncIterator, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal
from app.models.registry import get_fallback_llm, get_llm
from app.config import get_settings
from app.pipeline import guardrails
from app.pipeline.prompts import build_answer_system
from app.pipeline.router import route
from app.pipeline.slots import ConversationState
from app.pipeline.tools import analytics, rag
from app.pipeline.tools.text_to_sql import UnsafeSQL, answer_with_sql

log = logging.getLogger("satyam.pipeline")


_KANNADA_HEADERS = {
    "fir": "ಎಫ್ಐಆರ್",
    "fir_number": "ಎಫ್ಐಆರ್",
    "year": "ವರ್ಷ",
    "crime_type": "ಅಪರಾಧದ ಪ್ರಕಾರ",
    "status": "ಸ್ಥಿತಿ",
    "station": "ಪೊಲೀಸ್ ಠಾಣೆ",
    "station_name": "ಪೊಲೀಸ್ ಠಾಣೆ",
    "district": "ಜಿಲ್ಲೆ",
    "report_date": "ವರದಿ ದಿನಾಂಕ",
    "legal_code": "ಕಾನೂನು ಕೋಡ್",
    "sections": "ಕಲಂಗಳು",
    "count": "ಪ್ರಕರಣಗಳ ಸಂಖ್ಯೆ",
}

_KANNADA_CRIME_TYPES = {
    "THEFT": "ಕಳ್ಳತನ",
    "Theft": "ಕಳ್ಳತನ",
    "MURDER": "ಕೊಲೆ",
    "Murder": "ಕೊಲೆ",
    "ASSAULT": "ಹಲ್ಲೆ",
    "Assault": "ಹಲ್ಲೆ",
    "ROBBERY": "ದರೋಡೆ",
    "Robbery": "ದರೋಡೆ",
    "BURGLARY": "ಮನೆಗಳ್ಳತನ",
    "Burglary": "ಮನೆಗಳ್ಳತನ",
    "FRAUD": "ವಂಚನೆ",
    "Fraud": "ವಂಚನೆ",
    "CHEATING": "ಮೋಸ",
    "Cheating": "ಮೋಸ",
    "KIDNAPPING": "ಅಪಹರಣ",
    "Kidnapping": "ಅಪಹರಣ",
    "RIOT": "ಗಲಭೆ",
    "Riot": "ಗಲಭೆ",
    "CYBER CRIME": "ಸೈಬರ್ ಅಪರಾಧ",
    "Cyber Crime": "ಸೈಬರ್ ಅಪರಾಧ",
    "DOWRY": "ವರದಕ್ಷಿಣೆ",
    "Dowry": "ವರದಕ್ಷಿಣೆ",
    "HURT": "ಗಾಯ",
    "Hurt": "ಗಾಯ",
    "EXTORTION": "ಸುಲಿಗೆ",
    "Extortion": "ಸುಲಿಗೆ",
    "NARCOTICS": "ಮಾದಕ ದ್ರವ್ಯ",
    "Narcotics": "ಮಾದಕ ದ್ರವ್ಯ",
    "RAPE": "ಅತ್ಯಾಚಾರ",
    "Rape": "ಅತ್ಯಾಚಾರ",
    "POCSO": "ಪೋಕ್ಸೋ",
}

_KANNADA_STATUSES = {
    "Open": "ತೆರೆದಿದೆ",
    "Closed": "ಮುಚ್ಚಲಾಗಿದೆ",
    "Under Investigation": "ತನಿಖೆ ನಡೆಯುತ್ತಿದೆ",
    "Charge-sheeted": "ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಲಾಗಿದೆ",
    "Convicted": "ಶಿಕ್ಷೆಯಾಗಿದೆ",
    "Acquitted": "ಖುಲಾಸೆ",
    "Pending": "ಬಾಕಿ",
    "Pending Trial": "ವಿಚಾರಣೆ ಬಾಕಿ",
    "Charge Sheeted": "ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಲಾಗಿದೆ",
    "Undetected": "ಪತ್ತೆಯಾಗದ",
    "Referred": "ಉಲ್ಲೇಖಿಸಲಾಗಿದೆ",
    "Discharged": "ಬಿಡುಗಡೆ",
    "Dismissed": "ವಜಾ",
    "FR Filed": "ಅಂತಿಮ ವರದಿ ಸಲ್ಲಿಸಲಾಗಿದೆ",
    "Suo Motu": "ಸ್ವಯಂ ಪ್ರೇರಣೆ",
    "Dis/Acq": "ವಜಾ/ಖುಲಾಸೆ",
    "BoundOver": "ಬೌಂಡ್‌ಓವರ್‌",
    "Traced": "ಪತ್ತೆಯಾಗಿದೆ",
}

_KANNADA_DISTRICTS = {
    "Bagalkot": "ಬಾಗಲಕೋಟೆ",
    "Ballari": "ಬಳ್ಳಾರಿ",
    "Belagavi City": "ಬೆಳಗಾವಿ ನಗರ",
    "Belagavi Dist": "ಬೆಳಗಾವಿ ಜಿಲ್ಲೆ",
    "Bengaluru City": "ಬೆಂಗಳೂರು ನಗರ",
    "Bengaluru Dist": "ಬೆಂಗಳೂರು ಜಿಲ್ಲೆ",
    "Bidar": "ಬೀದರ್",
    "Chamarajanagar": "ಚಾಮರಾಜನಗರ",
    "Chickballapura": "ಚಿಕ್ಕಬಳ್ಳಾಪುರ",
    "Chikkamagaluru": "ಚಿಕ್ಕಮಗಳೂರು",
    "Chitradurga": "ಚಿತ್ರದುರ್ಗ",
    "Dakshina Kannada": "ದಕ್ಷಿಣ ಕನ್ನಡ",
    "Davanagere": "ದಾವಣಗೆರೆ",
    "Dharwad": "ಧಾರವಾಡ",
    "Gadag": "ಗದಗ",
    "Hassan": "ಹಾಸನ",
    "Haveri": "ಹಾವೇರಿ",
    "Hubballi Dharwad City": "ಹುಬ್ಬಳ್ಳಿ ಧಾರವಾಡ ನಗರ",
    "Kalaburagi": "ಕಲಬುರಗಿ",
    "Kalaburagi City": "ಕಲಬುರಗಿ ನಗರ",
    "Karnataka Railways": "ಕರ್ನಾಟಕ ರೈಲ್ವೆ",
    "Kodagu": "ಕೊಡಗು",
    "Kolar": "ಕೋಲಾರ",
    "Koppal": "ಕೊಪ್ಪಳ",
    "Mandya": "ಮಂಡ್ಯ",
    "Mangaluru City": "ಮಂಗಳೂರು ನಗರ",
    "Mysuru City": "ಮೈಸೂರು ನಗರ",
    "Mysuru Dist": "ಮೈಸೂರು ಜಿಲ್ಲೆ",
    "Raichur": "ರಾಯಚೂರು",
    "Ramanagara": "ರಾಮನಗರ",
    "Shivamogga": "ಶಿವಮೊಗ್ಗ",
    "Tumakuru": "ತುಮಕೂರು",
    "Udupi": "ಉಡುಪಿ",
    "Uttara Kannada": "ಉತ್ತರ ಕನ್ನಡ",
    "Vijayanagara": "ವಿಜಯನಗರ",
    "Vijayapur": "ವಿಜಯಪುರ",
    "Yadgir": "ಯಾದಗಿರಿ",
    "CID": "ಸಿಐಡಿ",
    "Coastal Security Police": "ಕರಾವಳಿ ಭದ್ರತಾ ಪೊಲೀಸ್",
    "ISD Bengaluru": "ಐಎಸ್‌ಡಿ ಬೆಂಗಳೂರು",
    "K.G.F": "ಕೆ.ಜಿ.ಎಫ್",
    "Bengaluru Urban": "ಬೆಂಗಳೂರು ನಗರ",
    "Mysuru": "ಮೈಸೂರು",
    "Belagavi": "ಬೆಳಗಾವಿ",
    "Hubballi-Dharwad": "ಹುಬ್ಬಳ್ಳಿ-ಧಾರವಾಡ",
}

_KANNADA_STATIONS = {
    "Cubbon Park PS": "ಕಬ್ಬನ್ ಪಾರ್ಕ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Kadugondana Halli PS": "ಕಡುಗೊಂಡನಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Sadashivanagar Traffic PS": "ಸದಾಶಿವನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Malleshwaram Traffic PS": "ಮಲ್ಲೇಶ್ವರಂ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Wilsongarden PS": "ವಿಲ್ಸನ್ ಗಾರ್ಡನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Vijayanagar PS": "ವಿಜಯನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Yeshwanthpur PS": "ಯಶವಂತಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Hesaraghatta Road PS": "ಹೆಸರಘಟ್ಟ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Devaraja PS": "ದೇವರಾಜ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Nazarbad PS": "ನಜರ್‌ಬಾದ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Lashkar Mohalla PS": "ಲಷ್ಕರ್ ಮೊಹಲ್ಲಾ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Mangaluru East PS": "ಮಂಗಳೂರು ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Pandeshwar PS": "ಪಾಂಡೇಶ್ವರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Mangaluru North PS": "ಮಂಗಳೂರು ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Urwa PS": "ಉರ್ವಾ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Bogarves PS": "ಬೋಗಾರ್ವೆಸ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Kalaburagi City PS": "ಕಲಬುರಗಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Aland Road PS": "ಆಳಂದ್ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Kalaburagi Rural PS": "ಕಲಬುರಗಿ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Udupi Town PS": "ಉಡುಪಿ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Kundapur PS": "ಕುಂದಾಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Sandur PS": "ಸಂದೂರು ಪೊಲೀಸ್ ಠಾಣೆ",
    "Ballari Urban PS": "ಬಳ್ಳಾರಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Kudligi PS": "ಕೂಡ್ಲಿಗಿ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Hospet Forest Range PS": "ಹೊಸಪೇಟೆ ಅರಣ್ಯ ವಲಯ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Hubballi Town PS": "ಹುಬ್ಬಳ್ಳಿ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Dharwad PS": "ಧಾರವಾಡ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Hubballi Rural PS": "ಹುಬ್ಬಳ್ಳಿ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Shivamogga Forest Range PS": "ಶಿವಮೊಗ್ಗ ಅರಣ್ಯ ವಲಯ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Sagar Forest PS": "ಸಾಗರ ಅರಣ್ಯ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Thirthahalli PS": "ತೀರ್ಥಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Tumakuru CEN PS": "ತುಮಕೂರು ಸಿಇಎನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
    "Tumakuru North PS": "ತುಮಕೂರು ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
}


def _translate_station(name: str) -> str:
    if name in _KANNADA_STATIONS:
        return _KANNADA_STATIONS[name]

    suffixes = {
        " Traffic PS": " ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
        " Forest Range PS": " ಅರಣ್ಯ ವಲಯ ಪೊಲೀಸ್ ಠಾಣೆ",
        " Forest PS": " ಅರಣ್ಯ ಪೊಲೀಸ್ ಠಾಣೆ",
        " CEN PS": " ಸಿಇಎನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
        " City PS": " ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
        " Rural PS": " ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
        " Town PS": " ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
        " North PS": " ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
        " South PS": " ದಕ್ಷಿಣ ಪೊಲೀಸ್ ಠಾಣೆ",
        " East PS": " ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ",
        " West PS": " ಪಶ್ಚಿಮ ಪೊಲೀಸ್ ಠಾಣೆ",
        " PS": " ಪೊಲೀಸ್ ಠಾಣೆ",
    }
    for eng, kn in suffixes.items():
        if name.endswith(eng):
            base = name[:-len(eng)].strip()
            translated_base = _KANNADA_DISTRICTS.get(base, base)
            return f"{translated_base}{kn}"

    return name


@dataclass
class PipelineEvent:
    type: str
    data: dict

    def sse(self) -> str:
        return f"data: {json.dumps({'type': self.type, **self.data})}\n\n"


def _rows_context(rows: list[dict], limit: int = 25) -> str:
    return json.dumps(rows[:limit], default=str)


import re as _re
from collections import Counter as _Counter

_SPEAK_RE = _re.compile(r"\[SPEAK\](.*?)\[/SPEAK\]", _re.DOTALL | _re.IGNORECASE)


def _build_spoken_summary(rows: list[dict], message: str, lang: str = "en") -> str:
    """Build a 2–3 sentence spoken briefing from raw SQL rows.

    Works entirely from the data — no LLM needed — so it is guaranteed to work
    in demo/keyless mode AND when Gemini doesn't follow the [SPEAK] convention.

    Respects `lang`: when "kn", generates Kannada output so the TTS reads in
    the correct language matching the user's UI language toggle.
    """
    if not rows:
        return ""

    total = len(rows)
    is_kn = lang == "kn"

    # Detect location hint from the question / rows
    location = ""
    for key in ("station_name", "district"):
        vals = [str(r.get(key, "")).strip() for r in rows if r.get(key)]
        if vals:
            most_common = _Counter(vals).most_common(1)[0][0]
            if most_common:
                location = most_common
                break

    if is_kn:
        if location.endswith(" PS") or "Police Station" in location:
            translated_loc = _translate_station(location)
        else:
            translated_loc = _KANNADA_DISTRICTS.get(location, location)
        lead = f"{translated_loc + ' ನಲ್ಲಿ ' if translated_loc else ''}{total} ಪ್ರಕರಣ{'ಗಳು' if total != 1 else ''} ದಾಖಲಾಗಿವೆ."
    else:
        lead = f"Found {total} case{'s' if total != 1 else ''}"
        lead += f" at {location}." if location else "."

    # Top crime types
    crime_counts = _Counter(
        str(r.get("crime_type", "")).strip().title()
        for r in rows if r.get("crime_type")
    )
    top_crimes = crime_counts.most_common(2)
    crime_sentence = ""
    if top_crimes:
        if is_kn:
            raw_crime = top_crimes[0][0]
            translated_crime = _KANNADA_CRIME_TYPES.get(raw_crime, _KANNADA_CRIME_TYPES.get(raw_crime.upper(), raw_crime))
            crime_sentence = f"ಅತಿ ಹೆಚ್ಚಿನ ಪ್ರಕರಣಗಳು {translated_crime} ವರ್ಗದಲ್ಲಿವೆ."
        else:
            parts = [f"{name} with {cnt}" for name, cnt in top_crimes]
            crime_sentence = f"The most common crime type is {parts[0]} record{'s' if top_crimes[0][1] != 1 else ''}"
            if len(parts) > 1:
                crime_sentence += f", followed by {parts[1]}"
            crime_sentence += "."

    # Status breakdown
    status_counts = _Counter(
        str(r.get("status", "")).strip().title()
        for r in rows if r.get("status")
    )
    status_sentence = ""
    if status_counts:
        top_status, top_n = status_counts.most_common(1)[0]
        if top_n > 1:
            pct = round(top_n / total * 100)
            if is_kn:
                translated_status = _KANNADA_STATUSES.get(top_status, top_status)
                status_sentence = f"ಇವುಗಳಲ್ಲಿ {top_n} ಪ್ರಕರಣಗಳು {translated_status} ಸ್ಥಿತಿಯಲ್ಲಿವೆ."
            else:
                status_sentence = f"{top_n} of these ({pct}%) are {top_status}."

    parts = [p for p in [lead, crime_sentence, status_sentence] if p]
    return " ".join(parts[:3])


def _extract_speak(answer: str) -> tuple[str, str]:
    """Return (spoken_summary, display_text).

    Pulls out the [SPEAK]...[/SPEAK] block from a Gemini answer when it exists.
    If not found returns ("", answer) — caller falls back to the deterministic summary.
    """
    m = _SPEAK_RE.search(answer)
    if not m:
        return "", answer
    spoken = m.group(1).strip()
    display = _SPEAK_RE.sub("", answer).strip()
    return spoken, display





def _render_grounded(question: str, context: str, lang: str = "en") -> str:
    """D5.3 FIX: deterministic, no-LLM answer used in demo/keyless mode."""
    try:
        data = json.loads(context)
    except Exception:
        data = None

    is_kn = lang == "kn"

    # Help / report / note payloads.
    if isinstance(data, dict):
        if "help" in data:
            if is_kn:
                return (
                    "ನಾನು ಅಪರಾಧ ಡೇಟಾಬೇಸ್‌ನಲ್ಲಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ. ಉದಾಹರಣೆಗೆ: "
                    "\"ಬೆಂಗಳೂರು ನಗರದಲ್ಲಿನ ಪ್ರಮುಖ ಅಪರಾಧ ಪ್ರಕಾರಗಳು\", \"ಈ ವರ್ಷ ಎಷ್ಟು ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ದಾಖಲಾಗಿವೆ\", "
                    "ಅಥವಾ \"ಮೈಸೂರಿನ ಇತ್ತೀಚಿನ ಪ್ರಕರಣಗಳ ಪಟ್ಟಿ\"."
                )
            return (
                "I can answer questions over the crime database. Try: "
                '"top crime types in Bengaluru City", "how many theft cases this year", '
                'or "list recent cases in Mysuru".'
            )
        if "note" in data:
            return str(data["note"])
        if "nodes" in data:
            if is_kn:
                return (
                    f"ನೆಟ್‌ವರ್ಕ್ ರಚಿಸಲಾಗಿದೆ: {len(data.get('nodes', []))} ನೋಡ್‌ಗಳು, "
                    f"{len(data.get('edges', []))} ಲಿಂಕ್‌ಗಳು. ಪರಿಶೋಧಿಸಲು ನೆಟ್‌ವರ್ಕ್ ಫಲಕವನ್ನು ತೆರೆಯಿರಿ."
                )
            return (
                f"Network built: {len(data.get('nodes', []))} nodes, "
                f"{len(data.get('edges', []))} links. Open the Network panel to explore."
            )
        if is_kn:
            return "ಯಾವುದೇ ಹೊಂದಾಣಿಕೆಯ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ."
        return "Found no matching records."

    rows = data if isinstance(data, list) else []
    if not rows:
        if is_kn:
            return "ಯಾವುದೇ ಹೊಂದಾಣಿಕೆಯ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ. ಬೇರೆ ಜಿಲ್ಲೆ, ಅಪರಾಧದ ಪ್ರಕಾರ ಅಥವಾ ವರ್ಷವನ್ನು प्रयत्नಿಸಿ."
        return "Found no matching records. Try a different district, crime type, or year."

    # Single aggregate value (e.g. COUNT or top-N).
    if len(rows) == 1 and len(rows[0]) == 1:
        (k, v), = rows[0].items()
        if is_kn:
            translated_k = _KANNADA_HEADERS.get(k.lower(), k.replace('_', ' '))
            return f"**{v}** {translated_k}."
        return f"**{v}** {k.replace('_', ' ')}."

    # Build a Markdown table from the columns that are actually present.
    cols = list(rows[0].keys())
    if is_kn:
        header_cols = [_KANNADA_HEADERS.get(c.lower(), c.replace("_", " ").title()) for c in cols]
    else:
        header_cols = [c.replace("_", " ").title() for c in cols]
    header = "| " + " | ".join(header_cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    body = []
    for r in rows[:10]:
        row_cells = []
        for c in cols:
            val = r.get(c)
            if val is None:
                cell_str = ""
            else:
                val_str = str(val)
                if is_kn:
                    if c.lower() == "crime_type":
                        val_str = _KANNADA_CRIME_TYPES.get(val_str, _KANNADA_CRIME_TYPES.get(val_str.upper(), val_str))
                    elif c.lower() == "status":
                        val_str = _KANNADA_STATUSES.get(val_str, val_str)
                    elif c.lower() == "district":
                        val_str = _KANNADA_DISTRICTS.get(val_str, val_str)
                    elif c.lower() in ("station", "station_name"):
                        val_str = _translate_station(val_str)
                cell_str = val_str
            row_cells.append(cell_str)
        body.append("| " + " | ".join(row_cells) + " |")

    if is_kn:
        more = (
            "" if len(rows) <= 10
            else f"\n\n{len(rows)} ರಲ್ಲಿ 10 ಅನ್ನು ತೋರಿಸಲಾಗುತ್ತಿದೆ — ದಿನಾಂಕ, ಸ್ಥಿತಿ ಅಥವಾ ಅಪರಾಧದ ಪ್ರಕಾರದ ಮೂಲಕ ಫಿಲ್ಟರ್ ಮಾಡಲು ಕೇಳಿ."
        )
        intro = f"ದಾಖಲೆಗಳಲ್ಲಿ {len(rows)} ಹೊಂದಾಣಿಕೆಯ ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿವೆ."
    else:
        more = (
            "" if len(rows) <= 10
            else f"\n\nShowing 10 of {len(rows)} — ask to narrow by date, status, or crime type."
        )
        intro = f"Found {len(rows)} matching record(s)."

    return f"{intro}\n\n{header}\n{sep}\n" + "\n".join(body) + more


import re as _re2

def _post_translate_kn(text: str) -> str:
    """Deterministic post-processor: replaces English table-cell values with Kannada.

    Called after the LLM generates the answer when lang=='kn'.  It operates on
    pipe-separated Markdown table rows and also on inline text blocks so that
    THEFT, Under Investigation, Cubbon Park PS, etc. are always shown in Kannada
    regardless of whether the LLM followed the translation directive.
    """
    # Build combined ordered replacement list.
    # Order matters: longer strings before shorter ones to avoid partial matches.
    replacements: list[tuple[str, str]] = []

    # Table headers
    replacements += [
        ("| Crime Type |", "| ಅಪರಾಧದ ಪ್ರಕಾರ |"),
        ("| Status |", "| ಸ್ಥಿತಿ |"),
        ("| Station |", "| ಠಾಣೆ |"),
        ("| District |", "| ಜಿಲ್ಲೆ |"),
        ("| Year |", "| ವರ್ಷ |"),
        ("| Report Date |", "| ವರದಿ ದಿನಾಂಕ |"),
        ("| Legal Code |", "| ಕಾನೂನು ಕೋಡ್ |"),
        ("| Sections |", "| ಕಲಂಗಳು |"),
        ("| Count |", "| ಸಂಖ್ಯೆ |"),
    ]

    # Statuses — multi-word first
    for eng, kn in sorted(_KANNADA_STATUSES.items(), key=lambda x: -len(x[0])):
        replacements.append((eng, kn))

    # Crime types — multi-word first (use uppercase canonical form only to avoid double-hit)
    for eng, kn in sorted(_KANNADA_CRIME_TYPES.items(), key=lambda x: -len(x[0])):
        replacements.append((eng, kn))

    # Station names — longest first
    for eng, kn in sorted(_KANNADA_STATIONS.items(), key=lambda x: -len(x[0])):
        replacements.append((eng, kn))

    # Districts — longest first
    for eng, kn in sorted(_KANNADA_DISTRICTS.items(), key=lambda x: -len(x[0])):
        replacements.append((eng, kn))

    # Intro/summary boilerplate
    intro_replacements = [
        ("Found no matching records", "ಯಾವುದೇ ಹೊಂದಾಣಿಕೆಯ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ"),
        ("Showing 10 of", "10 ತೋರಿಸಲಾಗುತ್ತಿದೆ"),
        ("ask to narrow by date, status, or crime type",
         "ದಿನಾಂಕ, ಸ್ಥಿತಿ ಅಥವಾ ಅಪರಾಧದ ಪ್ರಕಾರದ ಮೂಲಕ ಸಂಕುಚಿಸಲು ಕೇಳಿ"),
    ]

    # Apply all replacements (case-sensitive whole-word where applicable)
    seen: set[str] = set()
    for eng, kn in replacements + intro_replacements:
        if eng in seen:
            continue
        seen.add(eng)
        # Use word-boundary aware replacement for short tokens to avoid
        # replacing 'Hurt' inside 'Unhurt' etc.
        if len(eng) <= 10:
            text = _re2.sub(r'\b' + _re2.escape(eng) + r'\b', kn, text)
        else:
            text = text.replace(eng, kn)

    # Generic suffix fallback for any remaining "Xyz PS" patterns not in the dict
    def _replace_station(m: _re2.Match) -> str:
        return _translate_station(m.group(0))

    text = _re2.sub(r'[A-Za-z][A-Za-z\s]+ PS\b', _replace_station, text)

    return text


async def _translate_to_kannada(
    english_answer: str,
    brain_engine: Literal["gemini", "groq", "openai", "local"] | None = None,
) -> str:
    """Second-pass: translates a fully-formed English answer into Kannada.

    Preserves Markdown formatting (tables, bold, bullets) and keeps FIR numbers
    (e.g. 0001/2025), IPC/BNS section codes, and numeric years verbatim.
    """
    system = (
        "You are a precise Kannada translator for Karnataka Police intelligence reports. "
        "Translate the provided text COMPLETELY into Kannada (ಕನ್ನಡ script). "
        "Rules:\n"
        "1. Preserve all Markdown formatting exactly: | pipe tables |, **bold**, *italic*, bullet lists, headings.\n"
        "2. Keep FIR numbers (e.g. 0001/2025), IPC/BNS/CrPC section codes (e.g. IPC 379, BNS 303), and standalone years (e.g. 2025) in their original form.\n"
        "3. Translate ALL English words — table headers, cell values, sentences, summaries, crime types, statuses, station names, district names — into Kannada.\n"
        "4. Transliterate proper nouns (person names, place names) into Kannada script if a standard translation does not exist.\n"
        "5. Output ONLY the translated text. Do not add any preamble, explanation, or commentary."
    )
    translate_prompt = (
        "Translate the following police intelligence report completely into Kannada. "
        "Preserve all markdown table formatting and FIR/IPC codes exactly as-is:\n\n"
        + english_answer
    )
    try:
        return await get_llm(brain_engine).complete(
            translate_prompt, system=system, temperature=0.1
        )
    except Exception:
        try:
            return await get_fallback_llm().complete(
                translate_prompt, system=system, temperature=0.1
            )
        except Exception:
            # Fall back to the deterministic post-processor only
            return _post_translate_kn(english_answer)


async def _compose(
    question: str,
    context: str,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq", "openai", "local"] | None = None,
    principal: "Principal | None" = None,
) -> str:
    """Grounded answer composition with Groq fallback on primary failure.

    For Kannada (lang=='kn'): generates the answer in English first (more reliable
    table/markdown output), then runs a dedicated translation pass to convert the
    complete answer to Kannada. The deterministic _post_translate_kn is applied
    last as a safety net for any values the LLM missed.
    """
    system = build_answer_system(principal)

    # D5.3 FIX: in demo/keyless mode skip the echo stub entirely.
    if get_settings().demo_mode:
        return _render_grounded(question, context, lang)

    prompt = f"Question: {question}\n\nGrounded data:\n{context}"
    try:
        english_answer = await get_llm(brain_engine).complete(
            prompt, system=system, temperature=0.2
        )
    except Exception:
        try:
            english_answer = await get_fallback_llm().complete(
                prompt, system=system, temperature=0.2
            )
        except Exception:
            english_answer = "I found the records below, but couldn't generate a summary just now."

    if lang != "kn":
        return english_answer

    # Two-pass for Kannada: translate the complete answer, then run the
    # deterministic post-processor as a safety net.
    kannada_answer = await _translate_to_kannada(english_answer, brain_engine=brain_engine)
    return _post_translate_kn(kannada_answer)


async def run(
    *,
    message: str,
    principal: Principal,
    session: AsyncSession,
    state: ConversationState,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq", "openai", "local"] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> AsyncIterator[PipelineEvent]:
    # 1) guardrails
    blocked = guardrails.precheck(message)
    if blocked:
        yield PipelineEvent("blocked", {"reason": blocked})
        yield PipelineEvent("done", {"conversation_id": state.conversation_id})
        return

    state.add_turn("user", message)

    # 2) route (uses brain LLM with per-request override)
    intent, slots = await route(message, brain_engine=brain_engine)
    state.merge_slots(slots)
    yield PipelineEvent("tool", {"name": "router", "status": "end", "detail": intent})

    citations: list[dict] = []
    context = ""
    sql_used: str | None = None
    spoken_summary = ""   # built from rows; sent as "speak" SSE event for TTS
    rows_data: list[dict] = []   # kept for deterministic spoken summary
    recovery_note: str | None = None  # set when a query had to be broadened

    try:
        if intent == "sql_query":
            yield PipelineEvent("tool", {"name": "text_to_sql", "status": "start"})
            try:
                sql_used, rows_data, recovery_note = await answer_with_sql(
                    session, message, state.slots,
                    principal=principal, history=state.turns, sql_engine=sql_engine
                )
                context = _rows_context(rows_data)
                citations = [{"ref": r.get("fir_number", str(i)), "label": "case"}
                             for i, r in enumerate(rows_data[:5]) if r.get("fir_number")]
            except UnsafeSQL as e:
                yield PipelineEvent("tool", {"name": "text_to_sql", "status": "end",
                                             "detail": f"rejected: {e}"})
                context = "[]"
            else:
                yield PipelineEvent("tool", {"name": "text_to_sql", "status": "end",
                                             "detail": sql_used})

        elif intent == "narrative_search":
            yield PipelineEvent("tool", {"name": "rag", "status": "start"})
            retrieval = await rag.retrieve_narratives(
                session, message, k=5, principal=principal
            )
            rows_data = [
                {
                    "case_id": h.case_id,
                    "text": h.text,
                    "restricted": h.restricted,
                }
                for h in retrieval.hits
            ]
            context = _rows_context(rows_data)
            # Only cite records that were actually retrieved, and never cite a
            # record whose body was withheld for clearance.
            citations = [
                {"ref": h.case_id, "label": "narrative"}
                for h in retrieval.hits
                if not h.restricted
            ]
            # The detail string must distinguish "matched nothing" from "the lane
            # could not run", which the previous f"{len(hits)} hits" could not.
            # Those two states look identical to a user but mean opposite things
            # to an operator: one is a legitimate empty result, the other is an
            # outage.
            arms_available = [
                name
                for name, ok in (
                    ("vector", retrieval.vector_available),
                    ("lexical", retrieval.lexical_available),
                )
                if ok
            ]
            if not arms_available:
                detail = "lane unavailable: no retrieval strategy could run"
            elif not retrieval.hits:
                detail = f"no matches ({'+'.join(arms_available)} ran)"
            else:
                detail = f"{retrieval.strategy}, {len(retrieval.hits)} hits"
                if retrieval.withheld_count:
                    detail += f", {retrieval.withheld_count} withheld"
            if not retrieval.vector_available:
                detail += " | vector unavailable"
            yield PipelineEvent("tool", {"name": "rag", "status": "end",
                                         "detail": detail})

        elif intent == "hotspot":
            if not principal.has(Permission.RUN_ANALYTICS):
                yield PipelineEvent("blocked", {"reason": "insufficient_permission"})
                yield PipelineEvent("done", {"conversation_id": state.conversation_id})
                return
            pts = await analytics.hotspots(
                session, crime_type=state.slots.get("crime_type"),
                district=state.slots.get("district"),
            )
            context = _rows_context(pts)
            yield PipelineEvent("tool", {"name": "analytics.hotspots", "status": "end",
                                         "detail": f"{len(pts)} cells"})

        elif intent == "network":
            person = state.slots.get("person")
            if person:
                victim_framed = any(w in message.lower() for w in ("against", "victim", "targeted", "attacked"))
                if victim_framed:
                    nodes, edges = await analytics.victim_offender_network(session, person_id=person)
                else:
                    nodes, edges = await analytics.ego_network(session, person_id=person)
                context = json.dumps({"nodes": nodes, "edges": edges}, default=str)
                yield PipelineEvent("citation", {"ref": f"/network?seed={person}", "label": "Open network"})
            yield PipelineEvent("tool", {"name": "analytics.network", "status": "end"})

        elif intent == "report":
            context = json.dumps({"note": "Use the Reports panel to build a document."})

        else:  # smalltalk — let the LLM answer conversationally with full context
            # Don't pass a data stub; compose directly so Gemini can use its world
            # knowledge + the officer's identity from the system prompt.
            system = build_answer_system(principal)
            if get_settings().demo_mode:
                if lang == "kn":
                    answer = (
                        "ನಮಸ್ಕಾರ! ನಾನು ಸತ್ಯಂ, ಕೆಎಸ್‌ಪಿ ಅಪರಾಧ-ಗುಪ್ತಚರ ಸಹಾಯಕ. "
                        "ಅಪರಾಧ ಅಂಕಿಅಂಶಗಳು, ಎಫ್‌ಐಆರ್‌ಗಳು, ಹಾಟ್‌ಸ್ಪಾಟ್‌ಗಳು ಅಥವಾ ಶಂಕಿತ ನೆಟ್‌ವರ್ಕ್‌ಗಳ ಬಗ್ಗೆ ನನ್ನನ್ನು ಕೇಳಿ."
                    )
                else:
                    answer = (
                        f"Hello! I'm Satyam, the KSP crime-intelligence assistant. "
                        f"Ask me about crime statistics, FIRs, hotspots, or suspect networks."
                    )
            else:
                lang_directive = (
                    " Respond entirely in Kannada (ಕನ್ನಡ)." if lang == "kn" else ""
                )
                try:
                    answer = await get_llm(brain_engine).complete(
                        message + lang_directive, system=system, temperature=0.3
                    )
                except Exception:
                    try:
                        answer = await get_fallback_llm().complete(
                            message + lang_directive, system=system, temperature=0.3
                        )
                    except Exception:
                        if lang == "kn":
                            answer = (
                                "ನಾನು ಸತ್ಯಂ, ಕೆಎಸ್‌ಪಿ ಅಪರಾಧ-ಗುಪ್ತಚರ ಸಹಾಯಕ. "
                                "ಅಪರಾಧ ಅಂಕಿಅಂಶಗಳು, ಎಫ್‌ಐಆರ್‌ಗಳು, ಹಾಟ್‌ಸ್ಪಾಟ್‌ಗಳು ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ಗಳ ಬಗ್ಗೆ ನನ್ನನ್ನು ಕೇಳಿ."
                            )
                        else:
                            answer = (
                                "I'm Satyam, the KSP crime-intelligence assistant. "
                                "Ask me about crime statistics, FIRs, hotspots, or networks."
                            )
            for chunk in answer.split(" "):
                yield PipelineEvent("token", {"text": chunk + " "})
            state.add_turn("assistant", answer)
            yield PipelineEvent("done", {"conversation_id": state.conversation_id})
            return

        # 3) compose grounded answer (token stream)
        answer = await _compose(message, context, lang, brain_engine=brain_engine, principal=principal)

        # Deterministic post-translation: guarantee Kannada cell values regardless of
        # whether the LLM followed its translation directive.
        if lang == "kn":
            answer = _post_translate_kn(answer)

        # Prepend a recovery note when the query was auto-broadened, so the
        # officer understands why these results (not an empty dead-end) appear.
        if recovery_note and rows_data:
            answer = f"*{recovery_note}*\n\n{answer}"

        # Build the spoken summary two ways and take the best one:
        # (a) Deterministic — built directly from rows, always available.
        # (b) LLM tag — Gemini may have wrapped [SPEAK]...[/SPEAK] in its answer.
        # Prefer (b) when it exists (more contextual), fall back to (a).
        gemini_spoken, display_answer = _extract_speak(answer)
        if gemini_spoken:
            spoken_summary = gemini_spoken
        else:
            # Gemini didn't include the tag (demo mode, or it forgot) —
            # build it deterministically from the raw rows.
            display_answer = answer
            spoken_summary = _build_spoken_summary(rows_data, message, lang=lang)

        if spoken_summary:
            yield PipelineEvent("speak", {"text": spoken_summary})
        for chunk in display_answer.split(" "):
            yield PipelineEvent("token", {"text": chunk + " "})
        for c in citations:
            yield PipelineEvent("citation", c)
        state.add_turn("assistant", display_answer)

    except Exception as e:  # noqa: BLE001
        # Distinguish a genuine guardrail/safety block (carries a `reason`) from
        # an unexpected failure (DB/LLM/tool error). Only the former should tell
        # the user a safety filter fired; the latter is logged and reported as a
        # generic error instead of being silently mislabeled.
        reason = getattr(e, "reason", None)
        if reason is not None:
            msg = guardrails.safety_fallback(reason)
        else:
            log.exception("pipeline.unexpected_error", exc_info=e)
            msg = (
                "Sorry — something went wrong while answering that. "
                "Please try rephrasing, or try again in a moment."
            )
        yield PipelineEvent("token", {"text": msg})

    yield PipelineEvent("done", {"conversation_id": state.conversation_id})
