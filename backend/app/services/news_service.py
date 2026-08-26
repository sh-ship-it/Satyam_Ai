"""Resolve the currently-live YouTube broadcast for Karnataka news channels.

WHY THIS EXISTS AT ALL
The News Feed screen originally embedded `youtube.com/embed/live_stream?channel=<id>`,
a legacy endpoint that used to resolve a channel's current live broadcast on its
own. It no longer does: the URL still answers 200 with a ~140 KB player shell,
but the shell contains no player config and every embed renders as "This video is
unavailable". A 200 from that endpoint is therefore not evidence of anything.

What still works is `youtube.com/embed/<videoId>`, so the video id has to be
resolved first. A browser cannot do that itself (youtube.com sends no CORS
headers), which is the only reason this server-side helper exists.

WHAT IT DOES NOT DO
No database. Nothing is inserted, no migration, no table, and no audit row — the
Neon project is near its storage cap and news is not case data. State is a single
process-local dict that expires. Restart the process and it is gone.

HOW "LIVE" IS DETERMINED
`youtube.com/channel/<id>/live` sets `<link rel="canonical">` to a `watch?v=...`
URL only while the channel is actually broadcasting; off air it canonicalises to
the channel page instead. So the presence of that canonical watch link is both
the video id and the liveness signal in one, which is far more reliable than the
`isLiveNow` flag buried in the page's JSON (that flag stays true on pages for
finished streams). Measured: 8 of 10 channels live, and each resolved id was
confirmed embeddable through YouTube's oEmbed endpoint.

ponytail: HTML scraping with a regex, and an in-process cache rather than Redis.
The ceiling is that a YouTube markup change breaks resolution (it degrades to
"off air", never to an exception) and that each worker keeps its own cache. The
upgrade path is the YouTube Data API v3, which needs an API key and whose
free 10,000 units/day would allow only ~100 `search.list` calls — not enough to
poll ten channels, which is why it is not the default here.
"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass

import httpx
import structlog

log = structlog.get_logger(__name__)

# Channel ids were resolved from each channel's own @handle canonical link and
# then confirmed against youtube.com/feeds/videos.xml?channel_id=..., which
# echoes the channel title. Do not paste an id from a search result: the first
# "channelId" in a channel page's markup is usually a *featured* channel, which
# is how an earlier revision of this list had Public TV pointing at "Public Music".
CHANNELS: list[dict[str, str]] = [
    {"slug": "tv9", "name": "TV9 Kannada", "broadcaster": "TV9 Network",
     "channel_id": "UC8dnBi4WUErqYQHZ4PfsLTg"},
    {"slug": "publictv", "name": "Public TV", "broadcaster": "Public TV",
     "channel_id": "UCl-OodciBGZ0k8K8rBZGe4w"},
    {"slug": "suvarna", "name": "Asianet Suvarna News", "broadcaster": "Asianet",
     "channel_id": "UCjElJyiXmQXnWmceQ1JyKrA"},
    {"slug": "news18", "name": "News18 Kannada", "broadcaster": "Network18",
     "channel_id": "UCa-vioGhe2btBcZneaPonKA"},
    {"slug": "powertv", "name": "Power TV News", "broadcaster": "Power TV",
     "channel_id": "UC-Yz1K9QH3VQuEL5qzLptJQ"},
    {"slug": "republic", "name": "Republic Kannada", "broadcaster": "Republic Media",
     "channel_id": "UCJHrhOU9TPxBfyZ4regtDNQ"},
    {"slug": "newsfirst", "name": "NewsFirst Kannada", "broadcaster": "NewsFirst",
     "channel_id": "UCFRlIV1mX-traJb5fd7S3nw"},
    {"slug": "tv5", "name": "TV5 Kannada", "broadcaster": "TV5",
     "channel_id": "UCpzsmNuUEmod64DGgBDPO-Q"},
    {"slug": "vistara", "name": "Vistara News", "broadcaster": "Vistara",
     "channel_id": "UChl-MciRVsq6RPyhaIMceOg"},
    {"slug": "news1", "name": "News 1 Kannada", "broadcaster": "News 1",
     "channel_id": "UCqvtaBINBx7k6pQBR5CKYzw"},
]

_CANONICAL_LIVE = re.compile(
    r'<link\s+rel="canonical"\s+href="https://www\.youtube\.com/watch\?v=([A-Za-z0-9_-]{11})"'
)

# A desktop UA: the mobile/bot variants get a consent interstitial with no
# canonical link, which would read as every channel being off air.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
}

CACHE_TTL_SECONDS = 180
_FETCH_TIMEOUT = httpx.Timeout(8.0, connect=4.0)


@dataclass
class _Cache:
    at: float
    payload: dict


_cache: _Cache | None = None
# Serialises refreshes so ten concurrent page loads cause one upstream sweep,
# not a hundred. Callers that arrive during a refresh wait and reuse the result.
_lock = asyncio.Lock()


async def _resolve_one(client: httpx.AsyncClient, ch: dict[str, str]) -> dict:
    """Return the channel with its live video id, or live=False. Never raises."""
    out = {**ch, "video_id": None, "live": False}
    try:
        r = await client.get(
            f"https://www.youtube.com/channel/{ch['channel_id']}/live",
            follow_redirects=True,
        )
        if r.status_code != 200:
            return out
        m = _CANONICAL_LIVE.search(r.text)
        if m:
            out["video_id"] = m.group(1)
            out["live"] = True
    except Exception as exc:  # network, timeout, DNS, markup — all mean "off air"
        log.info("news.resolve_failed", slug=ch["slug"], error=str(exc)[:120])
    return out


async def get_channels(force: bool = False) -> dict:
    """Channel list with current live video ids, cached for CACHE_TTL_SECONDS."""
    global _cache

    now = time.time()
    if not force and _cache and (now - _cache.at) < CACHE_TTL_SECONDS:
        return {**_cache.payload, "cached": True}

    async with _lock:
        # Re-check: another caller may have refreshed while this one waited.
        now = time.time()
        if not force and _cache and (now - _cache.at) < CACHE_TTL_SECONDS:
            return {**_cache.payload, "cached": True}

        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, headers=_HEADERS) as client:
            results = await asyncio.gather(
                *(_resolve_one(client, c) for c in CHANNELS),
                return_exceptions=False,
            )

        payload = {
            "channels": list(results),
            "live_count": sum(1 for c in results if c["live"]),
            "resolved_at": int(time.time()),
            "ttl_seconds": CACHE_TTL_SECONDS,
        }
        _cache = _Cache(at=time.time(), payload=payload)
        return {**payload, "cached": False}
