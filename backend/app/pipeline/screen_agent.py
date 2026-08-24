"""screen_agent.py — Voice Screen Agent brain.

This is the "strongest logic" layer that lets the top-right voice copilot
understand a free-form spoken command and turn it into:

  1. a TARGET SCREEN to navigate to (any of Satyam's routes), AND
  2. one or more IN-SCREEN ACTIONS to automate on that screen
     (set a filter, run a search, generate a report, switch a tab, etc.)

Design goals
------------
- The LLM is given a COMPLETE capability manifest of every screen and every
  action it can perform, with typed parameters. This is what makes the agent
  "clearly understand" the officer's request.
- The model returns a strict JSON ActionPlan validated by Pydantic.
- A deterministic rule-based planner (`_rule_plan`) guarantees the agent still
  works with NO LLM (demo mode / 429 / offline) — bilingual EN + KN.
- Output is screen-agnostic: each frontend screen receives the structured
  `actions` array via the `satyam:run-task` event and executes them.

The frontend never trusts free text — it only executes actions from the
allow-listed ACTION registry below, so this is safe by construction.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal, Optional

from app.models.registry import get_llm

log = logging.getLogger(__name__)

# ════════════════════════════════════════════════════════════════════════════
# CAPABILITY MANIFEST
# Every screen + the actions the agent may perform on it. Each action lists its
# parameters so the LLM knows exactly what to emit. The frontend has a matching
# handler for each (screen, action) pair.
# ════════════════════════════════════════════════════════════════════════════

SCREEN_CAPABILITIES: dict[str, dict] = {
    # Chat moved to /ask. The Console is now a KPI dashboard built on a crime map,
    # so `ask` and `new_chat` were removed — leaving them here would let the LLM
    # emit actions the screen silently drops, which looks like the agent ignoring
    # the officer.
    "/console": {
        "name": "Dashboard (crime intelligence overview: KPIs, heatmap, station performance)",
        "keywords": ["console", "dashboard", "overview", "crime intelligence", "kpi", "clearance", "stations"],
        "kn": ["ಕನ್ಸೋಲ್", "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್"],
        "actions": {
            "show_on_map": {"desc": "Focus the map on a person's crime locations", "params": {"person": "string"}},
            "set_map_mode": {"desc": "Switch map render mode", "params": {"mode": "heat|pins|grid"}},
            "set_district": {"desc": "Filter the whole dashboard to one district", "params": {"district": "string"}},
            "set_crime_type": {"desc": "Filter the whole dashboard to one crime type", "params": {"crime_type": "string"}},
        },
    },
    "/ask": {
        "name": "Ask Satyam (dedicated AI chat)",
        "keywords": ["ask satyam", "chat", "assistant", "conversation", "ask", "query"],
        "kn": ["ಸಂಭಾಷಣೆ", "ಚಾಟ್"],
        "actions": {
            "ask": {"desc": "Type a question into chat and send it", "params": {"text": "string"}},
            "new_chat": {"desc": "Start a new conversation", "params": {}},
        },
    },
    "/network": {
        "name": "Network (link analysis graph)",
        "keywords": ["network", "graph", "ego", "link", "links", "connections", "associates", "ring", "rings"],
        "kn": ["ನೆಟ್‌ವರ್ಕ್", "ಸಂಪರ್ಕ"],
        "actions": {
            "search_seed": {"desc": "Search the graph for a person/entity", "params": {"entity": "string"}},
            "set_depth": {"desc": "Set hop depth of the graph (1-3)", "params": {"depth": "number"}},
            "set_link_mode": {"desc": "Switch graph mode", "params": {"mode": "people|financial|rings"}},
            "filter_edge": {"desc": "Filter edges by relationship type", "params": {"value": "string"}},
            "filter_community": {"desc": "Filter to a community/crime type", "params": {"value": "string"}},
        },
    },
    "/reports": {
        "name": "Report Builder",
        "keywords": ["report", "reports", "brief", "pdf", "document", "dossier"],
        "kn": ["ವರದಿ"],
        "actions": {
            "add_case": {"desc": "Search and add a FIR/case to the report cart", "params": {"query": "string"}},
            "set_title": {"desc": "Set the report title", "params": {"title": "string"}},
            "set_template": {"desc": "Choose a report template", "params": {"template": "brief|court|digest|person"}},
            "clear": {"desc": "Empty the report cart", "params": {}},
            "generate": {"desc": "Generate the PDF report", "params": {}},
            "print": {"desc": "Print the report", "params": {}},
        },
    },
    "/forecast": {
        "name": "Early Warning & Forecast",
        "keywords": ["forecast", "early warning", "predict", "risk grid", "hotspot forecast", "alerts"],
        "kn": ["ಮುನ್ಸೂಚನೆ", "ಎಚ್ಚರಿಕೆ"],
        "actions": {
            "set_crime_type": {"desc": "Filter forecast by crime type", "params": {"crime_type": "string"}},
            "set_district": {"desc": "Filter forecast by district", "params": {"district": "string"}},
            "set_horizon": {"desc": "Set forecast horizon in days", "params": {"days": "3|7|14|30"}},
            "set_grid": {"desc": "Set grid resolution", "params": {"grid": "fine|med|coarse"}},
            "set_severity": {"desc": "Filter alerts by risk level", "params": {"level": "All|Critical|High|Medium|Low"}},
            "refresh": {"desc": "Reload forecast data", "params": {}},
            "toggle_auto": {"desc": "Toggle 60s auto-refresh", "params": {}},
        },
    },
    "/trends": {
        "name": "Trends & MO Clustering",
        "keywords": ["trends", "patterns", "time series", "seasonal", "mo cluster", "modus"],
        "kn": ["ಪ್ರವೃತ್ತಿ", "ಮಾದರಿ"],
        "actions": {
            "set_crime_type": {"desc": "Filter trends by crime type", "params": {"crime_type": "string"}},
            "set_district": {"desc": "Filter trends by district", "params": {"district": "string"}},
            "set_granularity": {"desc": "Set time granularity", "params": {"granularity": "week|month|quarter"}},
        },
    },
    "/board": {
        "name": "Investigation Board (canvas)",
        "keywords": ["board", "canvas", "whiteboard", "link chart", "crime board", "scene"],
        "kn": ["ಬೋರ್ಡ್", "ಕ್ಯಾನ್ವಾಸ್"],
        "actions": {
            "generate_scene": {"desc": "Generate a scene diagram from a description", "params": {"prompt": "string"}},
            "save": {"desc": "Save the current board", "params": {}},
            "new": {"desc": "Clear the board / start new", "params": {}},
            "export": {"desc": "Export the board as PNG", "params": {}},
        },
    },
    "/audit": {
        "name": "Audit Log",
        "keywords": ["audit", "compliance", "chain", "logs", "log"],
        "kn": ["ಆಡಿಟ್"],
        "actions": {
            "search": {"desc": "Search the audit log", "params": {"query": "string"}},
            "filter_action": {"desc": "Filter by ALLOW/DENY", "params": {"action": "string"}},
        },
    },
    "/dossier": {
        "name": "Person 360 Dossier",
        "keywords": ["dossier", "person 360", "360", "fingerprint", "profile of"],
        "kn": ["ಡಾಸಿಯರ್"],
        "actions": {
            "search": {"desc": "Search a person by name/district", "params": {"query": "string"}},
        },
    },
    "/operations": {
        "name": "Live Operations Map",
        "keywords": ["operations", "live ops", "live map", "response ops"],
        "kn": ["ಕಾರ್ಯಾಚರಣೆ"],
        "actions": {},
    },
    "/vision": {
        "name": "Vision (3D tactical map: crime density, patrols, CCTV, globe)",
        "keywords": [
            "vision", "tactical map", "tactical view", "3d map", "globe", "earth",
            "thermal", "night vision", "hexagon", "density",
        ],
        "kn": ["ವಿಷನ್", "ತಂತ್ರಾತ್ಮಕ ನಕ್ಷೆ", "ಭೂಗೋಳ"],
        "actions": {
            "set_view": {
                "desc": "Switch projection/camera: flat 2D, tilted 3D, or the Earth globe",
                "params": {"mode": "2d|3d|earth"},
            },
            "set_treatment": {
                "desc": "Apply a visual treatment to the map",
                "params": {"name": "standard|crt|nvg|flir|radar|satcom|noir"},
            },
            "set_basemap": {
                "desc": "Change the base imagery",
                "params": {"basemap": "dark|street|satellite|nightlights"},
            },
            "toggle_layer": {
                "desc": "Show or hide one intelligence layer",
                "params": {
                    "layer": "crime_hex|risk_zones|patrols|dispatches|signals|cameras|environment",
                    "on": "boolean",
                },
            },
            "set_hex_radius": {
                "desc": "Set the crime-density bin radius in metres",
                "params": {"radius_m": "50|100|500|1000"},
            },
        },
    },
    "/ops-predictive": {
        "name": "Predictive Deployment",
        "keywords": ["predictive deployment", "deployment", "patrol suggestion"],
        "kn": ["ಭವಿಷ್ಯಸೂಚಕ ನಿಯೋಜನೆ"],
        "actions": {"recompute": {"desc": "Recompute deployment suggestions", "params": {}}},
    },
    "/ops-dispatch": {
        "name": "Dispatch & Green Corridor",
        "keywords": ["dispatch", "green corridor", "corridor"],
        "kn": [],
        "actions": {},
    },
    "/ops-camera": {
        "name": "Camera Review (YOLO)",
        "keywords": ["camera", "cctv", "review", "yolo"],
        "kn": ["ಕ್ಯಾಮೆರಾ"],
        "actions": {"start": {"desc": "Start the camera feed", "params": {}}, "stop": {"desc": "Stop the camera feed", "params": {}}},
    },
    "/transcripts": {
        "name": "Transcripts & History",
        "keywords": ["transcripts", "transcript", "recordings", "history"],
        "kn": ["ಪ್ರತಿಲೇಖನ"],
        "actions": {"search_similar": {"desc": "Find similar cases by description", "params": {"description": "string"}}},
    },
    "/admin": {
        "name": "Access Control (L4)",
        "keywords": ["access control", "admin", "user policy", "clearance control"],
        "kn": [],
        "actions": {"search": {"desc": "Search users", "params": {"query": "string"}}},
    },
}

# ════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT — teaches the LLM the full manifest so it understands ANY request
# ════════════════════════════════════════════════════════════════════════════

def _manifest_text() -> str:
    """Render the capability manifest as compact text for the system prompt."""
    lines: list[str] = []
    for route, spec in SCREEN_CAPABILITIES.items():
        lines.append(f"\nSCREEN {route}  «{spec['name']}»")
        kw = ", ".join(spec["keywords"][:8])
        lines.append(f"  triggers: {kw}")
        if not spec["actions"]:
            lines.append("  actions: (navigation only)")
            continue
        for act, meta in spec["actions"].items():
            params = ", ".join(f"{k}:{v}" for k, v in meta["params"].items()) or "—"
            lines.append(f"  action '{act}' — {meta['desc']} | params: {params}")
    return "\n".join(lines)


AGENT_SYSTEM = (
    "You are Satyam's Voice Screen Agent for Karnataka State Police officers. "
    "An officer speaks a command. You must understand the INTENT and produce a "
    "JSON ActionPlan that (a) navigates to the correct screen and (b) performs "
    "the in-screen actions they asked for.\n\n"
    "You control this application. Here is EXACTLY what each screen can do:\n"
    f"{_manifest_text()}\n\n"
    "RULES:\n"
    "1. Pick ONE target `route` that best matches the request. If the officer is "
    "already on the right screen and only asks for an action, keep that route.\n"
    "2. Emit an `actions` array. Each item = {\"screen\": <route>, \"action\": <name>, "
    "\"params\": {...}}. Only use actions and params from the manifest above.\n"
    "3. Extract real values from the command: crime types, districts, person names, "
    "numbers, FIR ids. Put them in params. Do NOT invent values not implied.\n"
    "4. Multiple actions are allowed (e.g. set district AND set horizon AND refresh). "
    "Order them logically.\n"
    "5. `speak` = a short one-sentence confirmation in the officer's language of what "
    "you are doing. Be specific (mention the screen + action).\n"
    "6. If it's purely a data question (not navigation/automation), set route=null, "
    "actions=[], and answer=true so the chat brain handles it.\n"
    "7. Keep proper nouns (names, FIR ids, districts, IPC) verbatim. Never translate them.\n"
    "8. NEVER copy instruction or placeholder words into a param. If the officer asks for "
    "ANY / A RANDOM / SOME / A SAMPLE / AN EXAMPLE value of an entity WITHOUT naming a "
    "specific one, set that param to the EXACT sentinel token below — the system replaces "
    "it with a real value from the database:\n"
    "   • a person / suspect / accused / seed entity  → \"__SAMPLE_PERSON__\"\n"
    "   • a district                                  → \"__SAMPLE_DISTRICT__\"\n"
    "   • a crime type                                → \"__SAMPLE_CRIME__\"\n"
    "   • a FIR / case                                → \"__SAMPLE_FIR__\"\n"
    "   • a police station                            → \"__SAMPLE_STATION__\"\n"
    "   Example: \"seed any person in the network\" → "
    "{\"screen\":\"/network\",\"action\":\"search_seed\",\"params\":{\"entity\":\"__SAMPLE_PERSON__\"}}\n"
    "9. Respond with ONLY the JSON object. No markdown, no commentary.\n"
)

AGENT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "route": {"type": "string"},
        "answer": {"type": "boolean"},
        "speak": {"type": "string"},
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "screen": {"type": "string"},
                    "action": {"type": "string"},
                    "params": {"type": "object"},
                },
                "required": ["screen", "action"],
            },
        },
    },
    "required": ["actions"],
}

# ════════════════════════════════════════════════════════════════════════════
# DETERMINISTIC FALLBACK PLANNER (no LLM) — bilingual EN + KN
# ════════════════════════════════════════════════════════════════════════════

_NAV_VERBS = re.compile(
    r"\b(open|show|go to|goto|navigate|take me to|switch to|jump to|bring up|launch)\b"
    r"|ತೆರೆ|ಹೋಗು|ತೋರಿಸಿ|ಗೆ ಹೋಗಿ",
    re.IGNORECASE,
)

# Known Karnataka districts (subset) for slot extraction
_DISTRICTS = [
    "Bengaluru City", "Bengaluru", "Bengaluru Rural", "Mysuru", "Mangaluru",
    "Dakshina Kannada", "Belagavi", "Kalaburagi", "Hubballi-Dharwad", "Ballari",
    "Udupi", "Shivamogga", "Tumakuru", "Davanagere", "Vijayapura", "Hassan",
    "Mandya", "Chitradurga", "Kolar", "Raichur", "Bidar", "Koppal", "Haveri",
]

# Crime types → canonical
_CRIMES = [
    "theft", "murder", "assault", "robbery", "burglary", "fraud", "cheating",
    "kidnapping", "riot", "cyber crime", "cybercrime", "dowry", "hurt",
    "extortion", "narcotics", "rape", "molestation", "chain snatching",
    "forgery", "arson", "dacoity", "harassment", "stalking",
]


def _detect_route(text: str, current_route: Optional[str]) -> Optional[str]:
    """Match the command to a screen route by keyword (EN + KN).

    Screens share vocabulary, so raw keyword scores collide. "show cameras" scores
    /ops-camera highly, but an officer already looking at the Vision map who says
    it wants the camera LAYER, not a different screen.

    So before scoring screens, we ask whether the command names something the
    CURRENT screen can already do, using that screen's own action vocabulary from
    the manifest. If it does, we stay. This is derived from the manifest rather
    than hardcoded, so every screen gets it for free and it cannot drift out of
    sync with the declared actions. Explicitly naming another screen still wins,
    because a screen name is not in another screen's action vocabulary.
    """
    low = text.lower()

    if current_route and _in_screen_command(current_route, low):
        return current_route

    scores: dict[str, int] = {}
    for route, spec in SCREEN_CAPABILITIES.items():
        score = 0
        for kw in spec["keywords"]:
            if kw in low:
                score += len(kw)  # longer keyword = stronger match
        for kw in spec.get("kn", []):
            if kw in text:
                score += 4
        if score:
            scores[route] = score

    if not scores:
        return current_route
    return max(scores, key=lambda r: scores[r])


# Enum values shorter than this, or in this stoplist, are too generic to prove a
# command is about the current screen.
_VOCAB_MIN_LEN = 4
_VOCAB_STOPLIST = frozenset({"dark", "normal", "standard", "none", "true", "false", "boolean"})


def _screen_action_vocab(route: str) -> frozenset[str]:
    """Distinctive words the manifest says this screen's actions accept.

    Built from the param enums (e.g. "2d|3d|earth", the layer ids), not from the
    action names, which are snake_case identifiers an officer never says aloud.
    """
    spec = SCREEN_CAPABILITIES.get(route) or {}
    vocab: set[str] = set()
    for meta in (spec.get("actions") or {}).values():
        for ptype in (meta.get("params") or {}).values():
            if not isinstance(ptype, str) or "|" not in ptype:
                continue
            for opt in ptype.split("|"):
                opt = opt.strip().lower()
                if len(opt) < _VOCAB_MIN_LEN or opt in _VOCAB_STOPLIST or opt.isdigit():
                    continue
                vocab.add(opt)
                if "_" in opt:
                    vocab.add(opt.replace("_", " "))
    return frozenset(vocab)


def _in_screen_command(route: str, low: str) -> bool:
    """Does this command name something the current screen can already do?

    ponytail: exact substring match on the manifest's enum values. It therefore
    misses inflections — on /vision, "hide cameras" sticks (the layer id is
    `cameras`) but "hide the camera layer" routes to /ops-camera, because
    `camera` is that screen's own keyword. Adding naive singular stems fixes the
    miss but breaks the opposite case ("open the camera review screen" would then
    stick to /vision), so the ceiling is left in place deliberately. Upgrade path
    is a real stemmer or per-action trigger phrases in the manifest, not more
    substring rules.
    """
    return any(v in low for v in _screen_action_vocab(route))


def _extract_crime(text: str) -> Optional[str]:
    low = text.lower()
    for c in _CRIMES:
        if c in low:
            return "Cyber Crime" if c in ("cyber crime", "cybercrime") else c.title()
    return None


def _extract_district(text: str) -> Optional[str]:
    for d in _DISTRICTS:
        if d.lower() in text.lower():
            return d
    return None


def _extract_number(text: str, lo: int, hi: int) -> Optional[int]:
    for m in re.findall(r"\b(\d{1,3})\b", text):
        n = int(m)
        if lo <= n <= hi:
            return n
    return None


def _strip_to_value(text: str) -> str:
    """Remove nav verbs + screen keywords to isolate a free-text value (name/FIR)."""
    out = _NAV_VERBS.sub(" ", text)
    for spec in SCREEN_CAPABILITIES.values():
        for kw in spec["keywords"]:
            out = re.sub(rf"\b{re.escape(kw)}\b", " ", out, flags=re.IGNORECASE)
    out = re.sub(
        r"\b(the|to|of|for|in|on|and|a|me|please|screen|page|tab|view|search|find|"
        r"show|open|set|filter|by|with|this|that)\b",
        " ", out, flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", out).strip()


# ════════════════════════════════════════════════════════════════════════════
# SAMPLE-VALUE RESOLUTION
# When the officer asks for "any / a random / some / sample" entity instead of
# naming a specific one (e.g. "seed any person", "filter to some district"),
# the planner must NOT copy those instruction words into the field. Instead it
# emits a typed SENTINEL, which `resolve_samples()` later replaces with a REAL
# value pulled from the (RLS-scoped) database. This makes the copilot behave
# like a real assistant on every screen, not a literal text-inserter.
# ════════════════════════════════════════════════════════════════════════════

SAMPLE_PERSON = "__SAMPLE_PERSON__"
SAMPLE_DISTRICT = "__SAMPLE_DISTRICT__"
SAMPLE_CRIME = "__SAMPLE_CRIME__"
SAMPLE_FIR = "__SAMPLE_FIR__"
SAMPLE_STATION = "__SAMPLE_STATION__"
_ALL_SENTINELS = {SAMPLE_PERSON, SAMPLE_DISTRICT, SAMPLE_CRIME, SAMPLE_FIR, SAMPLE_STATION}

# Words that signal "no specific value given" — a placeholder, not real data.
_VAGUE_TOKENS = {
    "any", "a", "an", "some", "random", "sample", "example", "person", "persons",
    "people", "name", "names", "entity", "suspect", "victim", "accused", "someone",
    "somebody", "anyone", "anybody", "anything", "thing", "the", "of", "whatever",
    "one", "individual", "guy", "here", "there", "search", "from", "database", "db",
    "for", "find", "show", "me", "named", "called", "in",
}

# Strong placeholder keywords — if a value contains ANY of these it is a request
# for a sample, not a real value. Real person/place/FIR values never contain
# these words, so this is high-precision.
_STRONG_VAGUE = re.compile(
    r"\b(any|anyone|anybody|someone|somebody|some|random|sample|example|whatever|"
    r"a\s+person|a\s+suspect|a\s+victim|a\s+name)\b",
    re.IGNORECASE,
)


def _is_vague(val: Optional[str]) -> bool:
    """True when a param value carries no real data — empty, contains a strong
    placeholder keyword ('any', 'random', 'sample', 'some'…), or is made up
    entirely of filler/instruction words like 'a person's name'."""
    if not val or not val.strip():
        return True
    low = val.lower()
    # Strong keyword anywhere → it's a "give me a sample" request, not real data.
    if _STRONG_VAGUE.search(low):
        return True
    # Strip possessive 's so "person's" → "person", then check token-by-token.
    low = low.replace("'s", " ").replace("\u2019s", " ")
    words = [w for w in re.findall(r"[a-z]+", low) if len(w) > 1 or w == "a"]
    if not words:
        return True
    return all(w in _VAGUE_TOKENS for w in words)


