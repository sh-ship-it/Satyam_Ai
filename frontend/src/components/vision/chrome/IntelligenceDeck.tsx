/** Bottom intelligence deck — live events and context, tabbed, collapsible.
 *
 *  Sits above the coordinate readout. Collapsed by default on short viewports so
 *  the map keeps the screen; an ops-room wall has room, a field tablet does not.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, LayoutGrid, Radio, Rows3 } from "lucide-react";
import { useT } from "@/lib/i18n";

export type DeckTabId = "dispatches" | "review" | "risk" | "alerts";

/** A panel in the expanded deck. Content is composed by the caller so this
 *  component stays presentational and has no idea what a risk zone is. */
export type DeckPanel = {
  id: string;
  title: string;
  /** Small right-aligned count or status word in the panel header. */
  badge?: string;
  /** Renders when `body` is absent — the honest reason, not a blank box. */
  emptyNote?: string;
  body?: ReactNode;
  /** Panels that benefit from width (tables) can span two grid columns. */
  wide?: boolean;
};

/** Shared shell so every panel gets the same header, border and scroll
 *  behaviour, and no panel can quietly grow past the deck. */
export function DeckPanelShell({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    // h-full so the panel fills the fixed-height grid cell exactly; the body
    // below scrolls instead of overflowing into the next grid row.
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] border-2 border-foreground/25 bg-background/60">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-foreground/20 px-2 py-1">
        <h3 className="truncate text-[10px] font-extrabold tracking-wide text-muted-foreground">
          {title}
        </h3>
        {badge && (
          <span className="shrink-0 rounded-full bg-foreground/15 px-1.5 text-[9px] font-bold">
            {badge}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">{children}</div>
    </section>
  );
}

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
  panels = [],
}: {
  rows: Partial<Record<DeckTabId, DeckRow[]>>;
  /** Per-tab explanation shown when a tab has no rows. */
  emptyNote: Partial<Record<DeckTabId, string>>;
  footer?: ReactNode;
  /** Expanded view. Empty means the grid toggle is not offered at all, so the
   *  deck degrades to exactly its previous behaviour. */
  panels?: DeckPanel[];
}) {
  const t = useT();
  const [tab, setTab] = useState<DeckTabId>("dispatches");
  const [open, setOpen] = useState(false);
  /** Grid vs single list. Off by default: the deck must not eat the map on a
   *  field tablet the first time an officer opens the screen. */
  const [grid, setGrid] = useState(false);

  const current = rows[tab] ?? [];
  const canGrid = panels.length > 0;
  const showGrid = open && grid && canGrid;

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
        <div className="flex shrink-0 items-stretch">
          {canGrid && (
            <button
              onClick={() => {
                setGrid((v) => !v);
                setOpen(true);
              }}
              aria-pressed={showGrid}
              title={showGrid ? t("Single list") : t("Expand into the full intelligence workspace")}
              className={`flex items-center gap-1 border-l-2 border-foreground/20 px-2.5 text-[10px] font-extrabold transition ${
                showGrid
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {showGrid ? (
                <Rows3 className="h-3.5 w-3.5" />
              ) : (
                <LayoutGrid className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{showGrid ? t("LIST") : t("EXPAND")}</span>
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 border-l-2 border-foreground/20 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {showGrid ? (
        // Capped at 52vh so the deck can never take the map, and the grid itself
        // scrolls rather than pushing the coordinate readout off-screen.
        <div className="max-h-[52vh] overflow-y-auto p-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {panels.map((p) => (
              // Fixed height + overflow-hidden, not max-height: a tall panel
              // must scroll inside its own cell. With max-height and no clip the
              // district table overflowed and the next row painted over it.
              <div
                key={p.id}
                className={`min-h-0 overflow-hidden ${p.wide ? "md:col-span-2" : ""}`}
                style={{ height: "23vh" }}
              >
                <DeckPanelShell title={t(p.title)} badge={p.badge}>
                  {p.body ?? (
                    <p className="text-[11px] text-muted-foreground">
                      {p.emptyNote ?? t("Nothing to show.")}
                    </p>
                  )}
                </DeckPanelShell>
              </div>
            ))}
          </div>
          {footer && <div className="mt-2 border-t border-foreground/15 px-1 pt-1.5">{footer}</div>}
        </div>
      ) : open ? (
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
