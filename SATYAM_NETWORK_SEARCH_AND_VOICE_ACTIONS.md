# Satyam — Network Entity Search Fix + AI Voice-Action Automation 🔍🎙️

> Three things in this doc:
> 1. **Part 0** — confirmation that the voice-navigation keyword prompt I gave earlier is correct against your current code.
> 2. **Part 1** — fix the Network screen "Seed entity" search so it suggests people by name as you type (Google-style, from a single character).
> 3. **Part 2** — enable the AI copilot to answer crime questions about a person, talk back, ask a follow-up and wait, then act: pin the crime location on the map and auto-fill + run the Network entity search.
>
> Apply **Part 1 first**, verify search works, then apply Part 2.

---

## Part 0 — Voice-navigation prompt: VERIFIED ✅

I re-checked the earlier keyword prompt against your latest `components/Shell.tsx`. All anchors match exactly, so the prompt is safe to apply as-is:

| Anchor | Line | Status |
|---|---|---|
| `const SCREEN_ROUTES: VoiceScreen[] = [` | 37 | ✅ matches |
| `const NAV_VERB = /(open|show|go to|goto|navigate|take me to|switch to|jump to)|ತೆರೆ|ಹೋಗು|ತೋರಿಸಿ/i;` | 45 | ✅ exact |
| `.replace(/\b(the|to|screen|page|tab|please|view|me|in|on|and|a)\b/gi, " ")` | 90 | ✅ exact |
| `const NAV_LABEL: Record<string, string> = {` | 208 | ✅ matches |

One note: `NAV_LABEL` (line 208) still lists `"/map"`, but there is no `/map` route — map lives inside `/console`. That's harmless (it's only a spoken-label lookup), and the nav prompt's Edit 4 already replaces this block with the correct route set. No change needed beyond applying that prompt.

---

## Part 1 — Fix the Network "Seed entity" search

### Root causes (the search UI is fine; the data path isn't)

The `SeedSearch` component (live dropdown, debounce, keyboard nav, "Top offenders") is already well built. The problem is in **how/when it fetches**:

1. **Wrong API prefix (most likely).** Every working Network call uses the `/api/...` prefix (`/api/network/...`, `/api/offenders`, …) — the graph loads, so `/api` is proven reachable. But `searchPersonsAndCases` alone calls **`/cases/search`** (no `/api`). If anything (dev proxy / deploy) only forwards `/api/*` to the backend, this one call 404s. The error is then **silently swallowed** by `.catch(() => setResults([]))`, so you see *nothing* — exactly your symptom.
2. **2-character gate.** Suggestions only fire at `value.trim().length >= 2`; a single character shows only "Top offenders" (and nothing if that preload also failed).
3. **Silent failures.** Both the search and the "Top offenders" preload swallow errors, so a broken backend looks like "no results" with no clue.

### Fix 1a — standardize the search path to `/api` (frontend)

`frontend/src/lib/api/intelligence.ts` — find:
```ts
  searchPersonsAndCases: (q: string, limit = 12) =>
    apiFetch<SearchResult[]>(`/cases/search?q=${encodeURIComponent(q)}&limit=${limit}`),
```
Replace with:
```ts
  searchPersonsAndCases: (q: string, limit = 12) =>
    apiFetch<SearchResult[]>(`/api/cases/search?q=${encodeURIComponent(q)}&limit=${limit}`),
```

### Fix 1b — make `/api/cases/search` resolve (backend)

The search endpoint lives in `cases.py`, currently mounted only at `/cases`. Add a second mount under `/api/cases` so the proven prefix works (keeps the old `/cases` mount for back-compat). In `backend/app/main.py`, find:
```python
    app.include_router(cases.router, prefix="/cases", tags=["cases"])
```
Replace with:
```python
    app.include_router(cases.router, prefix="/cases", tags=["cases"])
    app.include_router(cases.router, prefix="/api/cases", tags=["cases"])
```

### Fix 1c — suggest from the first character + show errors (frontend)

In `frontend/src/routes/network.tsx`, inside `SeedSearch`:

**(i) Search from 1 char and surface failures.** Find:
```tsx
  // Live search while typing
  useEffect(() => {
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSearching(true);
      intelligence.searchPersonsAndCases(value.trim(), 10)
        .then(r => { setResults(r); setActiveIdx(-1); })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 280);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [value]);
```
Replace with:
```tsx
  // Live search while typing (Google-style: fires from the first character)
  useEffect(() => {
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSearching(true);
      intelligence.searchPersonsAndCases(value.trim(), 10)
        .then(r => { setResults(r); setActiveIdx(-1); })
        .catch(err => { console.error("[seed search] failed:", err); setResults([]); })
        .finally(() => setSearching(false));
    }, 180);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [value]);
```

**(ii) Lower every other 2-char gate to 1 char.** Still in `SeedSearch`, do a find-and-replace for these exact substrings (replace all occurrences):
- `value.trim().length < 2`  →  `value.trim().length < 1`
- `value.trim().length >= 2`  →  `value.trim().length >= 1`

**(iii) Don't let the "Top offenders" preload hide everyone.** Find:
```tsx
    const p = new URLSearchParams({ limit: "8", min_offenses: "2" });
```
Replace with:
```tsx
    const p = new URLSearchParams({ limit: "8", min_offenses: "1" });
```

### Fix 1d — (optional) broaden the backend match

In `backend/app/api/routes/cases.py`, the person query can also match a numeric person-id and trims the term. Find:
```python
    pat = f"%{q}%"
```
Replace with:
```python
    pat = f"%{q.strip()}%"
```
and in the person SQL find:
```sql
        WHERE p.name ILIKE :pat
```
Replace with:
```sql
        WHERE p.name ILIKE :pat OR CAST(p.person_id AS TEXT) ILIKE :pat
```

### Part 1 verification
```bash
# Frontend now calls the proven /api prefix:
grep -rn "cases/search" frontend/src/lib/api/intelligence.ts   # expect: /api/cases/search
# Backend exposes it under /api too:
grep -n "/api/cases" backend/app/main.py                       # expect the new include_router line
# No more 2-char gate:
grep -n "value.trim().length" frontend/src/routes/network.tsx  # expect: < 1 and >= 1
```
Manual: open Network → click the Seed box → "Top offenders" appears; type a single letter (e.g. “a”) → person suggestions stream in; pick one → graph loads. If still empty, open DevTools console — the search error is now logged instead of hidden.

---

## Part 2 — AI voice-action automation

**Goal:** From the **top-right voice copilot**, you say e.g. *“what crime did Ramesh commit”* or *“show me the crime rate of Ramesh”*. The AI answers out loud, then asks *“Do you want me to check his other details?”* and keeps listening. You can then say *“show it on the map”* (pins the crime location) or *“search him in the network”* (auto-fills + runs the Network entity search).

This builds on what already exists: the copilot dispatches `satyam:voice-command`; `Shell.handle()` already routes data questions to the Console (grounded + spoken) and route+task commands to screens via `satyam:run-task`; conversation mode already re-opens the mic via `resumeListening()`.

### Fix 2a — AI fills the Network search box (not just the graph)

Right now `satyam:run-task` on `/network` calls `fetchGraph(d.task)` but never sets the visible search box. In `frontend/src/routes/network.tsx`, find:
```tsx
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/network") return;
      setTaskMsg(d.task || d.query || null);
      if (d.task) fetchGraph(d.task);
    };
```
Replace with:
```tsx
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/network") return;
      setTaskMsg(d.task || d.query || null);
      if (d.task) { setSeedInput(d.task); fetchGraph(d.task); } // show the name in the Seed box AND search it
    };
```
Now “search Ramesh in the network” makes the entity box read “Ramesh” and runs the graph — exactly the automation you asked for.

### Fix 2b — add person-crime intent + spoken follow-up + actions (Shell)

In `frontend/src/components/Shell.tsx`, add these recognizers next to `NAV_VERB` (after line 45):
```ts
// Person-crime question: “what crime did X commit” / “crime rate of X” / Kannada equivalents.
const PERSON_CRIME_INTENT = /(crime rate|what crime|which crime|crimes?|offences?|offenses?|record of|history of)|ಅಪರಾಧ|ಕ್ರಿಮಿನಲ್|ಅಪರಾಧಗಳು/i;
// Follow-up affirmatives + the two suggested actions.
const AFFIRM = /\b(yes|yeah|yep|sure|ok|okay|please do|go ahead|details)\b|ಹೌದು|ಸರಿ|ವಿವರ|ಮಾಡಿ/i;
const MAP_ACTION = /(map|location|place|where|pin|on the map)|ನಕ್ಷೆ|ಸ್ಥ��|ಎಲ್ಲಿ/i;
const NETWORK_ACTION = /(network|graph|connections?|links?)|ನೆಟ್‌ವರ್ಕ್|ಸಂಪರ್ಕ/i;
```