def _sentinel_for(screen: Optional[str], action: Optional[str], key: str) -> Optional[str]:
    """Which sample sentinel fits a given (screen, action, param) slot."""
    if key == "district":
        return SAMPLE_DISTRICT
    if key == "crime_type":
        return SAMPLE_CRIME
    if key in ("entity", "person"):
        return SAMPLE_PERSON
    if screen == "/dossier" and action == "search" and key == "query":
        return SAMPLE_PERSON
    if screen == "/reports" and action == "add_case" and key == "query":
        return SAMPLE_FIR
    return None


def _normalize_samples(actions: list[dict]) -> list[dict]:
    """Replace vague placeholder param values with the right sample sentinel so
    they can be resolved to real DB values. Leaves concrete values untouched."""
    for a in actions or []:
        screen = a.get("screen")
        action = a.get("action")
        params = a.get("params") or {}
        for k, v in list(params.items()):
            if not isinstance(v, str):
                continue
            if v in _ALL_SENTINELS:
                continue  # LLM already emitted a sentinel — keep it
            if _is_vague(v):
                sent = _sentinel_for(screen, action, k)
                if sent:
                    params[k] = sent
        a["params"] = params
    return actions


# SQL used to fetch a real, well-connected sample for each sentinel. Person and
# district/crime prefer the most-connected/most-frequent value so the resulting
# screen is interesting (a hub person yields a rich network graph). All queries
# run on the RLS-scoped session, so samples stay within the officer's scope.
_SAMPLE_SQL = {
    SAMPLE_PERSON: (
        "SELECT p.name FROM persons p "
        "JOIN case_persons cp ON cp.person_id = p.person_id "
        "JOIN cases c ON c.case_id = cp.case_id "
        "WHERE p.name IS NOT NULL "
        "GROUP BY p.person_id, p.name ORDER BY COUNT(*) DESC LIMIT 1"
    ),
    SAMPLE_DISTRICT: (
        "SELECT district FROM cases WHERE district IS NOT NULL "
        "GROUP BY district ORDER BY COUNT(*) DESC LIMIT 1"
    ),
    SAMPLE_CRIME: (
        "SELECT crime_type FROM cases WHERE crime_type IS NOT NULL "
        "GROUP BY crime_type ORDER BY COUNT(*) DESC LIMIT 1"
    ),
    SAMPLE_FIR: "SELECT fir_number FROM cases WHERE fir_number IS NOT NULL ORDER BY random() LIMIT 1",
    SAMPLE_STATION: "SELECT station_name FROM stations ORDER BY random() LIMIT 1",
}


