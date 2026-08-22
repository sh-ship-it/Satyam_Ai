/** Floating, draggable entity dossier.
 *
 *  Draggable rather than a modal on purpose: the whole point is to inspect an
 *  entity without losing the spatial context that made you click it. Several can
 *  be open at once and each can be minimised to its title bar.
 *
 *  Uses react-draggable (MIT, ~4 kB) rather than a large animation library, and
 *  rather than hand-rolled pointer maths that would need its own touch handling.
 */
import { useRef, useState, type ReactNode } from "react";
import Draggable from "react-draggable";
import { Minus, Square, X } from "lucide-react";

let stackOffset = 0;

export function DraggableDossier({
  title,
  subtitle,
  accent = "#00E6A8",
  badge,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  accent?: string;
  /** Small uppercase tag, e.g. a provenance label. */
  badge?: { text: string; className?: string };
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [minimised, setMinimised] = useState(false);

  // Cascade successive dossiers so a second one does not land exactly on the first.
  const [start] = useState(() => {
    const n = stackOffset % 5;
    stackOffset += 1;
    return { x: -24 - n * 26, y: n * 30 };
  });

  return (
    <Draggable
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      handle=".vx-dossier-handle"
      defaultPosition={start}
      bounds="parent"
    >
      <div
        ref={nodeRef}
        className="pointer-events-auto absolute right-4 top-28 z-[1200] w-[19rem] overflow-hidden rounded-[8px] border-2 border-foreground bg-background/95 backdrop-blur"
        style={{ borderLeftColor: accent, borderLeftWidth: 5 }}
      >
        <div className="vx-dossier-handle flex cursor-grab items-center gap-1.5 border-b-2 border-foreground bg-header px-2.5 py-1.5 text-header-foreground active:cursor-grabbing">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-extrabold leading-tight">{title}</div>
            {subtitle && !minimised && (
              <div className="truncate text-[10px] text-header-foreground/70">{subtitle}</div>
            )}
          </div>
          <button
            onClick={() => setMinimised((v) => !v)}
            aria-label={minimised ? "Restore" : "Minimise"}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            {minimised ? <Square className="h-3 w-3" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {!minimised && (
          <>
            {badge && (
              <div className="border-b border-foreground/15 px-2.5 py-1">
                <span
                  className={`rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide ${
                    badge.className ?? "border-muted-foreground text-muted-foreground"
                  }`}
                >
                  {badge.text}
                </span>
              </div>
            )}
            <div className="max-h-[46vh] overflow-y-auto px-2.5 py-2 text-[11px]">{children}</div>
            {footer && (
              <div className="border-t-2 border-foreground px-2.5 py-1.5">{footer}</div>
            )}
          </>
        )}
      </div>
    </Draggable>
  );
}

/** Label/value row used by every dossier body. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-foreground/10 py-1 last:border-b-0">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right font-bold">{value ?? "\u2014"}</span>
    </div>
  );
}
