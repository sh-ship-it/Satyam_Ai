/** Vision workspace — owns screen state and composes the canvas + chrome.
 *
 *  Ordering rule that matters: the `satyam:run-task` listener is registered on
 *  the FIRST render, before the map engine is loaded. Shell.runScreenAgent
 *  navigates and then fires the event on a 550 ms timer, so a screen that waits
 *  for WebGL before subscribing silently drops the officer's first voice command
 *  after navigation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./treatments.css";
import { VisionMapCanvas, type VisionViewMode, type VisionViewState } from "./map/VisionMapCanvas";
import { Street3DCanvas } from "./map/Street3DCanvas";
import { BASEMAPS, type BasemapId } from "./map/basemaps";
import { useMapStack } from "./map/useVisionMap";
import {
  buildLayers,
  effectiveHexRadius,
  HEX_RADIUS_CHOICES,
  type HexOptions,
} from "./map/buildLayers";
import { useVisionData } from "./useVisionData";
import { VisionTopBar } from "./chrome/VisionTopBar";
import { LayerMatrixSidebar } from "./chrome/LayerMatrixSidebar";
import { TreatmentBar } from "./chrome/TreatmentBar";
import { CoordinateReadout } from "./chrome/CoordinateReadout";
import {
  IntelligenceDeck,
  type DeckPanel,
  type DeckRow,
  type DeckTabId,
} from "./chrome/IntelligenceDeck";
import { EntityDossier, type OpenEntity } from "./dossiers/EntityDossier";
import { TREATMENT_STORAGE_KEY, treatmentClass, type TreatmentId } from "./chrome/treatments";
import { LAYERS, LAYER_STORAGE_KEY, defaultLayerState, type LayerId } from "./layerRegistry";
import { visionApi, type DistrictIntelResult, type VisionTelemetry } from "@/lib/api/vision";

/** Zones rendered in the deck's risk panel. Capped because the snapshot can
 *  carry several hundred; the badge reports the cap honestly rather than
 *  implying the panel shows everything. */
const RISK_PANEL_LIMIT = 60;

/** Risk label -> dot colour. Same five values the map layers use, so a zone
 *  reads identically in the deck and on the canvas. */
const RISK_ACCENT: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#fbbf24",
  Low: "#3b82f6",
};
import { useT } from "@/lib/i18n";

type RunTaskDetail = {
  route?: string;
  actions?: { screen?: string; action?: string; params?: Record<string, unknown> }[];
};

const BUILDINGS_STORAGE_KEY = "fq-vision-buildings3d";
const HEX_STORAGE_KEY = "fq-vision-hex";
const TELEMETRY_POLL_MS = 15000;
/** Used for the bin radius before the camera has reported a zoom. */
const KARNATAKA_FALLBACK_ZOOM = 6.4;
const TREATMENT_IDS: TreatmentId[] = ["standard", "crt", "nvg", "flir", "radar", "satcom", "noir"];

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — preferences are not worth surfacing an error for */
  }
}

