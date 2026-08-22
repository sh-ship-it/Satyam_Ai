/** STREET 3D — Google Photorealistic 3D Maps (`<gmp-map-3d>`).
 *
 *  A deliberately separate renderer. This is not MapLibre and not deck.gl: it is
 *  Google's own WebGL globe as a native custom element, so it cannot host our
 *  deck.gl layers. It is therefore a *context view* in the same sense as EARTH —
 *  photoreal ground truth for a location an officer is already looking at, not
 *  an operational surface with data on top.
 *
 *  Why the whole thing is guarded and why it degrades loudly
 *  --------------------------------------------------------
 *  Every other basemap in Vision is key-free by an explicit decision recorded in
 *  VISION.md §0.3. This one is not: it needs a Google Maps key, which means it
 *  can fail in ways the others cannot — missing key, wrong referrer restriction,
 *  daily quota exhausted. Google surfaces most of those as a *silent blank
 *  canvas*, which on a police screen is indistinguishable from "there is nothing
 *  here". So each failure mode is detected and named on screen instead.
 *
 *  Loading contract (all four of these are required, and each fails differently)
 *  --------------------------------------------------------------------------
 *  1. `v=beta`            — Photorealistic 3D Maps is not on the stable channel.
 *                           Without it the maps3d library does not exist.
 *  2. `libraries=maps3d`  — without it `importLibrary("maps3d")` rejects.
 *  3. explicit height     — the custom element collapses to 0 px otherwise and
 *                           renders nothing. This is the single most common
 *                           blank-map cause, and it is exactly the bug we just
 *                           fixed on the MapLibre container, so the sizing here
 *                           is inline for the same reason: it cannot be lost to
 *                           stylesheet order.
 *  4. `mode` attribute    — mandatory. Omitting it yields an infinite loading
 *                           spinner rather than an error.
 */
import { useEffect, useRef, useState } from "react";

/** Karnataka default: Vidhana Soudha, Bengaluru. A recognisable anchor rather
 *  than the state centroid, which in photoreal 3D is an empty field. */
const DEFAULT_CENTER = { lat: 12.9794, lng: 77.5912, altitude: 220 };
const DEFAULT_RANGE = 1400;
const DEFAULT_TILT = 62;

type LoadState = "idle" | "loading" | "ready" | "no-key" | "failed";

/** The bootstrap promise is cached at module scope: the Google loader must only
 *  ever run once per document, and navigating away from /vision and back must not
 *  re-inject the script. */
let mapsPromise: Promise<void> | null = null;

function loadMaps3d(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Street 3D is client-only"));
  }
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<void>((resolve, reject) => {
    const w = window as any;

    const finish = async () => {
      try {
        // The documented way in: returns once the maps3d custom elements are
        // defined. Awaiting this is what guarantees <gmp-map-3d> is upgraded
        // before we append it.
        await w.google.maps.importLibrary("maps3d");
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    // Already bootstrapped by an earlier visit to this route.
    if (w.google?.maps?.importLibrary) {
      void finish();
      return;
    }

    // Readiness comes from Google's `callback` parameter, NOT the script tag's
    // `load` event. This is the subtle part and it cost a real debugging round:
    // with `loading=async` the bootstrap defines `google.maps.importLibrary`
    // asynchronously, so `load` fires while it is still undefined and the first
    // attempt dies with "importLibrary is not a function". Manually poking at it
    // a second later works, which makes it look intermittent rather than wrong.
    // `callback` fires only once the API is genuinely usable.
    const CB = "__satyamGmapsReady";
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-satyam-gmaps]",
    );

    const prior = w[CB];
    w[CB] = () => {
      // Chain rather than clobber: a second mount must not silence the first.
      if (typeof prior === "function") {
        try {
          prior();
        } catch {
          /* ignore a stale listener */
        }
      }
      void finish();
    };

    if (existing) {
      existing.addEventListener("error", () =>
        reject(new Error("Google Maps script failed to load")),
      );
      return;
    }

    const s = document.createElement("script");
    // loading=async is Google's recommended pairing with an async tag and
    // silences their console warning; callback is what makes it deterministic.
    s.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&v=beta" +
      "&libraries=maps3d" +
      "&loading=async" +
      `&callback=${CB}`;
    s.async = true;
    s.defer = true;
    s.dataset.satyamGmaps = "1";
    s.addEventListener("error", () =>
      reject(new Error("Google Maps script blocked or unreachable")),
    );
    document.head.appendChild(s);

    // If the callback never arrives the screen would sit on "LOADING" forever.
    // A blocked key or a rejected referrer can present exactly that way.
    window.setTimeout(() => {
      if (!w.google?.maps?.importLibrary) {
        reject(
          new Error(
            "Google Maps did not initialise within 20s — check the key's HTTP " +
              "referrer restrictions and that the Maps JavaScript API is enabled",
          ),
        );
      }
    }, 20_000);
  });

  // Never cache a rejection: a transient network failure would otherwise poison
  // the view for the rest of the session.
  mapsPromise.catch(() => {
    mapsPromise = null;
  });
  return mapsPromise;
}