async def _fetch_sample(sentinel: str, session) -> Optional[str]:
    """Resolve one sentinel to a real value from the DB (RLS-scoped)."""
    from sqlalchemy import text as _sql_text
    sql = _SAMPLE_SQL.get(sentinel)
    if not sql:
        return None
    try:
        row = (await session.execute(_sql_text(sql))).first()
        return str(row[0]) if row and row[0] is not None else None
    except Exception as exc:  # noqa: BLE001
        log.warning("screen_agent sample resolve failed for %s: %s", sentinel, exc)
        return None


async def resolve_samples(actions: list[dict], session) -> list[dict]:
    """Replace any sample sentinels in the action params with real DB values.
    Called by the /voice/agent route with the caller's RLS-scoped session.
    If a value cannot be resolved, the placeholder param is dropped so the
    frontend never receives an instruction phrase as data."""
    cache: dict[str, Optional[str]] = {}
    for a in actions or []:
        params = a.get("params") or {}
        for k, v in list(params.items()):
            if isinstance(v, str) and v in _ALL_SENTINELS:
                if v not in cache:
                    cache[v] = await _fetch_sample(v, session)
                resolved = cache[v]
                if resolved:
                    params[k] = resolved
                else:
                    params.pop(k, None)  # avoid leaking a sentinel/placeholder
        a["params"] = params
    return actions