Add a ref that remembers the last person we were discussing (place it with the other refs near the top of the `Shell` component, e.g. beside `conversationModeRef`):
```ts
  const lastPersonRef = useRef<string>("");
```

Now extend `handle()` inside the copilot effect. Add this block **immediately before** the `// 3) Data query -> Console` comment:
```ts
      // 2.5) Follow-up actions after a person-crime answer (“yes / on the map / in the network”).
      if (lastPersonRef.current && (AFFIRM.test(cmd.query) || MAP_ACTION.test(cmd.query) || NETWORK_ACTION.test(cmd.query))) {
        const who = lastPersonRef.current;
        if (MAP_ACTION.test(cmd.query)) {
          navigate({ to: "/console" });
          window.dispatchEvent(new CustomEvent("satyam:map-focus", { detail: { person: who } }));
          if (detail.speak) speakText(resolved === "kn" ? `${who} ಅವರ ಅಪರಾಧ ಸ್ಥಳವನ್ನು ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ` : `Showing ${who}'s crime location on the map`, speechLang, rate);
        } else {
          // default / “network” / bare “yes” -> open the Network graph for this person
          navigate({ to: "/network" });
          window.dispatchEvent(new CustomEvent("satyam:run-task", { detail: { route: "/network", query: who, task: who, lang: resolved, rate, speak: !!detail.speak } }));
          if (detail.speak) speakText(resolved === "kn" ? `${who} ಅವರ ನೆಟ್‌ವರ್ಕ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ` : `Opening ${who}'s network`, speechLang, rate);
        }
        lastPersonRef.current = "";
        if (conversationModeRef.current) setTimeout(() => resumeListening(), 700);
        closePanel();
        return;
      }

      // 2.6) Person-crime question -> answer in Console, then offer follow-up actions by voice.
      if (PERSON_CRIME_INTENT.test(cmd.query)) {
        // Best-effort name extraction: strip the intent words and common fillers.
        const who = cmd.query
          .replace(PERSON_CRIME_INTENT, " ")
          .replace(/\b(did|does|do|commit|committed|of|the|by|for|show|me|what|which|is|are|his|her|their|tell)\b/gi, " ")
          .replace(/\s+/g, " ").trim();
        if (who) lastPersonRef.current = who;
        const ask = { text: cmd.query, lang: voiceLang === "auto" ? "auto" : speechLang, rate, speak: detail.speak !== false };
        if (pathname === "/console") {
          window.dispatchEvent(new CustomEvent("satyam:voice-send", { detail: ask }));
        } else {
          try { sessionStorage.setItem("satyam:pending-voice", JSON.stringify(ask)); } catch {}
          navigate({ to: "/console" });
        }
        // After the grounded answer is spoken, offer the next step and keep listening.
        if (detail.speak) {
          setTimeout(() => {
            speakText(
              resolved === "kn"
                ? `${lastPersonRef.current} ಅವರ ಇತರ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾ? ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲೇ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಹುಡುಕಲಾ?`
                : `Do you want me to check ${lastPersonRef.current}'s other details? I can show the crime location on the map, or search them in the network.`,
              speechLang, rate,
            );
            if (conversationModeRef.current) resumeListening();
          }, 3500); // give the grounded answer time to speak first
        }
        closePanel();
        return;
      }
