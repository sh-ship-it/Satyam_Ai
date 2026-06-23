"""board_brain.py — Smart scene-generation brain for the Investigation Board.

Drop-in replacement for the generate_scene() function in board_service.py.
Uses zero extra pip dependencies — only the standard library + existing
project LLM adapters.

Architecture
------------
1. IntentDetector   — classifies the prompt into a DiagramKind
2. LLMExtractor     — calls Gemini/Groq/OpenAI with a richer schema prompt
3. LayoutEngine     — computes x,y for each node based on DiagramKind
4. NodeStyler       — assigns shape, color, size from entity_kind
5. EdgeStyler       — assigns arrow style, color, label from relationship type
6. ConflictDetector — flags contradictions as warning nodes
7. IncrementalMerger— merges new nodes into an existing snapshot
8. FallbackBuilder  — deterministic keyword scene, no LLM needed
"""
from __future__ import annotations

import base64
import json
import logging
import math
import re
from collections import defaultdict
from typing import Any, Optional

import httpx

from app.config import get_settings
from app.models.registry import get_llm
from app.schemas.board import (
    BoardGenerateRequest,
    SceneEdge,
    SceneGraph,
    SceneNode,
)

log = logging.getLogger(__name__)

# ── Canvas constants ────────────────────────────────────────────────────────
CW, CH = 1600, 900          # canvas width / height
CX, CY = CW // 2, CH // 2  # canvas centre

# ── Diagram kinds ───────────────────────────────────────────────────────────
KINDS = (
    "evidence_board",   # suspects + objects + locations pinned together
    "crime_network",    # person relationship graph
    "timeline",         # events in chronological order
    "mind_map",         # central idea with radiating branches
    "flowchart",        # decision / process flow
    "org_chart",        # hierarchy / command structure
    "money_trail",      # accounts + transactions
    "location_map",     # places + movement paths
    "generic",          # fallback ring layout
)

# ── Node styles by entity_kind ──────────────────────────────────────────────
#  shape: rectangle | ellipse | diamond | hexagon | cloud | star | triangle
NODE_STYLES: dict[str, dict] = {
    "person":       {"color": "#ef4444", "shape": "ellipse",   "w": 200, "h": 100},
    "suspect":      {"color": "#dc2626", "shape": "ellipse",   "w": 220, "h": 110},
    "victim":       {"color": "#16a34a", "shape": "ellipse",   "w": 200, "h": 100},
    "witness":      {"color": "#2563eb", "shape": "ellipse",   "w": 200, "h": 100},
    "officer":      {"color": "#0891b2", "shape": "ellipse",   "w": 200, "h": 100},
    "unknown":      {"color": "#6b7280", "shape": "ellipse",   "w": 200, "h": 100},
    "location":     {"color": "#f59e0b", "shape": "hexagon",   "w": 220, "h": 110},
    "vehicle":      {"color": "#1d4ed8", "shape": "rectangle", "w": 240, "h": 100},
    "evidence":     {"color": "#d97706", "shape": "diamond",   "w": 220, "h": 130},
    "weapon":       {"color": "#b91c1c", "shape": "diamond",   "w": 200, "h": 120},
    "case":         {"color": "#7c3aed", "shape": "rectangle", "w": 240, "h": 120},
    "event":        {"color": "#6d28d9", "shape": "rectangle", "w": 260, "h": 110},
    "organization": {"color": "#0f766e", "shape": "cloud",     "w": 260, "h": 120},
    "account":      {"color": "#0e7490", "shape": "rectangle", "w": 240, "h": 100},
    "transaction":  {"color": "#065f46", "shape": "diamond",   "w": 220, "h": 110},
    "phone":        {"color": "#4338ca", "shape": "rectangle", "w": 200, "h": 90 },
    "document":     {"color": "#92400e", "shape": "rectangle", "w": 220, "h": 100},
    "note":         {"color": "#b45309", "shape": "rectangle", "w": 200, "h": 100},
    "warning":      {"color": "#ef4444", "shape": "triangle",  "w": 220, "h": 120},
    "decision":     {"color": "#7c3aed", "shape": "diamond",   "w": 220, "h": 130},
    "start":        {"color": "#16a34a", "shape": "ellipse",   "w": 160, "h": 80 },
    "end":          {"color": "#dc2626", "shape": "ellipse",   "w": 160, "h": 80 },
}
DEFAULT_STYLE = {"color": "#3b82f6", "shape": "rectangle", "w": 220, "h": 100}