def _rule_plan(command: str, current_route: Optional[str], lang: str) -> dict:
    """Best-effort structured plan without any LLM call."""
    text = command.strip()
    low = text.lower()
    route = _detect_route(text, current_route)
    actions: list[dict] = []
    kn = lang == "kn"

    crime = _extract_crime(text)
    district = _extract_district(text)

    if route == "/forecast":
        if crime:
            actions.append({"screen": route, "action": "set_crime_type", "params": {"crime_type": crime}})
        if district:
            actions.append({"screen": route, "action": "set_district", "params": {"district": district}})
        days = _extract_number(text, 1, 30)
        if days in (3, 7, 14, 30):
            actions.append({"screen": route, "action": "set_horizon", "params": {"days": days}})
        if any(w in low for w in ("critical", "high", "medium", "low")):
            lvl = next(w for w in ("Critical", "High", "Medium", "Low") if w.lower() in low)
            actions.append({"screen": route, "action": "set_severity", "params": {"level": lvl}})
        if "refresh" in low or "reload" in low:
            actions.append({"screen": route, "action": "refresh", "params": {}})

    elif route == "/network":
        val = _strip_to_value(text)
        if val:
            actions.append({"screen": route, "action": "search_seed", "params": {"entity": val}})
        depth = _extract_number(text, 1, 3)
        if depth:
            actions.append({"screen": route, "action": "set_depth", "params": {"depth": depth}})
        if "financial" in low or "money" in low:
            actions.append({"screen": route, "action": "set_link_mode", "params": {"mode": "financial"}})
        elif "ring" in low:
            actions.append({"screen": route, "action": "set_link_mode", "params": {"mode": "rings"}})

    elif route == "/reports":
        if "generate" in low or "create pdf" in low or "make report" in low:
            actions.append({"screen": route, "action": "generate", "params": {}})
        elif "print" in low:
            actions.append({"screen": route, "action": "print", "params": {}})
        elif "clear" in low:
            actions.append({"screen": route, "action": "clear", "params": {}})
        else:
            val = _strip_to_value(text)
            if val:
                actions.append({"screen": route, "action": "add_case", "params": {"query": val}})

    elif route == "/trends":
        if crime:
            actions.append({"screen": route, "action": "set_crime_type", "params": {"crime_type": crime}})
        if district:
            actions.append({"screen": route, "action": "set_district", "params": {"district": district}})
        for g in ("week", "month", "quarter"):
            if g in low:
                actions.append({"screen": route, "action": "set_granularity", "params": {"granularity": g}})
                break

    elif route == "/board":
        if "generate" in low or "draw" in low or "create" in low or "scene" in low:
            prompt = _strip_to_value(text)
            actions.append({"screen": route, "action": "generate_scene", "params": {"prompt": prompt or text}})
        elif "save" in low:
            actions.append({"screen": route, "action": "save", "params": {}})
        elif "export" in low:
            actions.append({"screen": route, "action": "export", "params": {}})

    elif route == "/vision":
        # Deterministic fallback so Vision stays voice-drivable with planner="rule"
        # and whenever the LLM lane is unavailable. Bilingual: the Kannada terms
        # are the ones an officer actually says, transliterated.
        if any(w in low for w in ("earth", "globe", "planet")) or "ಭೂಗೋಳ" in text:
            actions.append({"screen": route, "action": "set_view", "params": {"mode": "earth"}})
        elif "3d" in low or "three d" in low or "tilt" in low or "ತ್ರಿಡಿ" in text:
            actions.append({"screen": route, "action": "set_view", "params": {"mode": "3d"}})
        elif "2d" in low or "flat" in low or "top down" in low:
            actions.append({"screen": route, "action": "set_view", "params": {"mode": "2d"}})

        treatments = {
            "thermal": "flir", "flir": "flir", "heat vision": "flir",
            "night vision": "nvg", "nvg": "nvg", "night mode": "nvg",
            "crt": "crt", "scanline": "crt",
            "radar": "radar", "sweep": "radar",
            "satcom": "satcom",
            "noir": "noir", "monochrome": "noir", "black and white": "noir",
            "standard": "standard", "normal": "standard",
        }
        for phrase, tid in treatments.items():
            if phrase in low:
                actions.append(
                    {"screen": route, "action": "set_treatment", "params": {"name": tid}}
                )
                break
        else:
            if "ಥರ್ಮಲ್" in text:
                actions.append(
                    {"screen": route, "action": "set_treatment", "params": {"name": "flir"}}
                )

        basemaps = {
            "satellite": "satellite", "imagery": "satellite",
            "night lights": "nightlights", "nightlights": "nightlights",
            "street": "street", "road": "street",
            "dark": "dark",
        }
        for phrase, bid in basemaps.items():
            if phrase in low:
                actions.append(
                    {"screen": route, "action": "set_basemap", "params": {"basemap": bid}}
                )
                break

        layer_words = {
            "crime_hex": ("crime", "density", "hotspot", "hexagon", "ಅಪರಾಧ"),
            "risk_zones": ("risk", "zone", "ಅಪಾಯ"),
            "patrols": ("patrol", "unit", "hoysala", "ಗಸ್ತು"),
            "dispatches": ("dispatch", "route", "corridor"),
            "signals": ("signal", "junction", "traffic"),
            "cameras": ("camera", "cctv", "ಕ್ಯಾಮೆರಾ"),
            "environment": ("weather", "rain", "wind", "environment"),
        }
        # "hide"/"off" must be checked before "show", because "don't show" contains
        # "show" and would otherwise be read as a request to display the layer.
        turning_off = any(w in low for w in ("hide", "turn off", "remove", "without", "ಮರೆಮಾಡು"))
        wants_layer = turning_off or any(
            w in low for w in ("show", "display", "turn on", "add", "ತೋರಿಸಿ")
        )
        if wants_layer:
            for lid, words in layer_words.items():
                if any(w in low or w in text for w in words):
                    actions.append(
                        {
                            "screen": route,
                            "action": "toggle_layer",
                            "params": {"layer": lid, "on": not turning_off},
                        }
                    )
                    break

        radius = _extract_number(text, 50, 1000)
        if radius in (50, 100, 500, 1000):
            actions.append(
                {"screen": route, "action": "set_hex_radius", "params": {"radius_m": radius}}
            )

    elif route in ("/audit", "/dossier", "/admin"):
        val = _strip_to_value(text)
        if val:
            actions.append({"screen": route, "action": "search", "params": {"query": val}})

    elif route == "/ask":
        val = _strip_to_value(text)
        if val and not _NAV_VERBS.search(text):
            actions.append({"screen": route, "action": "ask", "params": {"text": text}})

    elif route == "/console":
        # Dashboard filters. No `ask` here — the Console has no composer.
        if crime:
            actions.append({"screen": route, "action": "set_crime_type", "params": {"crime_type": crime}})
        if district:
            actions.append({"screen": route, "action": "set_district", "params": {"district": district}})
        for mode in ("heat", "pins", "grid"):
            if mode in low:
                actions.append({"screen": route, "action": "set_map_mode", "params": {"mode": mode}})
                break

    # Build the spoken confirmation
    name = SCREEN_CAPABILITIES.get(route or "", {}).get("name", route or "")
    if route and actions:
        speak = (f"{name} ತೆರೆದು ಕಾರ್ಯ ನಿರ್ವಹಿಸಲಾಗುತ್ತಿದೆ" if kn
                 else f"Opening {name} and applying your request.")
    elif route:
        speak = (f"{name} ತೆರೆಯಲಾಗುತ್ತಿದೆ" if kn else f"Opening {name}.")
    else:
        # Pure data question — let the chat brain answer
        return {"route": None, "answer": True, "speak": "", "actions": []}

    return {"route": route, "answer": False, "speak": speak, "actions": _normalize_samples(actions)}

