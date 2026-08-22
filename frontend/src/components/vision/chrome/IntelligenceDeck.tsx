/** Bottom intelligence deck — live events and context, tabbed, collapsible.
 *
 *  Sits above the coordinate readout. Collapsed by default on short viewports so
 *  the map keeps the screen; an ops-room wall has room, a field tablet does not.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Radio } from "lucide-react";
import { useT } from "@/lib/i18n";

export type DeckTabId = "dispatches" | "review" | "risk" | "alerts";

export type DeckRow = {
  id: string;
  time?: string;
  title: string;
  detail?: string;
  accent?: string;
  onFocus?: () => void;
};

const TABS: { id: DeckTabId; label: string }[] = [
  { id: "dispatches", label: "DISPATCHES" },
  { id: "review", label: "REVIEW QUEUE" },
  { id: "risk", label: "RISK" },
  { id: "alerts", label: "ALERTS" },
];

export function IntelligenceDeck({
  rows,
  emptyNote,
  footer,
}: {
  rows: Partial<Record<DeckTabId, DeckRow[]>>;
  /** Per-tab explanation shown when a tab has no rows. */
  emptyNote: Partial<Record<DeckTabId, string>>;
  footer?: ReactNode;
}) {
  const t = useT();
  const [tab, setTab] = useState<DeckTabId>("dispatches");
  const [open, setOpen] = useState(false);

  const current = rows[tab] ?? [];

  return (
    // A real row in the workspace column, not an overlay. Anchoring this to the
    // window while it grows upward is what made it collide with the layer matrix
    // and the treatment bar.
    <div className="shrink-0 overflow-hidden border-t-2 border-foreground bg-background/95 backdrop-blur">
      <div className="flex items-stretch justify-between border-b-2 border-foreground/30">
        <div className="flex items-stretch overflow-x-auto">
          {TABS.map((tb) => {
            const n = (rows[tb.id] ?? []).length;
            return (
              <button
                key={tb.id}
                onClick={() => {
                  setTab(tb.id);
                  setOpen(true);
                }}
                aria-pressed={tab === tb.id}
                className={`flex shrink-0 items-center gap-1.5 border-r-2 border-foreground/20 px-3 py-1.5 text-[10px] font-extrabold tracking-wide transition ${
                  tab === tb.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(tb.label)}
                {n > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[9px] ${
                      tab === tb.id ? "bg-background/25" : "bg-foreground/15"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="max-h-40 overflow-y-auto">
          {current.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">
              {emptyNote[tab] ?? t("Nothing to show.")}
            </p>
          ) : (
            current.map((r) => (
              <button
                key={r.id}
                onClick={r.onFocus}
                disabled={!r.onFocus}
                className="flex w-full items-center gap-2 border-b border-foreground/10 px-3 py-1.5 text-left last:border-b-0 hover:bg-foreground/5 disabled:hover:bg-transparent"
              >
                {r.accent && (
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: r.accent }}
                  />
                )}
                {r.time && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {r.time}
                  </span>
                )}
                <span className="truncate text-[11px] font-bold">{r.title}</span>
                {r.detail && (
                  <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">
                    {r.detail}
                  </span>
                )}
              </button>
            ))
          )}
          {footer && <div className="border-t border-foreground/15 px-3 py-1.5">{footer}</div>}
        </div>
      ) : (
        // Collapsed: a one-line ticker so the deck still carries information.
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 px-3 py-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
        >
          <Radio className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {current.length > 0
              ? `${current[0].time ? current[0].time + " \u00b7 " : ""}${current[0].title}`
              : (emptyNote[tab] ?? t("Nothing to show."))}
          </span>
        </button>
      )}
    </div>
  );
}