# ── Edge styles by relationship kind ───────────────────────────────────────
EDGE_STYLES: dict[str, dict] = {
    "confirmed":   {"color": "#dc2626", "style": "solid",  "weight": 3},
    "suspected":   {"color": "#f97316", "style": "dashed", "weight": 2},
    "inferred":    {"color": "#6b7280", "style": "dashed", "weight": 1},
    "financial":   {"color": "#0891b2", "style": "solid",  "weight": 2},
    "communication":{"color": "#7c3aed","style": "solid",  "weight": 2},
    "movement":    {"color": "#f59e0b", "style": "solid",  "weight": 2},
    "association": {"color": "#ef4444", "style": "solid",  "weight": 2},
    "conflict":    {"color": "#b91c1c", "style": "solid",  "weight": 3},
    "sequence":    {"color": "#374151", "style": "solid",  "weight": 2},
    "hierarchy":   {"color": "#1d4ed8", "style": "solid",  "weight": 2},
    "link":        {"color": "#6b7280", "style": "solid",  "weight": 1},
}

# ════════════════════════════════════════════════════════════════════════════
# 1. INTENT DETECTOR
# ════════════════════════════════════════════════════════════════════════════

_INTENT_PATTERNS: list[tuple[str, list[str]]] = [
    ("timeline",       ["timeline", "chronological", "sequence of events",
                        "first", "then", "after that", "finally", "date",
                        "day", "morning", "evening", "week", "month"]),
    ("money_trail",    ["money", "transaction", "bank", "account", "transfer",
                        "payment", "cash", "financial", "fund", "wallet",
                        "hawala", "shell company", "fraud"]),
    ("flowchart",      ["process", "flow", "decision", "if", "then", "else",
                        "step", "procedure", "workflow", "pipeline", "route",
                        "how to", "steps to"]),
    ("org_chart",      ["hierarchy", "command", "reports to", "department",
                        "org", "superior", "subordinate", "rank", "structure",
                        "who controls", "chain of command"]),
    ("mind_map",       ["mind map", "brainstorm", "ideas about", "aspects of",
                        "types of", "categories", "related to", "concept"]),
    ("location_map",   ["location", "place", "city", "district", "address",
                        "moved from", "travelled to", "spotted at", "seen at",
                        "route", "path", "journey"]),
    ("crime_network",  ["network", "gang", "ring", "associate", "connection",
                        "linked to", "relationship", "criminal", "mafia",
                        "accomplice", "conspired", "worked with"]),
    ("evidence_board", ["suspect", "victim", "evidence", "weapon", "fir",
                        "case", "crime", "arrested", "scene", "clue",
                        "investigation", "police", "accused"]),
]


def detect_intent(prompt: str) -> str:
    """Return the best DiagramKind for the given prompt."""
    lower = prompt.lower()
    scores: dict[str, int] = defaultdict(int)
    for kind, keywords in _INTENT_PATTERNS:
        for kw in keywords:
            if kw in lower:
                scores[kind] += 1
    if not scores:
        return "generic"
    return max(scores, key=lambda k: scores[k])


# ════════════════════════════════════════════════════════════════════════════
# 2. SYSTEM PROMPT BUILDER — richer than the old flat SYSTEM constant
# ════════════════════════════════════════════════════════════════════════════

