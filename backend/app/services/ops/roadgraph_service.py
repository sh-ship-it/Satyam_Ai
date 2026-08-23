"""Road graph for pathfinding, built from OpenStreetMap via Overpass.

Why this exists
---------------
`routing_service` asks OSRM for a finished route. That is the right tool for "get
me there", but it cannot support the Dispatch screen's search animation: OSRM
returns the winning path only, never the frontier it explored. Animating a search
requires the *graph*, so the client can run the search itself and draw each edge
as it is settled.

Nothing in this repo held road topology before this module. The dispatch screen's
"route" was a straight line interpolated in the browser.

Design decisions
----------------
* **Server-side proxy with a TTL cache**, matching the convention the rest of the
  project uses for external feeds (one proxy, cached, with a `provider` field and
  a graceful degraded path — the same shape as `routing_service`'s
  `OSRM -> STRAIGHT_LINE`). A browser fetching Overpass directly would also work,
  but every officer's map pan would become another request against a free
  community service.
* **Arterial roads only** (`motorway` .. `tertiary`, plus their `_link` ramps and
  `unclassified`/`residential` are deliberately excluded). Residential streets
  multiply the node count by roughly an order of magnitude for a demo that is
  showing *how* a search works, not micro-optimising a turn into a driveway.
* **Index-based edges.** Nodes are sent once as `[lat, lng]` pairs and edges refer
  to them by integer index. Sending coordinates per edge roughly triples the
  payload for no extra information.
* **Coordinates rounded to 5 dp** (~1.1 m). Finer precision is noise at the zoom
  this is drawn at and costs bytes on every node.

Honesty note: this is real OSM geometry, so a path found on it is a real path
along real roads. It is still not a traffic-aware routing engine — no turn
restrictions, no one-way handling, no signal timing. Edge cost is metres. The UI
must not present a result from this as an authoritative ETA.
"""
from __future__ import annotations

import logging
import math
import time

import httpx

log = logging.getLogger("satyam.ops.roadgraph")

# Public Overpass instances. Tried in order; the first that answers wins. Both are
# free community services with no key, same posture as the basemap tile providers.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

# Road classes kept, highest to lowest. Excluding residential/unclassified keeps
# the graph an arterial network: far fewer nodes, and the shape a patrol car would
# actually take across a city.
ROAD_CLASSES = (
    "motorway|trunk|primary|secondary|tertiary"
    "|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
)

# Overpass returns 406 Not Acceptable to clients that do not identify themselves —
# a default `python-httpx/x.y` agent is refused outright. Identifying the
# application is also the etiquette their usage policy asks for.
_HEADERS = {
    "User-Agent": "Satyam-KSP-CrimeIntelligence/1.0 (police dispatch demo; contact via repo)",
    "Accept": "application/json",
    "Content-Type": "text/plain; charset=utf-8",
}

CACHE_TTL_SEC = 60 * 60 * 6      # 6 h: road layout does not change on a demo timescale
MAX_SPAN_DEG = 0.35              # ~39 km; refuse to pull half the state in one query
OVERPASS_TIMEOUT_SEC = 25.0      # Overpass is slow by nature; this is not a fast API
COORD_DP = 5

# (rounded bbox) -> (expires_at, payload)
_cache: dict[tuple, tuple[float, dict]] = {}


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _query(south: float, west: float, north: float, east: float) -> str:
    # `way(...)` then `out geom` returns each way's node coordinates inline, which
    # avoids a second round trip to resolve node ids.
    return (
        f"[out:json][timeout:{int(OVERPASS_TIMEOUT_SEC)}];"
        f'way["highway"~"^({ROAD_CLASSES})$"]'
        f"({south},{west},{north},{east});"
        f"out geom;"
    )


def _build(elements: list[dict]) -> dict:
    """Collapse Overpass ways into a deduplicated node list plus weighted edges.

    Ways share endpoints, so the same coordinate arrives many times. Keying nodes
    on their rounded coordinate is what actually connects the graph: without the
    dedup every way would be an isolated chain and no path would ever be found.
    """
    index: dict[tuple[float, float], int] = {}
    nodes: list[list[float]] = []
    edges: list[list[float]] = []
    seen_edges: set[tuple[int, int]] = set()

    def node_id(lat: float, lng: float) -> int:
        key = (round(lat, COORD_DP), round(lng, COORD_DP))
        got = index.get(key)
        if got is None:
            got = len(nodes)
            index[key] = got
            nodes.append([key[0], key[1]])
        return got

    for el in elements:
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        prev = None
        for pt in geom:
            lat, lng = pt.get("lat"), pt.get("lon")
            if lat is None or lng is None:
                continue
            cur = node_id(float(lat), float(lng))
            if prev is not None and prev != cur:
                pair = (prev, cur) if prev < cur else (cur, prev)
                if pair not in seen_edges:
                    seen_edges.add(pair)
                    a, b = nodes[pair[0]], nodes[pair[1]]
                    edges.append(
                        [pair[0], pair[1], round(_haversine_m(a[0], a[1], b[0], b[1]), 1)]
                    )
            prev = cur

    return {"nodes": nodes, "edges": edges}


async def get_graph(
    *, south: float, west: float, north: float, east: float
) -> dict:
    """Arterial road graph inside the bbox.

    Returns `{provider, nodes, edges, cached, note?}`. Never raises for a network
    problem: an unreachable Overpass yields `provider="UNAVAILABLE"` with an empty
    graph and a human-readable `note`, so the caller can say why the search cannot
    run instead of quietly drawing a straight line — which is precisely the
    failure this screen already had.
    """
    if north < south or east < west:
        raise ValueError("bbox must be south<north and west<east")
    if (north - south) > MAX_SPAN_DEG or (east - west) > MAX_SPAN_DEG:
        raise ValueError(f"bbox span must be <= {MAX_SPAN_DEG} degrees")

    key = tuple(round(v, 3) for v in (south, west, north, east))
    hit = _cache.get(key)
    now = time.time()
    if hit and hit[0] > now:
        return {**hit[1], "cached": True}

    q = _query(south, west, north, east)
    last_err: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            async with httpx.AsyncClient(
                timeout=OVERPASS_TIMEOUT_SEC, headers=_HEADERS, follow_redirects=True
            ) as client:
                # Raw body, not form-encoded. Overpass accepts both, but the raw
                # form is what its own docs use and avoids content-type haggling.
                resp = await client.post(endpoint, content=q.encode("utf-8"))
                resp.raise_for_status()
                elements = resp.json().get("elements", [])
            graph = _build(elements)
            payload = {
                "provider": "OVERPASS",
                "endpoint": endpoint,
                "ways": len(elements),
                **graph,
            }
            _cache[key] = (now + CACHE_TTL_SEC, payload)
            log.info(
                "road graph built: %s ways -> %s nodes / %s edges from %s",
                len(elements), len(graph["nodes"]), len(graph["edges"]), endpoint,
            )
            return {**payload, "cached": False}
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            last_err = exc
            log.warning("Overpass endpoint %s failed: %s", endpoint, exc)

    return {
        "provider": "UNAVAILABLE",
        "nodes": [],
        "edges": [],
        "cached": False,
        "note": (
            "Road network could not be fetched from OpenStreetMap "
            f"({type(last_err).__name__}). The route search needs road geometry, "
            "so it cannot run offline."
        ),
    }