# ════════════════════════════════════════════════════════════════════════════
# VALIDATION — only allow-listed (screen, action, param) survive
# ════════════════════════════════════════════════════════════════════════════

def _sanitize_actions(raw_actions: list[dict]) -> list[dict]:
    """Drop anything not in the manifest. Guarantees the frontend only ever
    receives safe, known (screen, action) pairs."""
    clean: list[dict] = []
    for a in raw_actions or []:
        if not isinstance(a, dict):
            continue
        screen = a.get("screen")
        action = a.get("action")
        spec = SCREEN_CAPABILITIES.get(screen or "")
        if not spec or action not in spec["actions"]:
            continue
        allowed_params = spec["actions"][action]["params"]
        params_in = a.get("params") or {}
        params_out = {k: v for k, v in params_in.items() if k in allowed_params}
        clean.append({"screen": screen, "action": action, "params": params_out})
    return clean


def _parse_llm(raw: str) -> Optional[dict]:
    """Parse the LLM JSON response; tolerate markdown fences."""
    if not raw:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        return json.loads(cleaned)
    except Exception:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return None
        try:
            return json.loads(m.group())
        except Exception:
            return None


def _is_demo_echo(raw: str) -> bool:
    """The LLM adapters return a "[demo:...]" placeholder when no API key is
    configured (demo mode). That is NOT a real plan — treat it as a miss so we
    fall through to the next engine / the rule planner."""
    return not raw or raw.lstrip().startswith("[demo:")