```

> **Tip:** turn on **Conversation mode** in the copilot so the mic re-opens automatically after each answer — that's what makes “it waits for my reply” work. The 3.5s delay is a simple gap before the follow-up; for perfectly timed prompts, have the answer's `onEnd` callback trigger the follow-up instead.

### Fix 2c — pin a person's crime location on the map (complete)

I read `CrimeMap.tsx` and the Console: the map is **prop-driven** (`points: Hotspot[]`, `mode`, `trail`) with no internal fetching, and the `cases` table has `latitude` / `longitude` / `place_of_offence`. There is **no** per-person location endpoint yet, so this part adds one, exposes a client method, gives `CrimeMap` a `focus` prop, and wires the Console listener. This is now a full drop-in.

**(i) Backend — new endpoint** (resolve a person by name → their geocoded crime locations). In `backend/app/api/routes/cases.py`, add this **immediately after the `/search` endpoint and BEFORE the `@router.get("/{case_id}")` route** (FastAPI matches in order — a dynamic `/{case_id}` would otherwise swallow `/persons/locations`). It reuses the imports the `/search` endpoint already has (`text`, `Depends`, `get_session`, `AsyncSession`):
```python
@router.get("/persons/locations")
async def person_locations(q: str, session: AsyncSession = Depends(get_session)):
    """Geocoded crime locations for the best name match — used by the voice 'show on map' action."""
    pat = f"%{q.strip()}%"
    sql = text(
        """
        SELECT c.fir_number, c.crime_type, c.place_of_offence, c.latitude, c.longitude
        FROM cases c
        JOIN case_persons cp ON cp.case_id = c.case_id
        JOIN persons p ON p.person_id = cp.person_id
        WHERE p.name ILIKE :pat
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY c.case_id DESC
        LIMIT 50
        """
    )
    rows = (await session.execute(sql, {"pat": pat})).mappings().all()
    return [
        {
            "lat": r["latitude"],
            "lng": r["longitude"],
            "weight": 1,
            "label": f"{r['crime_type'] or 'Crime'} · {r['place_of_offence'] or ''} ({r['fir_number'] or ''})",
        }
        for r in rows
    ]
```
> Because Part 1b mounts `cases.router` at `/api/cases`, this endpoint is reachable at **`/api/cases/persons/locations`**.

**(ii) Frontend client** — in `frontend/src/lib/api/intelligence.ts`, add the type (near the other exported types) and the method (inside the `intelligence` object, next to `searchPersonsAndCases`):
```ts
export type PersonLocation = { lat: number; lng: number; weight: number; label: string };
```
```ts
  personLocations: (q: string) =>
    apiFetch<PersonLocation[]>(`/api/cases/persons/locations?q=${encodeURIComponent(q)}`),
```

**(iii) `CrimeMap` — add a `focus` prop.** In `frontend/src/components/CrimeMap.tsx`, extend the signature. Find:
```tsx
export function CrimeMap({
  points,
  mode = "heat",
  trail,
  animateKey,
}: {
  points: Hotspot[];
  mode?: Mode;
  trail?: Hotspot[];
  animateKey?: number;
}) {
```
Replace with:
```tsx
export function CrimeMap({
  points,
  mode = "heat",
  trail,
  animateKey,
  focus,
}: {
  points: Hotspot[];
  mode?: Mode;
  trail?: Hotspot[];
  animateKey?: number;
  focus?: Hotspot[] | null;
}) {
```
Then add this focus effect **right before the final `return <div ... />`** (it overlays on top of the existing heat/pin layer, in a distinct blue, and zooms in):
```tsx
  // AI focus: highlight a specific person's crime locations and zoom in.
  const focusLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (focusLayerRef.current) { map.removeLayer(focusLayerRef.current); focusLayerRef.current = null; }
    if (!focus || focus.length === 0) return;

    const group = L.layerGroup().addTo(map);
    focusLayerRef.current = group;
    focus.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 11, color: "#2563eb", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.9,
      }).bindPopup(`<strong>${p.label ?? "Crime location"}</strong>`).addTo(group);
      if (i === 0) m.openPopup();
    });
    try {
      const b = L.latLngBounds(focus.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b, { padding: [60, 60], maxZoom: 14 });
    } catch { /* single-point edge case */ }

    return () => { if (focusLayerRef.current) { map.removeLayer(focusLayerRef.current); focusLayerRef.current = null; } };
  }, [focus, ready]);
```

**(iv) Console — import, state, listener, render.** In `frontend/src/routes/console.tsx`:

Add the client import (next to the existing `CrimeMap` import):
```tsx
import { intelligence } from "@/lib/api/intelligence";
```
Add state right after the `trailKey` state (line ~111):
```tsx
  const [mapFocus, setMapFocus] = useState<Hotspot[] | null>(null);
