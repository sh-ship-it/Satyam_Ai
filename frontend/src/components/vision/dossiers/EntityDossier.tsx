/** Renders whichever dossier body matches the entity kind.
 *
 *  One component with four branches rather than four files: they share the same
 *  fetch, loading and error handling, and the bodies are a dozen lines each.
 */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { visionApi, type VisionEntity, type VisionEntityKind } from "@/lib/api/vision";
import { DraggableDossier, Field } from "./DraggableDossier";

export type OpenEntity = { kind: VisionEntityKind; id: string | number };

const ACCENT: Record<VisionEntityKind, string> = {
  patrol: "#a855f7",
  camera: "#e879f9",
  risk_zone: "#fbbf24",
  dispatch: "#00E6A8",
};

function fmtEta(sec: unknown): string {
  const n = typeof sec === "number" ? sec : NaN;
  if (!Number.isFinite(n)) return "\u2014";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function EntityDossier({
  entity,
  onClose,
  onFocus,
}: {
  entity: OpenEntity;
  onClose: () => void;
  onFocus?: (lat: number, lng: number) => void;
}) {
  const t = useT();
  const [data, setData] = useState<VisionEntity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    visionApi.entity(entity.kind, entity.id).then(
      (d) => !cancelled && setData(d),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [entity.kind, entity.id]);

  const title = data?.title ?? `${entity.kind} ${entity.id}`;
  const lat = typeof data?.lat === "number" ? (data.lat as number) : null;
  const lng = typeof data?.lng === "number" ? (data.lng as number) : null;

  const simulated = entity.kind === "camera" && data?.optics_fabricated === true;

  return (
    <DraggableDossier
      title={title}
      subtitle={entity.kind.replace("_", " ").toUpperCase()}
      accent={ACCENT[entity.kind]}
      badge={
        simulated
          ? { text: "optics simulated", className: "border-[#f97316] text-[#f97316]" }
          : undefined
      }
      onClose={onClose}
      footer={
        lat != null && lng != null && onFocus ? (
          <button
            onClick={() => onFocus(lat, lng)}
            className="w-full rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1 text-[10px] font-extrabold hover:translate-x-[1px] hover:translate-y-[1px] transition"
          >
            {t("CENTRE MAP HERE")}
          </button>
        ) : undefined
      }
    >
      {error && <p className="py-2 text-[#ef4444]">{t("Could not load this record.")}</p>}
      {!data && !error && <p className="py-2 text-muted-foreground">{t("Loading\u2026")}</p>}

      {data && entity.kind === "patrol" && (
        <>
          <Field label={t("Callsign")} value={String(data.title ?? "")} />
          <Field label={t("Status")} value={String(data.status ?? "")} />
          <Field label={t("District")} value={(data.district as string) || "\u2014"} />
          <Field
            label={t("Position")}
            value={lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "\u2014"}
          />
          {Array.isArray(data.nearest_cameras) && data.nearest_cameras.length > 0 && (
            <div className="pt-1.5">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("Nearest cameras")}
              </div>
              {(data.nearest_cameras as { camera_id: string; name: string; km: number }[]).map(
                (c) => (
                  <div key={c.camera_id} className="flex justify-between py-0.5">
                    <span className="truncate">{c.name}</span>
                    <span className="font-mono text-muted-foreground">{c.km} km</span>
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}

      {data && entity.kind === "camera" && (
        <>
          <Field label={t("Camera")} value={String(data.camera_id ?? "")} />
          <Field label={t("Location")} value={(data.location as string) || "\u2014"} />
          <Field label={t("Active")} value={data.is_active ? t("Yes") : t("No")} />
          <Field label={t("Bearing")} value={`${data.bearing_deg}\u00b0`} />
          <Field label={t("Field of view")} value={`${data.fov_deg}\u00b0`} />
          <Field label={t("Range")} value={`${data.range_m} m`} />
          <p className="py-1 text-[10px] leading-snug text-[#f97316]">
            {t(
              "Bearing, field of view and range are fabricated for the demo. No optics are stored for this camera.",
            )}
          </p>
          {Array.isArray(data.recent_detections) && data.recent_detections.length > 0 && (
            <div className="pt-1">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("Recent detections")}
              </div>
              {(
                data.recent_detections as {
                  id: number;
                  type: string;
                  confidence: number;
                  status: string;
                }[]
              ).map((d) => (
                <div key={d.id} className="flex justify-between py-0.5">
                  <span className="truncate">{d.type}</span>
                  <span className="font-mono text-muted-foreground">
                    {(d.confidence * 100).toFixed(0)}% {d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {data && entity.kind === "risk_zone" && (
        <>
          <Field label={t("Risk score")} value={Number(data.score ?? 0).toFixed(1)} />
          <Field label={t("Incidents")} value={String(data.incidents ?? 0)} />
          <Field
            label={t("Peak hour")}
            value={data.peak_hour == null ? "\u2014" : `${data.peak_hour}:00`}
          />
          {Array.isArray(data.reasons) && data.reasons.length > 0 && (
            <ul className="list-disc pl-4 pt-1 text-[10px] text-muted-foreground">
              {(data.reasons as string[]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {Array.isArray(data.nearest_patrols) && data.nearest_patrols.length > 0 && (
            <div className="pt-1.5">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("Nearest patrols")}
              </div>
              {(
                data.nearest_patrols as {
                  id: number;
                  callsign: string;
                  status: string;
                  km: number;
                }[]
              ).map((p) => (
                <div key={p.id} className="flex justify-between py-0.5">
                  <span className="truncate">
                    {p.callsign} <span className="text-muted-foreground">{p.status}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{p.km} km</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {data && entity.kind === "dispatch" && (
        <>
          <Field label={t("Status")} value={String(data.status ?? "")} />
          <Field
            label={t("Patrol")}
            value={
              data.patrol
                ? String((data.patrol as { callsign?: string }).callsign ?? "\u2014")
                : "\u2014"
            }
          />
          <Field label={t("ETA")} value={fmtEta(data.eta_sec)} />
          <Field
            label={t("Distance")}
            value={
              typeof data.distance_km === "number"
                ? `${(data.distance_km as number).toFixed(2)} km`
                : "\u2014"
            }
          />
          <Field label={t("Case")} value={data.case_id ? `#${data.case_id}` : "\u2014"} />
        </>
      )}
    </DraggableDossier>
  );
}