def _build_system(intent: str, lang: str) -> str:
    intent_guidance = {
        "evidence_board": (
            "Create a pinboard-style evidence board. Use ellipses for people "
            "(suspects=red, victims=green, witnesses=blue), hexagons for locations "
            "(orange), diamonds for evidence/weapons (yellow/dark-red). "
            "Group related nodes spatially. Add a central 'CASE' rectangle."
        ),
        "crime_network": (
            "Create a force-directed network graph. People are ellipses, "
            "organizations are clouds. Thicker/red solid edges = confirmed links, "
            "dashed = suspected. The most-connected person should be largest."
        ),
        "timeline": (
            "Create a strict left-to-right timeline. Each event is a rectangle. "
            "Date/time labels go below each node. Use sequence edges connecting "
            "events in order. Colour nodes by severity: red=critical, orange=notable, "
            "blue=routine."
        ),
        "mind_map": (
            "Create a radial mind map. Central idea is largest, in the middle. "
            "Primary branches are medium ellipses. Leaf nodes are small rectangles. "
            "Use different colors per branch to distinguish themes."
        ),
        "flowchart": (
            "Create a top-to-bottom flowchart. Rectangles=process steps, "
            "diamonds=decisions, ellipses=start/end. Label decision edges YES/NO. "
            "Use solid dark arrows."
        ),
        "org_chart": (
            "Create a top-to-bottom org chart. Each person/rank is a rectangle. "
            "Hierarchy edges go parent→child. Show rank/role in the label."
        ),
        "money_trail": (
            "Create a money trail diagram. Bank accounts=teal rectangles, "
            "transactions=green diamonds, people=red ellipses, "
            "shell companies=cloud shapes. Edge labels show amounts/dates. "
            "Use blue arrows for financial flows."
        ),
        "location_map": (
            "Create a location movement map. Places are hexagons (orange). "
            "People are ellipses. Movement edges show direction with timestamps. "
            "Colour by distance: red=long distance, yellow=local."
        ),
        "generic": (
            "Create a clear, well-spaced diagram. Use appropriate shapes for "
            "different entity types. Ensure no overlaps."
        ),
    }

    return (
        "You are a world-class investigation-board designer for Karnataka State Police. "
        f"Diagram type: {intent.upper().replace('_', ' ')}.\n"
        f"{intent_guidance.get(intent, intent_guidance['generic'])}\n\n"
        "RULES:\n"
        "1. Return ONLY valid JSON — no markdown, no explanation.\n"
        "2. Canvas is 1600×900. Spread nodes across the FULL canvas — never cluster all nodes near origin.\n"
        "3. No two nodes may overlap. Minimum 40px gap between any two nodes.\n"
        "4. Each node MUST have: id (unique string), type, x, y, w, h, label, color, entity_kind.\n"
        "5. Each edge MUST have: source, target, label, color, style (solid|dashed), kind.\n"
        "6. entity_kind must be one of: person, suspect, victim, witness, officer, unknown, "
        "location, vehicle, evidence, weapon, case, event, organization, account, "
        "transaction, phone, document, note, warning, decision, start, end.\n"
        "7. Use rich, descriptive labels — include role/relation in parentheses.\n"
        "8. Add a 'conflict' warning node (entity_kind=warning, color=#ef4444) if you detect "
        "any contradiction or impossible claim in the prompt.\n"
        f"9. Respond with labels in {'Kannada' if lang == 'kn' else 'English'}.\n"
        "10. Generate at least 4 nodes and 3 edges. More is better for complex prompts.\n"
        "11. For size: important/central nodes: w=260 h=130. Secondary: w=200 h=100. Leaf: w=160 h=80.\n"
    )

# ════════════════════════════════════════════════════════════════════════════
# 3. LLM EXTRACTION (text + multimodal)
# ════════════════════════════════════════════════════════════════════════════

SCENE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id":          {"type": "string"},
                    "type":        {"type": "string"},
                    "x":           {"type": "number"},
                    "y":           {"type": "number"},
                    "w":           {"type": "number"},
                    "h":           {"type": "number"},
                    "label":       {"type": "string"},
                    "color":       {"type": "string"},
                    "entity_kind": {"type": "string"},
                    "image_ref":   {"type": "string"},
                    "entity_id":   {"type": "string"},
                },
                "required": ["id", "type", "x", "y", "label", "entity_kind"],
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "label":  {"type": "string"},
                    "color":  {"type": "string"},
                    "style":  {"type": "string"},
                    "kind":   {"type": "string"},
                },
                "required": ["source", "target"],
            },
        },
    },
    "required": ["nodes", "edges"],
}


async def _gemini_multimodal(
    prompt: str,
    images: list[Any],
    system: str,
) -> str:
    """Call Gemini multimodal endpoint. Returns raw JSON string."""
    s = get_settings()
    key = s.gemini_api_key
    if not key:
        return json.dumps({"nodes": [], "edges": []})

    parts: list[dict] = [{"text": prompt}]
    for img in images:
        try:
            header, b64data = img.data_url.split(",", 1)
            mime = header.split(":")[1].split(";")[0]
        except Exception:  # noqa: BLE001
            mime, b64data = "image/jpeg", img.data_url
        try:
            base64.b64decode(b64data, validate=True)
        except Exception:  # noqa: BLE001
            continue
        parts.append({"inlineData": {"mimeType": mime, "data": b64data}})

    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
            "responseSchema": SCENE_SCHEMA,
        },
        "safetySettings": [
            {"category": c, "threshold": "BLOCK_ONLY_HIGH"}
            for c in (
                "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT",
            )
        ],
    }

    url = (
        f"https://generativelanguage.googleapis.com/v1beta"
        f"/models/{s.gemini_model}:generateContent?key={key}"
    )
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(url, json=body)
        r.raise_for_status()
    data = r.json()
    candidates = data.get("candidates", [])
    if not candidates:
        return json.dumps({"nodes": [], "edges": []})
    out_parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in out_parts)