async def _try_llm(engine: Optional[str], user_prompt: str) -> Optional[dict]:
    """Run ONE LLM engine and return a parsed plan dict, or None on any problem
    (demo echo, parse failure, network/429 error)."""
    try:
        llm = get_llm(engine)
        raw = await llm.complete(
            user_prompt, system=AGENT_SYSTEM, temperature=0.1, json_schema=AGENT_SCHEMA
        )
        if _is_demo_echo(raw):
            log.warning("screen_agent: engine '%s' returned a demo echo (no API key?)", engine)
            return None
        return _parse_llm(raw)
    except Exception as exc:  # noqa: BLE001
        log.warning("screen_agent: engine '%s' failed (%s)", engine, exc)
        return None


def _finalize_llm(llm_plan: dict, command: str, lang: str) -> Optional[dict]:
    """Validate + shape a parsed LLM plan into the final ActionPlan, or None if
    the plan has nothing useful in it."""
    route = llm_plan.get("route") or None
    answer = bool(llm_plan.get("answer", False))
    speak = str(llm_plan.get("speak", "") or "")
    actions = _sanitize_actions(llm_plan.get("actions", []))
    if not (route or actions or answer):
        return None
    # If the LLM picked a route but emitted no valid actions, enrich with the
    # rule planner's actions for that route.
    if route and not actions:
        rp = _rule_plan(command, route, lang)
        if rp.get("actions"):
            actions = _sanitize_actions(rp["actions"])
            if not speak:
                speak = rp.get("speak", "")
    return {"route": route, "answer": answer, "speak": speak, "actions": _normalize_samples(actions)}


