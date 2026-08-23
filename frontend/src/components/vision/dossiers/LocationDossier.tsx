/** Click-to-inspect popup for a point on the map: what is here, and what has
 *  been recorded near here.
 *
 *  Why this is a *location* panel and not another entity dossier
 *  ------------------------------------------------------------
 *  Crime bins are aggregated on the client by deck.gl's HexagonLayer. A picked
 *  bin has no id and no server-side record — it is a shape the browser computed
 *  from a list of coordinates. So the only thing a click on it can identify is a
 *  place, which is why this fetches by lat/lng rather than by id and why it
 *  reuses `DraggableDossier` instead of extending `EntityDossier`.
 *
 *  Two honesty rules this panel follows
 *  ------------------------------------
 *  1. **The radius is always stated.** The count here is "cases within N metres
 *     of this point", which is deliberately not the same number as the bin's own
 *     total: a bin at statewide zoom can be kilometres across. Showing a bare
 *     count next to a hexagon would imply they are the same figure. They are not,
 *     so the radius is in the header, in the stat label, and adjustable.
 *  2. **Place names are labelled as inferred.** There is no reverse geocoder in
 *     this stack. District, station and place come from the nearest recorded
 *     case, so a point in open country legitimately has no name. The panel says
 *     so rather than displaying the nearest town from kilometres away as if it
 *     were this spot.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Crosshair } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  visionApi,
  LOCATION_RADIUS_CHOICES,
  LOCATION_RADIUS_DEFAULT_M,
  type VisionLocation,
} from "@/lib/api/vision";
import { DraggableDossier, Field } from "./DraggableDossier";

/** Esri World Imagery: key-free, HTTPS, and real aerial detail to z19.
 *
 *  Chosen over the existing `satellite` basemap because that one is NASA GIBS
 *  BlueMarble capped at zoom 8 and flagged `contextOnly` — a single tile spans
 *  roughly 150 km, which is useless as a picture of a street corner.
 *
 *  Row before column in the path (`/{z}/{y}/{x}`), same trap as GIBS. Getting it
 *  backwards returns a valid image of the wrong place, not an error.
 */
const ESRI_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const ESRI_ATTRIBUTION = "Imagery \u00a9 Esri, Maxar, Earthstar Geographics";

/** Web-Mercator tile containing a point, plus where inside that tile it falls.
 *  The fractional part is what lets the crosshair sit on the exact coordinate
 *  instead of the tile's centre, which would be up to half a tile off. */
function tileFor(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const xf = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, z, fx: xf - x, fy: yf - y };
}

/** Imagery zoom that roughly frames the search radius. A z16 tile is about
 *  600 m across at this latitude, z17 about 300 m. */
function zoomForRadius(radiusM: number): number {
  if (radiusM <= 200) return 18;
  if (radiusM <= 400) return 17;
  if (radiusM <= 800) return 16;
  if (radiusM <= 1500) return 15;
  return 14;
}

const CRIME_BAR = "#ef4444";