```
Add this listener effect next to the existing `satyam:voice-send` effect:
```tsx
  // AI: focus the map on a person's crime locations.
  useEffect(() => {
    const onMapFocus = async (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const who = d.person || d.place || "";
      if (!who) return;
      setCanvasTab("map");   // make sure the map panel is showing
      setMapMode("pins");
      try {
        const locs = await intelligence.personLocations(who);
        setMapFocus(locs.length ? locs : null);
      } catch (err) {
        console.error("[map-focus] failed:", err);
        setMapFocus(null);
      }
    };
    window.addEventListener("satyam:map-focus", onMapFocus);
    return () => window.removeEventListener("satyam:map-focus", onMapFocus);
  }, []);
```
Finally, pass the prop to the map. Find:
```tsx
              <CrimeMap points={hotspots} mode={mapMode} trail={trail} animateKey={trailKey} />
```
Replace with:
```tsx
              <CrimeMap points={hotspots} mode={mapMode} trail={trail} animateKey={trailKey} focus={mapFocus} />
```

### Part 2 verification
```bash
grep -n "setSeedInput(d.task)" frontend/src/routes/network.tsx     # 2a applied
grep -n "PERSON_CRIME_INTENT\|lastPersonRef\|satyam:map-focus" frontend/src/components/Shell.tsx  # 2b applied
grep -n "satyam:map-focus\|mapFocus\|personLocations" frontend/src/routes/console.tsx   # 2c applied
grep -n "focus" frontend/src/components/CrimeMap.tsx                  # 2c: focus prop + effect
grep -n "persons/locations" backend/app/api/routes/cases.py          # 2c: new endpoint
npx tsc --noEmit
```
Manual: say *“what crime did <name> commit”* → spoken answer, then “Do you want me to check their other details?” → say *“search them in the network”* → Network opens with the name in the Seed box and the graph drawn; or say *“show it on the map”* → Console map switches to pins focused on that person.

---

## Part 3 — One-time geocoder (fill `cases.latitude` / `cases.longitude`)

The map pins in Part 2c (and the existing heatmap) only plot rows that already have coordinates. Your `cases` table has `latitude` / `longitude` columns but they're often empty — this script fills them from `place_of_offence` using the **free OpenStreetMap Nominatim** service (no API key; same provider as your map tiles).

Drop this in as `backend/seed/geocode_cases.py` (it mirrors `seed/load_seed.py`'s DSN/arg conventions, uses `asyncpg` + the already-installed `httpx`, and is **idempotent + resumable** — only NULL-coordinate rows are touched unless `--force`):

```python
"""
Satyam — One-time geocoder for case crime locations.

Fills cases.latitude / cases.longitude from cases.place_of_offence using the
free OpenStreetMap Nominatim service (no API key). Run once after seeding so
the voice "show on map" action and the heatmap have coordinates to plot.

Usage:
    # Cloud (Neon) — default (uses DATABASE_URL / SEED_DATABASE_URL / settings)
    python -m seed.geocode_cases

    # Local Postgres
    python -m seed.geocode_cases --local

    # Limit how many rows to process this run (resumable — safe to re-run)
    python -m seed.geocode_cases --limit 500

    # Re-geocode everything, even rows that already have coordinates
    python -m seed.geocode_cases --force

Notes:
  - Respects Nominatim's usage policy: max ~1 request/second, descriptive
    User-Agent, results cached per unique place string (so repeated places cost
    one lookup).
  - Idempotent & resumable: only NULL-coordinate rows are processed unless
    --force is passed. Safe to Ctrl-C and re-run.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SatyamCrimeIntel/1.0 (KSP Datathon; geocoder)"
# Appended to every query to keep results in-state and improve match quality.
REGION_SUFFIX = ", Karnataka, India"
RATE_LIMIT_SECONDS = 1.1  # Nominatim policy: <= 1 request/second


def get_url(local: bool) -> str:
    """Resolve a plain asyncpg DSN, mirroring seed/load_seed.py."""
    if local:
        return "postgresql://satyam:satyam@localhost:5432/satyam"
    raw = os.environ.get("DATABASE_URL") or os.environ.get("SEED_DATABASE_URL")
    if raw:
        return raw.replace("postgresql+asyncpg://", "postgresql://")
    # Fall back to settings
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.config import get_settings
    url = get_settings().seed_database_url
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def geocode(client: httpx.AsyncClient, place: str) -> tuple[float, float] | None:
    """Return (lat, lng) for a place string, or None if not found."""
    params = {
        "q": f"{place}{REGION_SUFFIX}",
        "format": "json",
        "limit": "1",
        "countrycodes": "in",
    }
    try:
        resp = await client.get(
            NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # network / rate-limit / parse — skip, don't crash the run
        print(f"  ! geocode error for {place!r}: {exc}")
        return None
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Geocode cases.place_of_offence -> lat/lng"
    )
    parser.add_argument("--local", action="store_true", help="Use local Postgres")
    parser.add_argument("--limit", type=int, default=0, help="Max rows this run (0 = all)")
    parser.add_argument(
        "--force", action="store_true", help="Re-geocode rows that already have coords"
    )
    args = parser.parse_args()

    url = get_url(args.local)
    ssl = "require" if (".neon.tech" in url or "sslmode=require" in url) else None
    conn: asyncpg.Connection = await asyncpg.connect(url, ssl=ssl)

    where = "place_of_offence IS NOT NULL AND TRIM(place_of_offence) <> ''"
    if not args.force:
        where += " AND (latitude IS NULL OR longitude IS NULL)"
    limit_sql = f" LIMIT {int(args.limit)}" if args.limit > 0 else ""
    rows = await conn.fetch(
        f"SELECT case_id, place_of_offence FROM cases WHERE {where} "
        f"ORDER BY case_id{limit_sql}"
    )
    print(f"Geocoding {len(rows)} case(s)…")

    cache: dict[str, tuple[float, float] | None] = {}
    updated = 0
    misses = 0
    async with httpx.AsyncClient(timeout=20.0) as client:
        for i, row in enumerate(rows, 1):
            place = (row["place_of_offence"] or "").strip()
            key = place.lower()
            if key not in cache:
                cache[key] = await geocode(client, place)
                await asyncio.sleep(RATE_LIMIT_SECONDS)  # sleep only on real network calls
            coords = cache[key]
            if coords is None:
                misses += 1
                continue
            lat, lng = coords
            await conn.execute(
                "UPDATE cases SET latitude = $1, longitude = $2 WHERE case_id = $3",
                lat, lng, row["case_id"],
            )
            updated += 1
            if i % 25 == 0 or i == len(rows):
                print(
                    f"  [{i}/{len(rows)}] updated={updated} "
                    f"misses={misses} unique_places={len(cache)}"
                )

    await conn.close()
    print(
        f"Done. Updated {updated} row(s); {misses} unmatched; "
        f"{len(cache)} unique places looked up."
    )


if __name__ == "__main__":
    asyncio.run(main())
```

### Run it
```bash
cd backend
python -m seed.geocode_cases            # cloud (Neon), only NULL-coord rows
# or: python -m seed.geocode_cases --local
# or: python -m seed.geocode_cases --limit 500   # process in chunks
```

### Verify
```bash
# How many cases now have coordinates (run in psql):
#   SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS geocoded,
#          count(*) AS total FROM cases;
grep -n "persons/locations" backend/app/api/routes/cases.py   # Part 2c endpoint present
```
After it finishes, the voice “show it on the map” action (Part 2c) and the existing heatmap will have real coordinates to plot.

> **Notes & options**
> - Nominatim is free but rate-limited to ~1 req/sec, so a few thousand unique places take a few minutes — the per-place cache means duplicate locations are looked up only once. It's resumable: re-run anytime to pick up rows that are still NULL.
> - The script was syntax-checked with `python -m py_compile` (no compiler errors).
> - For production-scale or higher accuracy, swap `geocode()` to use Google Geocoding or Mapbox by changing the URL/params and reading a key from `app.config` — the rest of the script (caching, batching, resumability) stays the same.

---

## Scope notes (so nothing surprises you)

- **Part 1** is fully concrete and self-contained — safe to apply now.
- **Part 2a/2b/2c** are all concrete, end-to-end drop-ins now. 2c adds a real `/api/cases/persons/locations` endpoint, an `intelligence.personLocations` client call, a `focus` prop on `CrimeMap`, and the Console wiring — so "show it on the map" actually pans/zooms and drops a highlighted pin on that person's crime location(s).
- 2c relies on `cases.latitude` / `cases.longitude` being populated. Rows without coordinates are skipped; if a person's cases aren't geocoded, the map will show no focus pin (the spoken answer still works). Geocode `place_of_offence` into lat/lng if coverage is thin.
- The natural-language understanding of *“what crime did X commit”* is answered by your existing Gemini brain (NL → SQL). The client-side regex here only detects the **intent** so it can offer the follow-up actions; it doesn't replace the LLM.