async def _llm_extract(
    prompt: str,
    images: list[Any],
    engine: str,
    system: str,
) -> str:
    """Call whichever LLM engine is requested. Returns raw JSON string."""
    s = get_settings()
    if images and engine == "gemini" and s.gemini_api_key:
        return await _gemini_multimodal(prompt, images, system)
    llm = get_llm(engine)
    return await llm.complete(
        prompt,
        system=system,
        temperature=0.3,
        json_schema=SCENE_SCHEMA,
    )

# ════════════════════════════════════════════════════════════════════════════
# 4. NODE STYLER — enriches raw LLM nodes with correct shape/color/size
# ════════════════════════════════════════════════════════════════════════════

def _style_node(n: dict) -> dict:
    """Apply NODE_STYLES based on entity_kind. LLM color wins if set."""
    kind = (n.get("entity_kind") or "").lower()
    style = NODE_STYLES.get(kind, DEFAULT_STYLE)

    # Use LLM-supplied color if present, else apply style default
    color = n.get("color") or style["color"]

    # Use LLM-supplied dimensions or fall back to style defaults
    w = n.get("w") or style["w"]
    h = n.get("h") or style["h"]

    # Map our shape names → tldraw geo names
    shape_map = {
        "ellipse":   "ellipse",
        "diamond":   "diamond",
        "hexagon":   "hexagon",
        "cloud":     "cloud",
        "star":      "star",
        "triangle":  "triangle",
        "rectangle": "rectangle",
    }
    raw_shape = style.get("shape", "rectangle")
    geo = shape_map.get(raw_shape, "rectangle")

    return {**n, "color": color, "w": w, "h": h, "type": geo}


# ════════════════════════════════════════════════════════════════════════════
# 5. EDGE STYLER
# ════════════════════════════════════════════════════════════════════════════

def _style_edge(e: dict) -> dict:
    """Apply EDGE_STYLES based on kind."""
    kind = (e.get("kind") or "link").lower()
    style = EDGE_STYLES.get(kind, EDGE_STYLES["link"])
    return {
        **e,
        "color": e.get("color") or style["color"],
        "style": e.get("style") or style["style"],
        "kind":  kind,
    }


# ════════════════════════════════════════════════════════════════════════════
# 6. LAYOUT ENGINE — recomputes x,y based on diagram intent
#    The LLM provides a first guess; we fix overlaps and apply proper geometry
# ════════════════════════════════════════════════════════════════════════════

def _no_overlap(nodes: list[dict], padding: int = 40) -> list[dict]:
    """Simple iterative overlap resolution — push nodes apart until clean."""
    for _ in range(80):
        moved = False
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                a, b = nodes[i], nodes[j]
                ax, ay = a["x"] + a["w"] / 2, a["y"] + a["h"] / 2
                bx, by = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
                gap_x = (a["w"] + b["w"]) / 2 + padding
                gap_y = (a["h"] + b["h"]) / 2 + padding
                dx, dy = bx - ax, by - ay
                if abs(dx) < gap_x and abs(dy) < gap_y:
                    push_x = (gap_x - abs(dx)) / 2 + 2
                    push_y = (gap_y - abs(dy)) / 2 + 2
                    if abs(dx) > abs(dy):
                        sign = 1 if dx >= 0 else -1
                        nodes[j]["x"] += sign * push_x
                        nodes[i]["x"] -= sign * push_x
                    else:
                        sign = 1 if dy >= 0 else -1
                        nodes[j]["y"] += sign * push_y
                        nodes[i]["y"] -= sign * push_y
                    moved = True
        if not moved:
            break
    # Clamp to canvas
    for n in nodes:
        n["x"] = max(20, min(n["x"], CW - n["w"] - 20))
        n["y"] = max(20, min(n["y"], CH - n["h"] - 20))
    return nodes