async def plan(
    command: str,
    current_route: Optional[str] = None,
    lang: str = "en",
    brain_engine: Optional[str] = None,
    planner: Optional[str] = None,
) -> dict:
    """Produce an ActionPlan for the spoken command.

    Returns: {route, answer, speak, actions:[{screen, action, params}]}

    `planner`:
      - "rule" → skip the LLM entirely, use the deterministic keyword planner.
      - "llm" / None (default) → use the LLM brain with a Gemini→Groq fallback
        cascade, then the rule planner as a last resort.

    The LLM path is resilient: it tries the chosen brain engine first, then Groq
    (so a missing/rate-limited Gemini key never silently degrades the copilot),
    and only falls back to the keyword planner if every LLM attempt fails.
    """
    command = (command or "").strip()
    if not command:
        return {"route": None, "answer": True, "speak": "", "actions": []}

    # Explicit "rule" mode — deterministic only, no LLM call.
    if (planner or "").lower() == "rule":
        return _rule_plan(command, current_route, lang)

    user_prompt = (
        f"Officer is currently on screen: {current_route or 'unknown'}\n"
        f"Officer command: \"{command}\"\n"
        f"Reply language: {'Kannada' if lang == 'kn' else 'English'}\n"
        "Return the ActionPlan JSON now."
    )

    # Engine cascade: chosen brain first, then Groq as an automatic fallback so
    # the real brain still fires when the primary is missing a key or 429s.
    primary = brain_engine or "gemini"
    engines: list[str] = [primary]
    if primary != "groq":
        engines.append("groq")

    for eng in engines:
        parsed = await _try_llm(eng, user_prompt)
        if parsed is None:
            continue
        result = _finalize_llm(parsed, command, lang)
        if result is not None:
            return result

    # Every LLM attempt failed/echoed — deterministic fallback.
    log.warning("screen_agent: all LLM engines unavailable — using rule planner")
    return _rule_plan(command, current_route, lang)
