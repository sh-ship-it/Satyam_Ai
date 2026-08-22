/** Layer matrix — independent switches with live counts and source state.
 *
 *  Two rules this panel enforces:
 *   1. Every layer shows a provenance badge. See layerRegistry.ts for why.
 *   2. An empty or unavailable layer always explains itself. A silently empty
 *      layer on a police map reads as "no crime here", which is a dangerous
 *      thing to imply by accident.
 */
import { ChevronLeft, ChevronRight, Layers, Building2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  LAYERS,
  PROVENANCE_STYLE,
  type LayerId,
  type Provenance,
} from "../layerRegistry";

export function LayerMatrixSidebar({
  visible,
  counts,
  degraded,
  collapsed,
  buildings3d,
  onToggleLayer,
  onToggleCollapsed,
  onToggleBuildings,
}: {
  visible: Record<LayerId, boolean>;
  counts: Partial<Record<LayerId, number>>;
  /** layerId -> human-readable reason it is unavailable or empty. */
  degraded: Partial<Record<LayerId, string>>;
  collapsed: boolean;
  buildings3d: boolean;
  onToggleLayer: (id: LayerId) => void;
  onToggleCollapsed: () => void;
  onToggleBuildings: () => void;
}) {
  const t = useT();

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        title={t("Show layers")}
        className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-[8px] border-2 border-foreground bg-background/90 text-foreground backdrop-blur transition hover:translate-x-[1px]"
      >
        <Layers className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto w-64 overflow-hidden rounded-[8px] border-2 border-foreground bg-background/92 backdrop-blur">
      <div className="flex items-center justify-between border-b-2 border-foreground px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wide">
          <Layers className="h-3.5 w-3.5" />
          {t("INTELLIGENCE LAYERS")}
        </div>
        <button onClick={onToggleCollapsed} title={t("Hide layers")} className="opacity-60 hover:opacity-100">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[46vh] overflow-y-auto">
        {LAYERS.map((l) => {
          const on = visible[l.id];
          const reason = degraded[l.id];
          const count = counts[l.id];
          const prov: Provenance = reason ? "cached" : l.provenance;
          const badge = PROVENANCE_STYLE[reason ? prov : l.provenance];
          return (
            <div key={l.id} className="border-b border-foreground/15 px-3 py-2 last:border-b-0">
              <button
                onClick={() => onToggleLayer(l.id)}
                disabled={!!reason}
                title={l.hint}
                className={`flex w-full items-center gap-2 text-left ${
                  reason ? "cursor-not-allowed opacity-50" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-2 ${
                    on && !reason ? "border-foreground" : "border-foreground/40"
                  }`}
                  style={{ background: on && !reason ? l.swatch : "transparent" }}
                />
                <span className="flex-1 truncate text-[12px] font-bold">{t(l.label)}</span>
                {typeof count === "number" && !reason && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {count.toLocaleString()}
                  </span>
                )}
              </button>

              <div className="mt-1 flex items-center gap-1.5 pl-[22px]">
                <span
                  className={`rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide ${badge.className}`}
                >
                  {badge.label}
                </span>
                {l.provenance === "simulated" && !reason && (
                  <span className="text-[9px] font-bold text-[#f97316]">FABRICATED GEOMETRY</span>
                )}
              </div>

              {reason && (
                <p className="mt-1 pl-[22px] text-[10px] leading-snug text-muted-foreground">
                  {reason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Display options. 3D buildings ships OFF: enabling it swaps to a vector
          basemap style, so a default session makes zero vector-tile requests. */}
      <div className="border-t-2 border-foreground px-3 py-2">
        <div className="mb-1.5 text-[10px] font-extrabold tracking-wide text-muted-foreground">
          {t("DISPLAY")}
        </div>
        <button
          onClick={onToggleBuildings}
          title={t("Loads a vector basemap. Off by default to save bandwidth.")}
          className="flex w-full items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-2 ${
              buildings3d ? "border-foreground bg-[#94a3b8]" : "border-foreground/40"
            }`}
          />
          <Building2 className="h-3 w-3 opacity-70" />
          <span className="flex-1 text-[12px] font-bold">{t("3D buildings")}</span>
        </button>
        {buildings3d && (
          <p className="mt-1 pl-[22px] text-[10px] leading-snug text-muted-foreground">
            {t("Vector basemap active \u2014 higher bandwidth.")}
          </p>
        )}
      </div>
    </div>
  );
}

export function LayerMatrixExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex h-9 items-center gap-1 rounded-[8px] border-2 border-foreground bg-background/90 px-2 text-[11px] font-bold backdrop-blur"
    >
      <ChevronRight className="h-3.5 w-3.5" /> Layers
    </button>
  );
}