def _layout_ring(nodes: list[dict]) -> list[dict]:
    n = len(nodes)
    if n == 0:
        return nodes
    # Central node (highest degree or first) stays in centre
    nodes[0]["x"] = CX - nodes[0]["w"] / 2
    nodes[0]["y"] = CY - nodes[0]["h"] / 2
    radius = min(CW, CH) * 0.35
    for i in range(1, n):
        angle = (2 * math.pi * (i - 1) / max(n - 1, 1)) - math.pi / 2
        nodes[i]["x"] = round(CX + radius * math.cos(angle) - nodes[i]["w"] / 2)
        nodes[i]["y"] = round(CY + radius * math.sin(angle) - nodes[i]["h"] / 2)
    return _no_overlap(nodes)


def _layout_timeline(nodes: list[dict]) -> list[dict]:
    n = len(nodes)
    if n == 0:
        return nodes
    step = max((CW - 160) / max(n, 1), 160)
    for i, node in enumerate(nodes):
        node["x"] = round(80 + i * step)
        node["y"] = round(CY - node["h"] / 2 + (40 if i % 2 else -40))
    return _no_overlap(nodes, padding=20)


def _layout_tree(nodes: list[dict], edges: list[dict], top_down: bool = True) -> list[dict]:
    """Generic tree layout (org chart / flowchart)."""
    # Build adjacency
    children: dict[str, list[str]] = defaultdict(list)
    parents: set[str] = set()
    ids = {n["id"] for n in nodes}
    for e in edges:
        if e["source"] in ids and e["target"] in ids:
            children[e["source"]].append(e["target"])
            parents.add(e["target"])
    roots = [n["id"] for n in nodes if n["id"] not in parents]
    if not roots:
        roots = [nodes[0]["id"]] if nodes else []

    node_map = {n["id"]: n for n in nodes}
    levels: dict[str, int] = {}

    def assign_levels(nid: str, lvl: int) -> None:
        if nid in levels:
            return
        levels[nid] = lvl
        for child in children.get(nid, []):
            assign_levels(child, lvl + 1)

    for r in roots:
        assign_levels(r, 0)
    # Assign remaining (disconnected)
    for n in nodes:
        if n["id"] not in levels:
            levels[n["id"]] = 0

    max_level = max(levels.values(), default=0)
    by_level: dict[int, list[str]] = defaultdict(list)
    for nid, lvl in levels.items():
        by_level[lvl].append(nid)

    level_h = CH / max(max_level + 2, 2)
    for lvl, nids in by_level.items():
        step = CW / max(len(nids) + 1, 2)
        for i, nid in enumerate(nids):
            nd = node_map[nid]
            if top_down:
                nd["x"] = round((i + 1) * step - nd["w"] / 2)
                nd["y"] = round(lvl * level_h + 40)
            else:
                nd["x"] = round(lvl * (CW / max(max_level + 2, 2)) + 40)
                nd["y"] = round((i + 1) * step - nd["h"] / 2)

    return _no_overlap(nodes)


