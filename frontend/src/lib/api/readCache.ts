/**
 * Short-lived cache for read requests, so returning to a screen shows the data
 * it already had instead of emptying itself and hitting the cloud database again.
 *
 * WHY NOT REACT QUERY, WHICH IS ALREADY INSTALLED
 * `@tanstack/react-query` is a dependency and its provider is mounted in
 * `__root.tsx`, but nothing uses it: all nine data screens hand-roll
 * `useEffect` + `useState` with their own loading, error and abort handling.
 * Getting react-query's cache means consuming data through `useQuery`, which is a
 * rewrite of each of those screens. Caching at the transport seam instead fixes
 * every screen at once, changes no screen logic, and cannot regress their bespoke
 * error paths. If those screens are ever converted to `useQuery`, this layer
 * becomes redundant and should be deleted rather than kept alongside it.
 *
 * SAFETY: THIS IS BROWSER-ONLY, AND THAT IS NOT AN OPTIMISATION
 * Every response here is RLS-scoped to one officer. On the server `getRouter()`
 * runs per request, so a module-level cache would be shared across concurrent
 * users and could hand one officer's jurisdiction data to another. The store is
 * therefore inert unless `window` exists, and it is additionally keyed to the
 * current auth token so switching accounts in one tab cannot show the previous
 * officer's rows.
 */

/** How long a cached read stays fresh. Long enough to cover screen switching. */
const TTL_MS = 5 * 60 * 1000;

/**
 * Paths that must always hit the network.
 *
 * `/settings/db-source` reports which database the SERVER is currently using —
 * that is process-wide backend state, and `client.ts` already warns that a cached
 * browser value can disagree with where answers actually come from. Auth, chat and
 * voice are either mutations or streams and have nothing to gain.
 */
const NEVER_CACHE: RegExp[] = [/\/settings\/db-source/, /\/auth\//, /\/chat\//, /\/voice\//];

type Entry = { json: unknown; status: number; at: number };

const store = new Map<string, Entry>();
/** In-flight requests, so two components mounting together make one call. */
const inflight = new Map<string, Promise<Response>>();
/** The token the current entries belong to. A change wipes the store. */
let authKey: string | null = null;

const isBrowser = () => typeof window !== "undefined";

function currentAuthKey(): string {
  try {
    return isBrowser() ? (window.localStorage.getItem("satyam.token") ?? "anon") : "server";
  } catch {
    return "anon";
  }
}

/** Drop everything, or just entries whose URL contains `match`. */
export function invalidateReadCache(match?: string): void {
  if (!match) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const k of [...store.keys()]) if (k.includes(match)) store.delete(k);
  for (const k of [...inflight.keys()]) if (k.includes(match)) inflight.delete(k);
}

/** Wipe the store when the signed-in officer changes. */
function ensureAuthScope(): void {
  const key = currentAuthKey();
  if (key !== authKey) {
    authKey = key;
    store.clear();
    inflight.clear();
  }
}

function keyFor(url: string, init: RequestInit): string {
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  return `${method} ${url} ${body}`;
}

function cacheable(url: string, init: RequestInit, force?: boolean): boolean {
  if (!isBrowser()) return false;
  if (NEVER_CACHE.some((re) => re.test(url))) return false;
  const method = (init.method ?? "GET").toUpperCase();
  // GET is safe to cache by definition. A POST is only cached when the caller
  // says so, because several read endpoints here are POSTs but so is every
  // mutation, and guessing wrong would serve a stale write.
  return force === true || method === "GET";
}

/**
 * Synchronously read a cached payload without issuing a request.
 *
 * This is what lets a screen render its previous data on the very first frame
 * after remounting. Without it the component starts with empty state and paints a
 * loading skeleton for a frame even on a cache hit, which is the flicker this
 * whole module exists to remove.
 */
export function peekCached<T>(url: string, init: RequestInit = {}): T | undefined {
  if (!cacheable(url, init)) return undefined;
  ensureAuthScope();
  const hit = store.get(keyFor(url, init));
  if (!hit || Date.now() - hit.at > TTL_MS) return undefined;
  return hit.json as T;
}

/**
 * Drop-in replacement for `fetch` for read requests.
 *
 * Returns a Response so the existing transport helpers keep their own status and
 * error handling untouched. On a hit the body is re-serialised from the cached
 * JSON, which costs nothing at these payload sizes and keeps `peekCached` able to
 * hand back a plain object.
 */
export async function cachedFetch(
  url: string,
  init: RequestInit = {},
  opts: { cache?: boolean } = {},
): Promise<Response> {
  if (!cacheable(url, init, opts.cache)) return fetch(url, init);

  ensureAuthScope();
  const key = keyFor(url, init);

  const hit = store.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) {
    return new Response(JSON.stringify(hit.json), {
      status: hit.status,
      headers: { "content-type": "application/json" },
    });
  }

  const pending = inflight.get(key);
  if (pending) return (await pending).clone();

  const p = (async () => {
    const res = await fetch(url, init);
    // Only successes are cached. Caching a 403 would pin an authorisation failure
    // in place for five minutes after the underlying permission was fixed.
    if (res.ok && res.status !== 204) {
      try {
        const json = await res.clone().json();
        store.set(key, { json, status: res.status, at: Date.now() });
      } catch {
        /* not JSON — pass it through uncached */
      }
    }
    return res;
  })();

  inflight.set(key, p);
  try {
    return (await p).clone();
  } finally {
    inflight.delete(key);
  }
}