export function Street3DCanvas({
  center,
  imagery = "hybrid",
  onError,
}: {
  /** Where to look. Falls back to a Bengaluru landmark. */
  center?: { lat: number; lng: number } | null;
  /** `mode` is mandatory on the element; only these two are meaningful here. */
  imagery?: "hybrid" | "satellite";
  onError?: (message: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<any>(null);
  /** Last camera target actually written to the element. Makes re-centering
   *  idempotent so a re-render cannot yank the camera off the user. See the
   *  follow effect below for the full reasoning. */
  const lastApplied = useRef<{ lat: number; lng: number } | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState<string>("");

  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "";

  // ── Load the library and mount the element ─────────────────────────────────
  useEffect(() => {
    if (!apiKey) {
      setState("no-key");
      return;
    }
    let disposed = false;
    setState("loading");

    loadMaps3d(apiKey).then(
      () => {
        if (disposed || !hostRef.current) return;
        try {
          const el: any = document.createElement("gmp-map-3d");
          // `mode` MUST be present or the element spins forever.
          el.setAttribute("mode", imagery);
          // Sizing inline for the same reason as the MapLibre container: a
          // 0-height custom element renders nothing and reports no error.
          el.style.width = "100%";
          el.style.height = "100%";
          el.style.display = "block";

          const c = center ?? DEFAULT_CENTER;
          // Static values are fine as attributes; dynamic updates below go
          // through properties, which is what the element actually observes.
          el.setAttribute(
            "center",
            `${c.lat},${c.lng},${(c as any).altitude ?? DEFAULT_CENTER.altitude}`,
          );
          el.setAttribute("range", String(DEFAULT_RANGE));
          el.setAttribute("tilt", String(DEFAULT_TILT));

          hostRef.current.appendChild(el);
          elRef.current = el;
          // Record what mount already applied, so the follow effect below treats
          // it as done and does not immediately re-write the same camera.
          lastApplied.current = { lat: c.lat, lng: c.lng };
          setState("ready");
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          setState("failed");
          setMessage(m);
          onError?.(`Street 3D failed to mount: ${m}`);
        }
      },
      (e: unknown) => {
        if (disposed) return;
        const m = e instanceof Error ? e.message : String(e);
        setState("failed");
        setMessage(m);
        onError?.(`Street 3D unavailable: ${m}`);
      },
    );

    return () => {
      disposed = true;
      const el = elRef.current;
      if (el?.parentNode) el.parentNode.removeChild(el);
      elRef.current = null;
    };
    // Imagery mode is applied by the effect below; re-mounting on every change
    // would throw away the loaded tiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // ── Follow the caller's focus, as PROPERTIES not attributes ────────────────
  //
  //  Two rules here, both learned from a real bug: the camera fought the user,
  //  snapping back to the same place every few seconds while they panned.
  //
  //  1. Key off the coordinate VALUES, never the `center` object's identity.
  //     Callers naturally write `center={{ lat: view.lat, lng: view.lng }}`,
  //     which is a fresh object on every render. Vision re-renders on a 15 s
  //     telemetry poll and on every unrelated state change, so an effect keyed
  //     on identity re-ran constantly and re-applied the camera each time.
  //     `lastApplied` makes the move idempotent: if the target has not actually
  //     changed, nothing is written to the element.
  //
  //  2. Never re-apply `range` or `tilt` here. Those are the user's zoom and
  //     pitch once the view is live; resetting them on a re-center threw away
  //     their zoom along with their position. They are set once, at mount.
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    const el = elRef.current;
    if (!el || state !== "ready" || lat == null || lng == null) return;

    const prev = lastApplied.current;
    // ~1e-6 deg is well under a metre, so this only blocks genuine no-ops, not a
    // deliberate fly-to from a dispatch or a district click.
    if (prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lng - lng) < 1e-6) {
      return;
    }

    try {
      el.center = { lat, lng, altitude: DEFAULT_CENTER.altitude };
      lastApplied.current = { lat, lng };
    } catch {
      /* element not upgraded yet; the attribute set at mount still applies */
    }
  }, [lat, lng, state]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || state !== "ready") return;
    el.setAttribute("mode", imagery);
  }, [imagery, state]);

  return (
    <div className="absolute inset-0 bg-[#0b0f17]">
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-[8px] border-2 border-foreground bg-background/90 px-4 py-2 text-xs font-extrabold tracking-wide backdrop-blur">
            LOADING PHOTOREALISTIC 3D&hellip;
          </div>
        </div>
      )}

      {state === "no-key" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-[8px] border-2 border-[#f97316] bg-background/95 px-4 py-3 text-xs backdrop-blur">
            <div className="font-extrabold text-[#f97316]">STREET 3D NOT CONFIGURED</div>
            <p className="mt-1 text-muted-foreground">
              Set <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in{" "}
              <code className="font-mono">frontend/.env</code> and restart the dev server.
              Every other Vision view is unaffected.
            </p>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-[8px] border-2 border-[#ef4444] bg-background/95 px-4 py-3 text-xs backdrop-blur">
            <div className="font-extrabold text-[#ef4444]">STREET 3D UNAVAILABLE</div>
            <p className="mt-1 break-words text-muted-foreground">{message}</p>
            <p className="mt-1.5 text-muted-foreground">
              Usual causes: the key is not restricted to this origin, the Maps
              JavaScript API is not enabled on it, or the daily quota is spent.
            </p>
          </div>
        </div>
      )}

      {/* A blank photoreal canvas is a real and silent Google failure mode
          (quota exhausted, referrer rejected). Naming it beats an empty screen. */}
      {state === "ready" && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-[8px] border-2 border-[#38bdf8] bg-background/95 px-3 py-1 text-[10px] font-extrabold text-[#38bdf8] backdrop-blur">
          CONTEXT VIEW {"\u00b7"} PHOTOREALISTIC 3D {"\u00b7"} NO DATA LAYERS
        </div>
      )}

      <div className="pointer-events-none absolute bottom-0 right-0 z-[400] bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur">
        Imagery {"\u00a9"} Google
      </div>
    </div>
  );
}