def _layout_radial(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Radial tree / mind map: root at centre, branches radiate out."""
    if not nodes:
        return nodes
    children: dict[str, list[str]] = defaultdict(list)
    parents: set[str] = set()
    ids = {n["id"] for n in nodes}
    for e in edges:
        if e["source"] in ids and e["target"] in ids:
            children[e["source"]].append(e["target"])
            parents.add(e["target"])
    roots = [n["id"] for n in nodes if n["id"] not in parents]
    root = roots[0] if roots else nodes[0]["id"]
    node_map = {n["id"]: n for n in nodes}

    def place(nid: str, cx: float, cy: float, r: float, a_start: float, a_end: float) -> None:
        nd = node_map.get(nid)
        if not nd:
            return
        nd["x"] = round(cx - nd["w"] / 2)
        nd["y"] = round(cy - nd["h"] / 2)
        kids = children.get(nid, [])
        if not kids:
            return
        a_step = (a_end - a_start) / len(kids)
        for i, kid in enumerate(kids):
            angle = a_start + a_step * (i + 0.5)
            kx = cx + r * math.cos(angle)
            ky = cy + r * math.sin(angle)
            place(kid, kx, ky, r * 0.7, angle - a_step / 2, angle + a_step / 2)

    place(root, CX, CY, 320, 0, 2 * math.pi)
    # Place any disconnected nodes
    placed = {n["id"] for n in nodes if "x" in n and n.get("x") is not None}
    for i, n in enumerate([nd for nd in nodes if nd["id"] not in placed]):
        n["x"] = round(40 + i * 200)
        n["y"] = round(CH - 100)
    return _no_overlap(nodes)


def _layout_grid(nodes: list[dict]) -> list[dict]:
    """Grid layout for evidence boards."""
    n = len(nodes)
    cols = max(1, round(math.sqrt(n * CW / CH)))
    rows = math.ceil(n / cols)
    cell_w = CW / (cols + 1)
    cell_h = CH / (rows + 1)
    for i, node in enumerate(nodes):
        col = i % cols
        row = i // cols
        node["x"] = round((col + 1) * cell_w - node["w"] / 2)
        node["y"] = round((row + 1) * cell_h - node["h"] / 2)
    return _no_overlap(nodes)


def apply_layout(intent: str, nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Apply the correct layout engine for the diagram type."""
    if intent == "timeline":
        return _layout_timeline(nodes)
    if intent in ("org_chart", "flowchart"):
        return _layout_tree(nodes, edges, top_down=True)
    if intent == "mind_map":
        return _layout_radial(nodes, edges)
    if intent in ("money_trail", "location_map"):
        return _layout_radial(nodes, edges)
    if intent == "evidence_board":
        return _layout_grid(nodes)
    if intent == "crime_network":
        return _layout_ring(nodes)
    # generic / fallback
    return _layout_ring(nodes)

# ════════════════════════════════════════════════════════════════════════════
# 7. CONFLICT DETECTOR
# ════════════════════════════════════════════════════════════════════════════

_CONTRADICTION_PATTERNS = [
    (r'\b(\w+)\b.{0,60}\b(same time|simultaneously|at once)\b.{0,60}\b\1\b', "Same entity in two places"),
    (r'\b(dead|killed|deceased)\b.{0,80}\b(alive|survived|escaped)\b', "Alive/dead contradiction"),
    (r'\b(arrested)\b.{0,80}\b(fled|escaped|at large)\b', "Arrest/escape contradiction"),
]


def detect_conflicts(prompt: str) -> list[dict]:
    """Return warning node dicts for any detected contradictions."""
    warnings: list[dict] = []
    for i, (pattern, msg) in enumerate(_CONTRADICTION_PATTERNS):
        if re.search(pattern, prompt, re.IGNORECASE):
            warnings.append({
                "id":          f"conflict-{i}",
                "type":        "triangle",
                "x":           40 + i * 260,
                "y":           20,
                "w":           240,
                "h":           100,
                "label":       f"⚠ Conflict: {msg}",
                "color":       "#ef4444",
                "entity_kind": "warning",
            })
    return warnings


# ════════════════════════════════════════════════════════════════════════════
# 8. INCREMENTAL MERGER
# ════════════════════════════════════════════════════════════════════════════

def merge_into_snapshot(
    existing_snapshot: Optional[dict],
    new_nodes: list[dict],
    new_edges: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Merge new nodes/edges into existing ones, deduplicating by id/label."""
    if not existing_snapshot:
        return new_nodes, new_edges

    # Extract existing nodes from tldraw snapshot
    try:
        store = existing_snapshot.get("store", {})
        existing_labels: set[str] = set()
        existing_ids: set[str] = set()
        for shape in store.values():
            if isinstance(shape, dict) and shape.get("type") == "geo":
                lbl = shape.get("props", {}).get("richText", {})
                if isinstance(lbl, dict):
                    for block in lbl.get("children", []):
                        for leaf in block.get("children", []):
                            text = leaf.get("text", "")
                            if text:
                                existing_labels.add(text.lower().strip())
                eid = shape.get("meta", {}).get("brain_id", "")
                if eid:
                    existing_ids.add(eid)
    except Exception:  # noqa: BLE001
        existing_labels = set()
        existing_ids = set()

    # Filter out nodes that already exist
    merged_nodes = [
        n for n in new_nodes
        if n["id"] not in existing_ids
        and n.get("label", "").lower().strip() not in existing_labels
    ]

    # Offset merged nodes so they don't land on top of existing content
    offset_x = 200 if merged_nodes else 0
    for n in merged_nodes:
        n["x"] = min(n["x"] + offset_x, CW - n["w"] - 20)

    return merged_nodes, new_edges


# ════════════════════════════════════════════════════════════════════════════
# 9. FALLBACK BUILDER — deterministic, no LLM
# ════════════════════════════════════════════════════════════════════════════

_STOP = {
    "a","an","the","and","or","in","on","of","for","to","by","with",
    "is","was","has","have","been","be","as","at","from","this","that",
    "these","those","about","into","over","under","through","who","what",
    "how","when","where","create","show","make","draw","diagram","map",
}

_KIND_HINTS = [
    ("suspect",  ["suspect","accused","criminal","culprit","perpetrator","arrested"]),
    ("victim",   ["victim","complainant","injured","hurt","attacked"]),
    ("witness",  ["witness","informant","saw","observed"]),
    ("location", ["place","location","road","street","area","city","district","hotel","house"]),
    ("vehicle",  ["car","vehicle","bike","motorcycle","truck","auto","van"]),
    ("weapon",   ["weapon","knife","gun","pistol","rod","stick","acid"]),
    ("account",  ["account","bank","wallet","hdfc","sbi","upi","paytm"]),
    ("evidence", ["evidence","clue","cctv","phone","call","record"]),
    ("event",    ["robbery","murder","theft","kidnap","assault","attack","crime"]),
]


def _guess_kind(word: str) -> str:
    lower = word.lower()
    for kind, hints in _KIND_HINTS:
        if any(h in lower for h in hints):
            return kind
    return "person"


def keyword_fallback(prompt: str) -> SceneGraph:
    """Deterministic scene from prompt keywords. Zero LLM calls."""
    words = re.findall(r'[A-Za-z0-9\u0C00-\u0CFF]+', prompt)
    seen: set[str] = set()
    labels: list[str] = []
    for w in words:
        lw = w.lower()
        if lw not in _STOP and len(lw) > 2 and lw not in seen:
            seen.add(lw)
            labels.append(w.title())
        if len(labels) >= 10:
            break

    if not labels:
        labels = ["Subject A", "Subject B", "Case"]

    intent = detect_intent(prompt)
    n = len(labels)
    cx, cy = CX, CY

    nodes: list[SceneNode] = []
    raw_nodes: list[dict] = []

    for i, label in enumerate(labels):
        kind = _guess_kind(label)
        style = NODE_STYLES.get(kind, DEFAULT_STYLE)
        angle = (2 * math.pi * i / n) - math.pi / 2
        radius = min(CW, CH) * 0.33
        raw = {
            "id": f"kw-{i}",
            "type": style.get("shape", "rectangle"),
            "x": round(cx + radius * math.cos(angle) - style["w"] / 2),
            "y": round(cy + radius * math.sin(angle) - style["h"] / 2),
            "w": style["w"], "h": style["h"],
            "label": label, "color": style["color"],
            "entity_kind": kind,
        }
        raw_nodes.append(raw)

    raw_nodes = apply_layout(intent, raw_nodes, [])

    for raw in raw_nodes:
        nodes.append(SceneNode(**{k: raw[k] for k in SceneNode.model_fields if k in raw}))

    edges: list[SceneEdge] = []
    for i in range(n):
        j = (i + 1) % n
        e_kind = "association" if i % 3 != 2 else "suspected"
        estyle = EDGE_STYLES[e_kind]
        edges.append(SceneEdge(
            source=f"kw-{i}", target=f"kw-{j}",
            label="linked to", color=estyle["color"],
            style=estyle["style"], kind=e_kind,
        ))

    return SceneGraph(nodes=nodes, edges=edges)

# ════════════════════════════════════════════════════════════════════════════
# 10. PARSER — tolerant JSON extraction
# ════════════════════════════════════════════════════════════════════════════

def _parse(raw: str) -> SceneGraph:
    """Parse LLM output into SceneGraph. Never raises."""
    # Strip markdown fences if present
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(clean)
    except Exception:  # noqa: BLE001
        # Try to extract JSON object from surrounding text
        m = re.search(r'\{.*\}', clean, re.DOTALL)
        if not m:
            return SceneGraph()
        try:
            data = json.loads(m.group())
        except Exception:  # noqa: BLE001
            return SceneGraph()

    nodes: list[SceneNode] = []
    for n in data.get("nodes", []):
        try:
            # Apply styling before building SceneNode
            styled = _style_node(n)
            valid = {k: styled[k] for k in SceneNode.model_fields if k in styled}
            nodes.append(SceneNode(**valid))
        except Exception:  # noqa: BLE001
            pass

    edges: list[SceneEdge] = []
    for e in data.get("edges", []):
        try:
            styled = _style_edge(e)
            valid = {k: styled[k] for k in SceneEdge.model_fields if k in styled}
            edges.append(SceneEdge(**valid))
        except Exception:  # noqa: BLE001
            pass

    return SceneGraph(nodes=nodes, edges=edges)


# ════════════════════════════════════════════════════════════════════════════
# 11. MAIN ENTRY POINT — generate_scene (drop-in replacement)
# ════════════════════════════════════════════════════════════════════════════

async def generate_scene(
    req: BoardGenerateRequest,
    existing_snapshot: Optional[dict] = None,
) -> SceneGraph:
    """Generate a rich SceneGraph from a prompt.

    Pipeline:
      detect_intent → build_system_prompt → LLM call (with fallback cascade)
      → parse → style nodes/edges → apply layout → conflict detection
      → optional incremental merge → return SceneGraph

    Falls back to keyword_fallback() if all LLM calls fail.
    """
    engine = req.brain_engine or "gemini"
    intent = detect_intent(req.prompt)
    system = _build_system(intent, req.lang)

    log.info("board_brain: intent=%s engine=%s images=%d", intent, engine, len(req.images))

    # ── LLM call with two-level fallback ──────────────────────────────────
    raw: Optional[str] = None
    engines_to_try = [engine]
    # Add fallback engines if primary isn't already them
    for fallback in ("gemini", "groq", "openai"):
        if fallback not in engines_to_try:
            engines_to_try.append(fallback)

    for eng in engines_to_try:
        try:
            raw = await _llm_extract(req.prompt, req.images, eng, system)
            log.debug("board_brain: got response from engine=%s len=%d", eng, len(raw or ""))
            break
        except Exception as exc:  # noqa: BLE001
            is_rate = "429" in str(exc) or "rate" in str(exc).lower()
            log.warning(
                "board_brain: engine=%s failed (%s)%s",
                eng, exc,
                " — trying next engine" if eng != engines_to_try[-1] else " — using keyword fallback",
            )
            if not is_rate:
                # Non-rate error — don't try other engines, go to keyword fallback
                break

    if not raw:
        log.warning("board_brain: all LLM engines failed, using keyword fallback")
        return keyword_fallback(req.prompt)

    # ── Parse ──────────────────────────────────────────────────────────────
    scene = _parse(raw)
    if not scene.nodes:
        log.warning("board_brain: LLM returned empty scene, using keyword fallback")
        return keyword_fallback(req.prompt)

    # ── Apply layout ───────────────────────────────────────────────────────
    raw_nodes = [n.model_dump() for n in scene.nodes]
    raw_edges = [e.model_dump() for e in scene.edges]

    # Only re-layout if LLM provided suspicious coordinates
    # (all near origin = LLM didn't space things out)
    xs = [n["x"] for n in raw_nodes]
    spread = max(xs) - min(xs) if len(xs) > 1 else 0
    if spread < 200:
        log.debug("board_brain: LLM coordinates clustered (spread=%d), applying layout engine", spread)
        raw_nodes = apply_layout(intent, raw_nodes, raw_edges)

    # ── Conflict detection ─────────────────────────────────────────────────
    conflict_raws = detect_conflicts(req.prompt)
    for cr in conflict_raws:
        styled = _style_node(cr)
        valid = {k: styled[k] for k in SceneNode.model_fields if k in styled}
        scene.nodes.append(SceneNode(**valid))

    # ── Incremental merge (if an existing snapshot was provided) ───────────
    if existing_snapshot:
        merged_raws, merged_edge_raws = merge_into_snapshot(
            existing_snapshot, raw_nodes, raw_edges
        )
    else:
        merged_raws, merged_edge_raws = raw_nodes, raw_edges

    # ── Rebuild final SceneGraph ────────────────────────────────────────────
    final_nodes: list[SceneNode] = []
    for r in merged_raws:
        try:
            valid = {k: r[k] for k in SceneNode.model_fields if k in r}
            final_nodes.append(SceneNode(**valid))
        except Exception:  # noqa: BLE001
            pass
    # Keep conflict nodes
    final_nodes += [n for n in scene.nodes if n.entity_kind == "warning"]

    final_edges: list[SceneEdge] = []
    for r in merged_edge_raws:
        try:
            valid = {k: r[k] for k in SceneEdge.model_fields if k in r}
            final_edges.append(SceneEdge(**valid))
        except Exception:  # noqa: BLE001
            pass

    log.info(
        "board_brain: done — %d nodes, %d edges, %d conflicts",
        len(final_nodes), len(final_edges), len(conflict_raws),
    )
    return SceneGraph(nodes=final_nodes, edges=final_edges)