function AerialThumb({ lat, lng, radiusM }: { lat: number; lng: number; radiusM: number }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const tile = useMemo(() => tileFor(lat, lng, zoomForRadius(radiusM)), [lat, lng, radiusM]);

  // A broken <img> renders as a browser placeholder, which on an intelligence
  // screen reads as "no imagery exists here" rather than "the tile CDN failed".
  if (failed) {
    return (
      <div className="mb-2 grid h-28 place-items-center rounded-[4px] border border-foreground/20 bg-foreground/5 px-2 text-center text-[10px] text-muted-foreground">
        {t("Aerial imagery unavailable \u2014 tile service unreachable.")}
      </div>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-[4px] border border-foreground/20">
      <div className="relative h-28 w-full bg-[#0b0f17]">
        <img
          src={`${ESRI_IMAGERY}/${tile.z}/${tile.y}/${tile.x}`}
          alt={t("Aerial imagery of the selected location")}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {/* Crosshair on the exact coordinate, using its fractional position
            within the tile. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${tile.fx * 100}%`, top: `${tile.fy * 100}%` }}
        >
          <Crosshair className="h-4 w-4 text-[#00E6A8] drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
        </span>
        <span className="absolute bottom-0 right-0 bg-background/75 px-1 text-[8px] text-muted-foreground">
          z{tile.z}
        </span>
      </div>
      <div className="bg-foreground/5 px-1.5 py-[2px] text-[8px] text-muted-foreground">
        {ESRI_ATTRIBUTION}
      </div>
    </div>
  );
}

export function LocationDossier({
  lat,
  lng,
  bin,
  onClose,
  onFocus,
}: {
  lat: number;
  lng: number;
  /** Totals for the crime bin that was clicked, when the click came from one.
   *  Shown beside the radius figure so the two are never conflated. */
  bin?: { cases?: number; cells?: number };
  onClose: () => void;
  onFocus?: (lat: number, lng: number) => void;
}) {
  const t = useT();
  const [radiusM, setRadiusM] = useState<number>(LOCATION_RADIUS_DEFAULT_M);
  const [data, setData] = useState<VisionLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    setLoading(true);
    setError(null);
    visionApi
      .location(lat, lng, radiusM)
      .then((d) => {
        if (!stop) setData(d);
      })
      .catch((e: unknown) => {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [lat, lng, radiusM]);

  const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  // District, not `place_label`. The place label is the nearest *case's*
  // place_of_offence — values like "apartment complex" — so using it as the
  // title asserts this point IS that thing. District is an administrative fact
  // about the coordinate; the place stays a labelled field in the body.
  const title = data?.district || t("Selected location");
  const maxTypeCount = data?.crime_types[0]?.count ?? 1;

  return (
    <DraggableDossier
      title={title}
      subtitle={coords}
      accent={CRIME_BAR}
      badge={{
        text: `${t("CASES TABLE")} \u00b7 ${radiusM} m`,
        className: "border-[#38bdf8] text-[#38bdf8]",
      }}
      onClose={onClose}
      footer={
        onFocus ? (
          <button
            onClick={() => onFocus(lat, lng)}
            className="flex w-full items-center justify-center gap-1 text-[10px] font-extrabold uppercase tracking-wide hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> {t("CENTRE MAP HERE")}
          </button>
        ) : undefined
      }
    >
      <AerialThumb lat={lat} lng={lng} radiusM={radiusM} />

      {/* Radius is a control, not a fixed assumption: the right neighbourhood
          size differs between a city block and a rural highway. */}
      <div className="mb-2">
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground">
          {t("SEARCH RADIUS")}
        </div>
        <div className="flex gap-1">
          {LOCATION_RADIUS_CHOICES.map((r) => (
            <button
              key={r}
              onClick={() => setRadiusM(r)}
              className={`flex-1 rounded-[3px] border px-1 py-[2px] font-mono text-[9px] font-bold ${
                r === radiusM
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/30 hover:border-foreground"
              }`}
            >
              {r >= 1000 ? `${r / 1000}k` : r}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-[10px] text-muted-foreground">{t("Loading\u2026")}</p>}

      {error && (
        <p className="text-[10px] font-bold text-[#ef4444]">
          {t("Could not load location intelligence.")} {error}
        </p>
      )}

      {data && !loading && (
        <>
          <div className="mb-2 rounded-[4px] border border-foreground/20 bg-foreground/5 px-2 py-1.5">
            <div className="text-[18px] font-extrabold leading-none tabular-nums">
              {data.total_cases.toLocaleString()}
            </div>
            {/* The radius is in the label on purpose — this is not the hexagon's
                own count and must not be read as it. */}
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("recorded cases within")} {data.radius_m} m
            </div>
            {/* The bin's own total, stated separately. A hexagon at wide zoom can
                span kilometres, so these two figures legitimately differ and the
                panel must not let one be mistaken for the other. */}
            {bin?.cases != null && (
              <div className="mt-1 border-t border-foreground/15 pt-1 text-[9px] text-muted-foreground">
                {t("Clicked bin holds")}{" "}
                <span className="font-bold text-foreground">
                  {Math.round(bin.cases).toLocaleString()}
                </span>{" "}
                {t("cases")}
                {bin.cells != null && ` \u00b7 ${bin.cells} ${t("cells")}`}
              </div>
            )}
          </div>

          <Field label={t("Coordinates")} value={<span className="font-mono">{coords}</span>} />
          <Field label={t("District")} value={data.district ?? "\u2014"} />
          <Field label={t("Station")} value={data.station_name ?? "\u2014"} />
          {data.place_label && <Field label={t("Nearest place")} value={data.place_label} />}
          {data.peak_hours.length > 0 && (
            <Field
              label={t("Peak hours")}
              value={
                <span className="font-mono">
                  {data.peak_hours.map((h) => `${String(h).padStart(2, "0")}h`).join(" ")}
                </span>
              }
            />
          )}

          {data.crime_types.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground">
                {t("CRIME TYPES")}
              </div>
              {data.crime_types.map((c) => (
                <div key={c.crime_type} className="mb-[3px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] font-bold">{c.crime_type}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {c.count}
                    </span>
                  </div>
                  <div className="h-[3px] w-full rounded-full bg-foreground/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (c.count / maxTypeCount) * 100)}%`,
                        background: CRIME_BAR,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {Object.keys(data.status_breakdown).length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground">
                {t("CASE STATUS")}
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(data.status_breakdown).map(([s, n]) => (
                  <span
                    key={s}
                    className="rounded-full border border-foreground/25 px-1.5 py-[1px] text-[9px] font-bold"
                  >
                    {s} {n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.recent.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground">
                {t("MOST RECENT")}
              </div>
              {data.recent.map((c) => (
                <div key={c.case_id} className="border-b border-foreground/10 py-1 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] font-bold">{c.crime_type}</span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {c.distance_m} m
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[9px] text-muted-foreground">
                    <span className="truncate font-mono">
                      {t("FIR")} {c.fir_number}
                      {c.place_of_offence ? ` \u00b7 ${c.place_of_offence}` : ""}
                    </span>
                    <span className="shrink-0">{c.incident_date ?? "\u2014"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Person records are deliberately absent: no masked view exists for
              them, so this panel shows case-level facts only. */}
          <p className="mt-2 text-[9px] leading-snug text-muted-foreground">
            {t("Case-level facts only \u2014 no person records are shown here.")}
          </p>

          {data.note && (
            <p className="mt-1.5 rounded-[4px] border border-[#f97316]/50 bg-[#f97316]/10 px-1.5 py-1 text-[9px] leading-snug text-muted-foreground">
              {data.note}
            </p>
          )}

          {data.coords_coarsened && (
            <p className="mt-1 text-[9px] font-bold text-[#f97316]">
              {t("Coordinates coarsened for your clearance level.")}
            </p>
          )}
        </>
      )}
    </DraggableDossier>
  );
}
