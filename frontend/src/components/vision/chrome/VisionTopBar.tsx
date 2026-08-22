/** Slim top band: title, entity search, view modes, basemap, telemetry pill.
 *
 *  Deliberately one band. Shell already owns a 56 px header and a 64 px rail, so
 *  Vision cannot afford Akashic's full-width nav without eating the map.
 */
import { Search, Satellite, Crosshair } from "lucide-react";
import { useT } from "@/lib/i18n";
import { BASEMAPS, type BasemapId } from "../map/basemaps";
import type { VisionViewMode } from "../map/VisionMapCanvas";
import type { VisionTelemetry } from "@/lib/api/vision";

const VIEW_MODES: { id: VisionViewMode; label: string }[] = [
  { id: "2d", label: "2D" },
  { id: "3d", label: "3D" },
  { id: "earth", label: "EARTH" },
];

/** Camera presets.
 *
 *  These exist because the two useful framings of this data are at very different
 *  scales: the crime surface is statewide and dense, while live ops units are
 *  concentrated in the city. Jumping between them by dragging costs a demo its
 *  momentum. This is a camera move only — it changes no layer state and hides no
 *  data. */
export type CameraPreset = { id: string; label: string; lat: number; lng: number; zoom: number };

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "karnataka", label: "KARNATAKA", lat: 14.5, lng: 75.7, zoom: 6.4 },
  { id: "bengaluru", label: "BENGALURU", lat: 12.9716, lng: 77.5946, zoom: 11 },
];

/** Live | Polling | Offline — whichever transport is actually in force.
 *  Showing it makes a WebSocket outage legible instead of looking like a frozen
 *  map, which matters because WebSocket support on the deploy target is not
 *  guaranteed. */
export type TransportState = "live" | "polling" | "offline";

export function VisionTopBar({
  viewMode,
  basemap,
  telemetry,
  transport,
  query,
  onViewMode,
  onBasemap,
  onQuery,
  onSubmitQuery,
  onPreset,
}: {
  viewMode: VisionViewMode;
  basemap: BasemapId;
  telemetry: VisionTelemetry | null;
  transport: TransportState;
  query: string;
  onViewMode: (m: VisionViewMode) => void;
  onBasemap: (b: BasemapId) => void;
  onQuery: (q: string) => void;
  onSubmitQuery: () => void;
  onPreset: (p: CameraPreset) => void;
}) {
  const t = useT();

  const dot =
    transport === "live" ? "#00E6A8" : transport === "polling" ? "#fbbf24" : "#ef4444";
  const transportLabel =
    transport === "live" ? "LIVE" : transport === "polling" ? "POLLING" : "OFFLINE";

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-3 z-[1000] flex flex-wrap items-start justify-between gap-2">
      {/* Left: identity + search */}
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="rounded-[8px] border-2 border-foreground bg-background/92 px-3 py-1.5 backdrop-blur">
          <div className="text-sm font-extrabold leading-none">{t("Vision")}</div>
          <div className="mt-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
            {viewMode === "earth"
              ? t("CONTEXT VIEW \u2014 NOT OPERATIONAL")
              : t("TACTICAL MAP")}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitQuery();
          }}
          className="flex items-center gap-1.5 rounded-[8px] border-2 border-foreground bg-background/92 px-2 py-1.5 backdrop-blur"
        >
          <Search className="h-3.5 w-3.5 opacity-60" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("Search district, station, FIR\u2026")}
            aria-label={t("Search the map")}
            className="w-44 bg-transparent text-[11px] font-bold outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
        </form>
      </div>

      {/* Right: view modes, basemaps, telemetry */}
      <div className="pointer-events-auto flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-full border-2 border-foreground bg-background/92 backdrop-blur">
            {VIEW_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onViewMode(m.id)}
                aria-pressed={viewMode === m.id}
                className={`px-3 py-1 text-[11px] font-extrabold transition ${
                  viewMode === m.id
                    ? "bg-[var(--main,#91C5FD)] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div
            title={
              telemetry
                ? `${t("DB")} ${telemetry.db_latency_ms ?? "?"}ms \u00b7 ${telemetry.db_source} \u00b7 ${
                    telemetry.ws_clients
                  } ${t("clients")}`
                : t("Telemetry unavailable")
            }
            className="flex items-center gap-1.5 rounded-full border-2 border-foreground bg-background/92 px-2.5 py-1 text-[10px] font-extrabold backdrop-blur"
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ background: dot }}
            />
            {transportLabel}
            {telemetry?.db_latency_ms != null && (
              <span className="font-mono text-muted-foreground">
                {Math.round(telemetry.db_latency_ms)}ms
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Camera presets. Disabled on the globe, where a Mercator zoom target
              is meaningless. */}
          <div className="flex items-center overflow-hidden rounded-full border-2 border-foreground bg-background/92 backdrop-blur">
            <span className="pl-2 pr-1 text-muted-foreground">
              <Crosshair className="h-3 w-3" />
            </span>
            {CAMERA_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onPreset(p)}
                disabled={viewMode === "earth"}
                title={
                  viewMode === "earth"
                    ? t("Switch to 2D or 3D to jump the camera")
                    : `${t("Fly to")} ${t(p.label)}`
                }
                className="px-2 py-1 text-[10px] font-bold text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              >
                {t(p.label)}
              </button>
            ))}
          </div>

          <div className="flex overflow-hidden rounded-full border-2 border-foreground bg-background/92 backdrop-blur">
            {Object.values(BASEMAPS).map((b) => (
              <button
                key={b.id}
                onClick={() => onBasemap(b.id)}
                aria-pressed={basemap === b.id}
                title={
                  b.contextOnly
                    ? `${t(b.label)} \u2014 ${t("wide-area context only, max zoom")} ${b.maxNativeZoom}`
                    : t(b.label)
                }
                className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold transition ${
                  basemap === b.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.contextOnly && <Satellite className="h-2.5 w-2.5" />}
                {t(b.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Security posture. Surfaced because a jurisdiction guarantee that is
            invisible is a guarantee that silently regresses on deploy. */}
        {telemetry && !telemetry.rls_enforced && (
          <div
            title={telemetry.rls_note ?? undefined}
            className="rounded-full border-2 border-[#f97316] bg-[#2a1607]/90 px-2.5 py-0.5 text-[9px] font-extrabold text-[#f97316] backdrop-blur"
          >
            {t("DB-LEVEL RLS NOT ENFORCED \u2014 APP-LAYER SCOPING ONLY")}
          </div>
        )}
      </div>
    </div>
  );
}
