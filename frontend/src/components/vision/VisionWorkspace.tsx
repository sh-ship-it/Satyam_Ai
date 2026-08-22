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
import { IntelligenceDeck, type DeckRow, type DeckTabId } from "./chrome/IntelligenceDeck";
import { EntityDossier, type OpenEntity } from "./dossiers/EntityDossier";
import { TREATMENT_STORAGE_KEY, treatmentClass, type TreatmentId } from "./chrome/treatments";
import { LAYERS, LAYER_STORAGE_KEY, defaultLayerState, type LayerId } from "./layerRegistry";
import { visionApi, type VisionTelemetry } from "@/lib/api/vision";
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
const TREATMENT_IDS: TreatmentId[] = [
  "standard",
  "crt",
  "nvg",
  "flir",
  "radar",
  "satcom",
  "noir",
];

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

  const openEntity = useCallback(
    (kind: OpenEntity["kind"], id: string | number) => {
      setOpen((prev) =>
        prev.some((e) => e.kind === kind && String(e.id) === String(id))
          ? prev
          : [...prev, { kind, id }],
      );
    },
    [],
  );

  // ── Voice: register before the map loads ───────────────────────────────────
  const applyRef = useRef<(d: RunTaskDetail) => void>(() => {});
  applyRef.current = (detail: RunTaskDetail) => {
    for (const a of detail.actions ?? []) {
      if (a.screen && a.screen !== "/vision") continue;
      const p = a.params ?? {};
      switch (a.action) {
        case "set_view": {
          const m = String(p.mode ?? "").toLowerCase();
          if (m === "2d" || m === "3d" || m === "earth") setViewMode(m);
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

  const submitSearch = useCallback(() => {
    const term = query.trim();
    if (!term) {
      setDistrictFilter(null);
      setNotice(null);
      return;
    }
    // The backend filters `cases.district ILIKE %term%`, so a partial name works.
    // No client-side geocoding is attempted: pretending to fly to an arbitrary
    // place name would invent a location.
    setDistrictFilter(term);
    setNotice(`${t("Crime layer filtered to district")} "${term}"`);
  }, [query, t]);

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

  const deckEmpty = useMemo<Partial<Record<DeckTabId, string>>>(
    () => ({
      dispatches: telemetry && !telemetry.ops_enabled
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
      <IntelligenceDeck rows={deckRows} emptyNote={deckEmpty} />
      <CoordinateReadout
        view={view}
        layerCount={activeLayerCount}
        coordsCoarsened={!!snapshot?.coords_coarsened}
      />
    </div>
  );
}