export function VisionWorkspace() {
  const t = useT();

  const [viewMode, setViewMode] = useState<VisionViewMode>("2d");
  const [basemap, setBasemap] = useState<BasemapId>("dark");
  const [treatment, setTreatment] = useState<TreatmentId>("standard");
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(defaultLayerState);
  const [buildings3d, setBuildings3d] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [view, setView] = useState<VisionViewState | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<VisionTelemetry | null>(null);
  const [hex, setHex] = useState<HexOptions>({
    // "auto" derives the bin radius from zoom. A fixed default is invisible at
    // statewide zoom, which reads as "the layer is broken".
    radiusM: "auto",
    elevationScale: 12,
    extruded: true,
  });
  const [open, setOpen] = useState<OpenEntity[]>([]);

  const { stack } = useMapStack();
  const mapRef = useRef<any>(null);

  // Committed on submit rather than per keystroke: each change is a server round
  // trip, and the API measures 250-500 ms.
  const [districtFilter, setDistrictFilter] = useState<string | null>(null);

  const bbox = view?.bbox ?? null;
  const { snapshot, transport, error: dataError } = useVisionData(bbox, districtFilter);

  // ── Restore persisted preferences after mount (never during SSR) ───────────
  useEffect(() => {
    setTreatment(readStored<TreatmentId>(TREATMENT_STORAGE_KEY, "standard"));
    setBuildings3d(readStored<boolean>(BUILDINGS_STORAGE_KEY, false));
    setVisible((prev) => ({ ...prev, ...readStored(LAYER_STORAGE_KEY, {}) }));
    setHex((prev) => ({ ...prev, ...readStored(HEX_STORAGE_KEY, {}) }));
  }, []);

  const flyTo = useCallback((lat: number, lng: number, zoom = 14) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.flyTo({ center: [lng, lat], zoom, duration: 900 });
    } catch {
      /* map torn down mid-flight */
    }
  }, []);

  const openEntity = useCallback((kind: OpenEntity["kind"], id: string | number) => {
    setOpen((prev) =>
      prev.some((e) => e.kind === kind && String(e.id) === String(id))
        ? prev
        : [...prev, { kind, id }],
    );
  }, []);

  // ── Voice: register before the map loads ───────────────────────────────────
  const applyRef = useRef<(d: RunTaskDetail) => void>(() => {});
  applyRef.current = (detail: RunTaskDetail) => {
    for (const a of detail.actions ?? []) {
      if (a.screen && a.screen !== "/vision") continue;
      const p = a.params ?? {};
      switch (a.action) {
        case "set_view": {
          // Accepts a few spoken forms per mode: the screen agent passes through
          // whatever the officer said, so "street" and "street 3d" both land here.
          const raw = String(p.mode ?? "")
            .toLowerCase()
            .replace(/[\s_-]+/g, "");
          const m: VisionViewMode | null =
            raw === "2d" || raw === "flat"
              ? "2d"
              : raw === "3d" || raw === "tilt" || raw === "terrain"
                ? "3d"
                : raw === "earth" || raw === "globe"
                  ? "earth"
                  : raw === "street3d" || raw === "street" || raw === "photoreal"
                    ? "street3d"
                    : null;
          if (m) setViewMode(m);
          break;
        }
        case "set_treatment": {
          const n = String(p.name ?? "").toLowerCase() as TreatmentId;
          if (TREATMENT_IDS.includes(n)) {
            setTreatment(n);
            writeStored(TREATMENT_STORAGE_KEY, n);
          }
          break;
        }
        case "set_basemap": {
          const b = String(p.basemap ?? "").toLowerCase();
          if (b in BASEMAPS) setBasemap(b as BasemapId);
          break;
        }
        case "toggle_layer": {
          const id = String(p.layer ?? "") as LayerId;
          if (LAYERS.some((l) => l.id === id)) {
            const on = p.on === undefined ? undefined : Boolean(p.on);
            setVisible((prev) => {
              const next = { ...prev, [id]: on === undefined ? !prev[id] : on };
              writeStored(LAYER_STORAGE_KEY, next);
              return next;
            });
          }
          break;
        }
        case "set_hex_radius": {
          const r = Number(p.radius_m);
          if (Number.isFinite(r) && r > 0) {
            setHex((prev) => {
              const next = { ...prev, radiusM: r };
              writeStored(HEX_STORAGE_KEY, next);
              return next;
            });
          }
          break;
        }
        default:
          break;
      }
    }
  };

  useEffect(() => {
    const onRunTask = (e: Event) => {
      const detail = (e as CustomEvent<RunTaskDetail>).detail;
      if (detail?.route && detail.route !== "/vision") return;
      applyRef.current(detail ?? {});
    };
    window.addEventListener("satyam:run-task", onRunTask);
    return () => window.removeEventListener("satyam:run-task", onRunTask);
  }, []);

  // ── Telemetry poll ─────────────────────────────────────────────────────────
  useEffect(() => {
    let stop = false;
    const tick = () =>
      visionApi
        .telemetry()
        .then((tm) => !stop && setTelemetry(tm))
        .catch(() => {});
    tick();
    const id = setInterval(tick, TELEMETRY_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const onError = useCallback((m: string) => setNotice(m), []);

  /** Apply a district filter from anywhere (search box, deck panel row).
   *  Deliberately does NOT move the camera: there is no geocoder here, and
   *  flying to a guessed centroid would invent a location. */
  const submitSearchTerm = useCallback(
    (term: string) => {
      const clean = term.trim();
      if (!clean) {
        setDistrictFilter(null);
        setNotice(null);
        return;
      }
      // The backend filters `cases.district ILIKE %term%`, so a partial name works.
      setQuery(clean);
      setDistrictFilter(clean);
      setNotice(`${t("Crime layer filtered to district")} "${clean}"`);
    },
    [t],
  );

  const submitSearch = useCallback(() => {
    submitSearchTerm(query);
  }, [query, submitSearchTerm]);

  const toggleLayer = useCallback((id: LayerId) => {
    setVisible((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeStored(LAYER_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleBuildings = useCallback(() => {
    setBuildings3d((v) => {
      writeStored(BUILDINGS_STORAGE_KEY, !v);
      return !v;
    });
  }, []);

  const selectTreatment = useCallback((id: TreatmentId) => {
    setTreatment(id);
    writeStored(TREATMENT_STORAGE_KEY, id);
  }, []);

  const setHexRadius = useCallback((radiusM: number | "auto") => {
    setHex((prev) => {
      const next = { ...prev, radiusM };
      writeStored(HEX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  // ── Layer state derived from the snapshot ─────────────────────────────────
  const counts = useMemo<Partial<Record<LayerId, number>>>(() => {
    const out: Partial<Record<LayerId, number>> = {};
    if (!snapshot) return out;
    for (const [id, env] of Object.entries(snapshot.layers)) {
      if (env) out[id as LayerId] = env.count;
    }
    return out;
  }, [snapshot]);

  const degraded = useMemo(() => {
    const out: Partial<Record<LayerId, string>> = {};
    // The environment layer has no endpoint yet; say so rather than showing an
    // empty switch that looks broken.
    out.environment = t("Environment feed not wired yet.");
    if (!snapshot) {
      if (dataError) {
        for (const l of LAYERS) out[l.id] = t("Cannot reach the Vision API.");
      }
      return out;
    }
    for (const [id, env] of Object.entries(snapshot.layers)) {
      if (env?.degraded) out[id as LayerId] = env.degraded;
    }
    return out;
  }, [snapshot, dataError, t]);

  // Quantise the zoom so a smooth pan/zoom does not rebuild every layer on each
  // animation frame; the bin radius only changes at the thresholds anyway.
  const zoomBucket = view ? Math.round(view.zoom * 2) / 2 : KARNATAKA_FALLBACK_ZOOM;

  const layers = useMemo(() => {
    if (!stack) return [];
    return buildLayers({
      deck: stack.deck,
      snapshot,
      visible,
      hex,
      zoom: zoomBucket,
      onPick: openEntity,
    });
  }, [stack, snapshot, visible, hex, zoomBucket, openEntity]);

  const activeLayerCount = useMemo(
    () => LAYERS.filter((l) => visible[l.id] && !degraded[l.id]).length,
    [visible, degraded],
  );

  // ── Intelligence deck rows ────────────────────────────────────────────────
  const deckRows = useMemo<Partial<Record<DeckTabId, DeckRow[]>>>(() => {
    if (!snapshot) return {};
    const dispatches = snapshot.layers.dispatches?.data ?? [];
    const zones = snapshot.layers.risk_zones?.data ?? [];
    return {
      dispatches: dispatches.map((d) => ({
        id: `d-${d.id}`,
        title: `Dispatch ${d.id}${d.case_id ? ` \u00b7 case #${d.case_id}` : ""}`,
        detail: d.eta_sec != null ? `ETA ${Math.round(d.eta_sec / 60)}m` : d.status,
        accent: "#00E6A8",
        onFocus: () => {
          flyTo(d.scene_lat, d.scene_lng);
          openEntity("dispatch", d.id);
        },
      })),
      risk: zones.slice(0, 25).map((z) => ({
        id: `z-${z.id}`,
        title: `${z.label} \u00b7 ${z.incidents} incidents`,
        detail: z.score.toFixed(1),
        accent: "#fbbf24",
        onFocus: () => {
          flyTo(z.lat, z.lng, 13);
          openEntity("risk_zone", z.id);
        },
      })),
    };
  }, [snapshot, flyTo, openEntity]);

  // ── District intelligence for the expanded deck ────────────────────────────
  // Fetched once on mount, not per bbox: these are district-level aggregates
  // that do not change as the camera moves, so re-fetching on pan would be pure
  // waste. Failure is non-fatal — the panel explains itself.
  const [districtIntel, setDistrictIntel] = useState<DistrictIntelResult | null>(null);
  useEffect(() => {
    let stop = false;
    visionApi
      .districtIntel()
      .then((d) => {
        if (!stop) setDistrictIntel(d);
      })
      .catch(() => {
        if (!stop)
          setDistrictIntel({ districts: [], degraded: ["District intelligence unavailable."] });
      });
    return () => {
      stop = true;
    };
  }, []);

  const deckPanels = useMemo<DeckPanel[]>(() => {
    const zones = snapshot?.layers.risk_zones?.data ?? [];
    const dispatches = snapshot?.layers.dispatches?.data ?? [];
    const cams = snapshot?.layers.cameras?.data ?? [];
    const patrols = snapshot?.layers.patrols?.data ?? [];

    const num = (v: number | null | undefined, suffix = "") =>
      v == null ? "\u2014" : `${typeof v === "number" ? v.toFixed(1) : v}${suffix}`;

    // 1. District intelligence — the police analogue of a place dossier.
    const districts = districtIntel?.districts ?? [];
    const districtBody =
      districts.length === 0 ? undefined : (
        <div className="space-y-1">
          {districtIntel?.degraded?.length ? (
            <p className="mb-1 rounded-[4px] border border-[#f97316]/50 px-1.5 py-1 text-[9px] font-bold text-[#f97316]">
              {districtIntel.degraded.join(" ")}
            </p>
          ) : null}
          <table className="w-full text-[10px]">
            <thead className="text-[9px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left font-bold">{t("District")}</th>
                <th className="text-right font-bold">{t("Risk")}</th>
                <th className="text-right font-bold">{t("Crime rate")}</th>
                <th className="text-right font-bold">{t("Literacy")}</th>
                <th className="text-right font-bold">{t("Urban")}</th>
              </tr>
            </thead>
            <tbody>
              {districts.map((d) => (
                <tr
                  key={d.district}
                  className="cursor-pointer border-t border-foreground/10 hover:bg-foreground/5"
                  onClick={() => submitSearchTerm(d.district)}
                  title={d.drivers.length ? d.drivers.join(", ") : undefined}
                >
                  <td className="truncate py-0.5 font-bold">{d.district}</td>
                  <td className="py-0.5 text-right font-mono">{d.social_risk_score ?? "\u2014"}</td>
                  <td className="py-0.5 text-right font-mono">{num(d.crime_rate)}</td>
                  <td className="py-0.5 text-right font-mono">{num(d.literacy_rate, "%")}</td>
                  <td className="py-0.5 text-right font-mono">
                    {num(d.urbanization_percent, "%")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-1 text-[9px] text-muted-foreground">
            {t("Aggregate planning view. Never an individual risk judgement.")}
          </p>
        </div>
      );

    // 2. Risk matrix — already scored server-side, with its drivers.
    const riskBody =
      zones.length === 0 ? undefined : (
        <ul className="space-y-0.5">
          {zones.slice(0, RISK_PANEL_LIMIT).map((z) => (
            <li key={z.id}>
              <button
                onClick={() => {
                  flyTo(z.lat, z.lng, 13);
                  openEntity("risk_zone", z.id);
                }}
                title={[z.label, ...(z.reasons ?? [])].join(" \u00b7 ")}
                className="flex w-full items-center gap-1.5 rounded-[3px] px-1 py-0.5 text-left hover:bg-foreground/5"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: RISK_ACCENT[z.label] ?? "#3b82f6" }}
                  title={z.label}
                />
                {/* The tier is already the dot colour, so repeating it as text
                    made every row read "High". Zones carry no place name, so
                    coordinates are the identity; `reasons` is not shown inline
                    because all three entries restate incidents, severity and
                    peak hour, which are already columns or in the tooltip. */}
                <span className="shrink-0 font-mono text-[10px] font-bold">
                  {z.lat.toFixed(3)}, {z.lng.toFixed(3)}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {z.score.toFixed(1)} {"\u00b7"} {z.incidents}
                  {z.peak_hour != null && (
                    <>
                      {" "}
                      {"\u00b7"} {String(z.peak_hour).padStart(2, "0")}h
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      );

    // 3. Coverage & provenance — the honest status of every layer in one place,
    //    including why a layer is empty. This is the panel that stops an empty
    //    map reading as "no crime here".
    // Structural view of the layer envelopes: every layer shares provenance and
    // a data array, so one shape covers all of them without a cast.
    type EnvelopeLike = { provenance?: string; data?: unknown } | undefined;
    const envelopes = snapshot
      ? Object.entries(snapshot.layers as Record<string, EnvelopeLike>).map(([name, v]) => ({
          name,
          provenance: v?.provenance,
          count: Array.isArray(v?.data) ? v.data.length : undefined,
        }))
      : [];
    const coverageBody = !snapshot ? undefined : (
      <div className="space-y-0.5">
        {envelopes.map((e) => (
          <div key={e.name} className="flex items-center gap-1.5 text-[10px]">
            <span className="truncate font-bold">{e.name.replace(/_/g, " ")}</span>
            <span className="ml-auto shrink-0 rounded-full bg-foreground/10 px-1.5 text-[9px] font-bold uppercase">
              {e.provenance ?? "\u2014"}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted-foreground">
              {e.count ?? "\u2014"}
            </span>
          </div>
        ))}
        {snapshot.degraded?.length ? (
          <p className="mt-1 rounded-[4px] border border-[#f97316]/50 px-1.5 py-1 text-[9px] font-bold text-[#f97316]">
            {snapshot.degraded.join(" \u00b7 ")}
          </p>
        ) : (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t("All requested layers returned.")}
          </p>
        )}
        {snapshot.coords_coarsened && (
          <p className="text-[9px] font-bold text-[#f97316]">
            {t("Coordinates coarsened for your clearance.")}
          </p>
        )}
      </div>
    );

    // 4. Field assets — what is actually deployable right now.
    const assetsBody = !snapshot ? undefined : (
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {[
          [t("Patrol units"), patrols.length],
          [t("Active dispatches"), dispatches.length],
          [t("Cameras"), cams.length],
          [t("Risk zones"), zones.length],
        ].map(([label, n]) => (
          <div
            key={String(label)}
            className="rounded-[4px] border border-foreground/20 px-1.5 py-1"
          >
            <div className="font-mono text-[13px] font-extrabold">{String(n)}</div>
            <div className="text-[9px] text-muted-foreground">{String(label)}</div>
          </div>
        ))}
      </div>
    );

    return [
      {
        id: "district",
        title: "DISTRICT INTELLIGENCE",
        badge: districts.length ? String(districts.length) : undefined,
        wide: true,
        body: districtBody,
        emptyNote: districtIntel?.degraded?.join(" ") ?? t("Loading district indicators\u2026"),
      },
      {
        id: "risk",
        title: "RISK MATRIX",
        badge: zones.length
          ? zones.length > RISK_PANEL_LIMIT
            ? `${RISK_PANEL_LIMIT} / ${zones.length}`
            : String(zones.length)
          : undefined,
        body: riskBody,
        emptyNote: t("No risk zones in range."),
      },
      {
        id: "assets",
        title: "FIELD ASSETS",
        body: assetsBody,
        emptyNote: t("No snapshot yet."),
      },
      {
        id: "coverage",
        title: "COVERAGE & PROVENANCE",
        badge: snapshot?.degraded?.length ? t("DEGRADED") : undefined,
        body: coverageBody,
        emptyNote: t("No snapshot yet."),
      },
    ];
  }, [snapshot, districtIntel, flyTo, openEntity, submitSearchTerm, t]);

  const deckEmpty = useMemo<Partial<Record<DeckTabId, string>>>(
    () => ({
      dispatches:
        telemetry && !telemetry.ops_enabled
          ? t("Response Ops is off on the server, so there are no live dispatches.")
          : t("No active dispatches."),
      review: t("Camera review queue is empty."),
      risk: t("No risk zones in range."),
      alerts: t("No alerts."),
    }),
    [telemetry, t],
  );

  return (
    // Flex column, not a pile of absolutely-positioned siblings. The deck and the
    // coordinate readout occupy real rows, so the floating panels inside the map
    // area cannot collide with them however tall the deck grows. The previous
    // version anchored the sidebar and treatment bar to a fixed `bottom-28` while
    // the deck expanded upward past it, which overlapped all three.
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        {/* Treatment wrapper: the CSS filter applies to the map only, so the chrome
            above it stays readable under NVG/FLIR/CRT. */}
        <div className={treatmentClass(treatment)}>
          {viewMode === "street3d" ? (
            // Google's element is its own renderer and cannot host deck.gl
            // layers, so MapLibre is unmounted rather than parked behind it —
            // two idle WebGL contexts plus MediaPipe on the same page is exactly
            // the contention VISION.md's Phase 0 warned about.
            //
            // `view` is intentionally not cleared: the last bbox stays valid, so
            // the sidebar counts and the deck keep their data instead of
            // emptying while the officer is in a context view.
            <Street3DCanvas
              center={view ? { lat: view.lat, lng: view.lng } : null}
              imagery={basemap === "satellite" ? "satellite" : "hybrid"}
              onError={onError}
            />
          ) : (
            <VisionMapCanvas
              viewMode={viewMode}
              basemap={basemap}
              layers={layers}
              buildings3d={buildings3d}
              onViewState={setView}
              onMapReady={(m) => {
                mapRef.current = m;
              }}
              onError={onError}
            />
          )}
        </div>

        <VisionTopBar
          viewMode={viewMode}
          basemap={basemap}
          telemetry={telemetry}
          transport={transport}
          query={query}
          onViewMode={setViewMode}
          onBasemap={setBasemap}
          onQuery={setQuery}
          onPreset={(p) => flyTo(p.lat, p.lng, p.zoom)}
          onSubmitQuery={submitSearch}
        />

        {/* Left rail: layer matrix. Bounded to the map area and scrollable, so a
            long layer list cannot push into the deck below. */}
        <div className="pointer-events-none absolute bottom-3 left-3 top-24 z-[1000] flex max-h-[calc(100%-7rem)] flex-col items-start gap-2 overflow-hidden">
          <LayerMatrixSidebar
            visible={visible}
            counts={counts}
            degraded={degraded}
            collapsed={sidebarCollapsed}
            buildings3d={buildings3d}
            onToggleLayer={toggleLayer}
            onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            onToggleBuildings={toggleBuildings}
          />
        </div>

        {/* Right rail: bin radius + treatments, pinned to the bottom of the map
            area rather than to a guessed offset from the window. */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-2">
          {visible.crime_hex && !degraded.crime_hex && (
            <div className="pointer-events-auto flex items-center gap-1 rounded-[8px] border-2 border-foreground bg-background/90 px-2 py-1 backdrop-blur">
              <span
                title={t("Hexagon bin radius. AUTO scales it with the zoom level.")}
                className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
              >
                {t("BIN")}
              </span>
              {HEX_RADIUS_CHOICES.map((r) => (
                <button
                  key={String(r)}
                  onClick={() => setHexRadius(r)}
                  aria-pressed={hex.radiusM === r}
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold transition ${
                    hex.radiusM === r
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r === "auto" ? "AUTO" : r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </button>
              ))}
              <span className="pl-1 font-mono text-[9px] text-muted-foreground">
                {effectiveHexRadius(hex, zoomBucket)}m
              </span>
            </div>
          )}
          <TreatmentBar active={treatment} onSelect={selectTreatment} />
        </div>

        {/* Dossiers live in the map area so `bounds="parent"` keeps them on the map
            instead of letting them be dragged over the deck. */}
        {open.map((e) => (
          <EntityDossier
            key={`${e.kind}-${e.id}`}
            entity={e}
            onClose={() =>
              setOpen((prev) =>
                prev.filter((x) => !(x.kind === e.kind && String(x.id) === String(e.id))),
              )
            }
            onFocus={(lat, lng) => flyTo(lat, lng, 15)}
          />
        ))}

        {notice && (
          <div className="pointer-events-auto absolute left-1/2 top-24 z-[1100] flex max-w-[80%] -translate-x-1/2 items-start gap-2 rounded-[8px] border-2 border-[#f97316] bg-background/95 px-3 py-1.5 text-[11px] font-bold backdrop-blur">
            <span>{notice}</span>
            <button
              onClick={() => setNotice(null)}
              className="shrink-0 opacity-60 hover:opacity-100"
              aria-label={t("Dismiss")}
            >
              {"\u00d7"}
            </button>
          </div>
        )}
      </div>

      {/* Real rows below the map, so they can never overlap the panels above. */}
      <IntelligenceDeck rows={deckRows} emptyNote={deckEmpty} panels={deckPanels} />
      <CoordinateReadout
        view={view}
        layerCount={activeLayerCount}
        coordsCoarsened={!!snapshot?.coords_coarsened}
      />
    </div>
  );
}
