/**
 * The Shell sidebar rail: width morph, label reveal, and dock magnification.
 *
 * WHY THIS IS NOT THE PASTED `motion/react` SIDEBAR
 * The reference component (beui.dev animated-sidebar) needs three things this repo
 * does not have: the `motion` package, `@/components/motion/shared-layout-bg`, and
 * `@/lib/ease`. What it actually does — morph the width between a rail and a panel,
 * fade labels in behind that, magnify the hovered icon, and toggle on Cmd/Ctrl+B —
 * is CSS transitions plus one piece of state, so it is implemented directly rather
 * than pulling in a 100kb animation runtime and two missing modules for it.
 *
 * The pieces it drops, deliberately, because nothing here uses them: the mobile
 * off-canvas sheet with its focus trap and scroll lock, nested submenus, and the
 * shared-layout active pill. The rail is flat, always visible, and 17 items deep.
 *
 * NO OUTWARD TRANSLATE ON HOVER, DELIBERATELY
 * A real dock pops the icon out past the bar's edge. This rail cannot: it is a
 * scroll container (`overflow-y-auto`, needed so 17 items cannot force page
 * height), so anything crossing its edge is clipped. The growth is therefore
 * centre-origin and stays inside the rail; the shadow and brightness lift carry the
 * "coming forward" read instead.
 *
 * WHY THE NUMBERS LIVE HERE
 * `TILE_PX * HOVER_SCALE` must not exceed `RAIL_WIDTH_PX`, or the swell is clipped
 * mid-hover. That is a real constraint rather than a taste decision, so it is
 * arithmetic a check enforces (scripts/check-rail-dock.mjs) instead of a comment
 * someone can invalidate by nudging a number.
 *
 * Sibling selectors, not JS, for the falloff: `+` reaches the next item and
 * `:has(+ ...:hover)` the previous one — no pointer tracking, no rAF loop.
 */

/** Collapsed rail width. Matches the tile plus its breathing room. */
export const RAIL_WIDTH_PX = 64;
/** Expanded rail width — enough for the longest label ("Access Control"). */
export const RAIL_WIDTH_OPEN_PX = 208;
/** Tailwind `h-11 w-11` on each item. */
export const RAIL_TILE_PX = 44;
export const RAIL_HOVER_SCALE = 1.42;
export const RAIL_NEIGHBOUR_SCALE = 1.16;
export const RAIL_ACTIVE_SCALE = 1.3;
/** The glyph shrinks against the tile's growth so it gains padding as it enlarges. */
export const RAIL_ICON_COUNTER_SCALE = 0.88;

export const RAIL_OPEN_KEY = "satyam.rail.open";

const EASE = "cubic-bezier(.2,.8,.25,1)";
/** Width morph. Long enough to read as a slide, short enough not to feel slow. */
const MORPH = `.30s ${EASE}`;

export function railDockCss(): string {
  return `
.rail { transition: width ${MORPH}; }

/* ── labels ──────────────────────────────────────────────────────────────────
   Always in the DOM so the width morph has something to reveal, and clipped by
   the rail's overflow-x rather than unmounted. Unmounting them would make the
   panel appear empty for a frame and would drop the accessible name mid-toggle. */
.rail-label {
  opacity: 0;
  transform: translateX(-4px);
  /* Width is deliberately NOT transitioned: 0 → auto does not animate, and the
     rail's own width morph already provides the movement. Only the fade is timed. */
  transition: opacity .16s ${EASE}, transform .22s ${EASE};
  pointer-events: none;
}
.rail[data-rail="expanded"] .rail-label {
  opacity: 1;
  transform: none;
  /* Behind the width, not with it: at 0.10s the panel has already opened enough
     that the text is not seen sliding out from under its own clip edge. */
  transition-delay: .10s;
}
/* Collapsed, the tile is square and centred; expanded, it is a full-width row.

   The label MUST collapse to zero width here, and opacity 0 alone is not enough —
   that was the bug this fixes. An invisible label still occupies its inline size,
   so a 44px tile held ~114px of content (the longest label plus icon and gap), and
   justify-content center then distributes the overflow to BOTH sides. That put each
   icon at a negative x, where the rail's hidden horizontal overflow sliced it
   against the left edge and left the collapse toggle unreachable.

   Zero gap matters for the same reason: a 12px gap next to a zero-width label is
   still 12px of content, which shifts the icon 6px off centre. */
.rail[data-rail="collapsed"] .rail-item,
.rail[data-rail="collapsed"] .rail-toggle {
  width: ${RAIL_TILE_PX}px;
  align-self: center;
  gap: 0;
  padding-left: 0;
  padding-right: 0;
  justify-content: center;
  /* Belt to the braces above: even if some future label refuses to shrink, it is
     clipped inside its own tile instead of escaping the rail. */
  overflow: hidden;
}
.rail[data-rail="collapsed"] .rail-label {
  width: 0;
  overflow: hidden;
}
.rail[data-rail="expanded"] .rail-item,
.rail[data-rail="expanded"] .rail-toggle {
  align-self: stretch;
  width: auto;
}
.rail[data-rail="expanded"] .rail-label { width: auto; }
.rail-chevron { transition: transform .30s ${EASE}; }
.rail[data-rail="expanded"] .rail-chevron { transform: rotate(180deg); }

/* ── dock magnification, COLLAPSED VIEW ONLY ─────────────────────────────────
   Scoped by the data attribute so expanding the rail turns the swell off with no
   second class list to keep in sync. A full-width row growing 1.42x would burst
   the panel; a 44px tile does not. */
.rail[data-rail="collapsed"] .rail-item {
  transition: transform .26s ${EASE},
              box-shadow .26s ${EASE},
              background-color .18s ease, border-color .18s ease;
  transform-origin: center center;
}
.rail[data-rail="collapsed"] .rail-item .rail-icon { transition: transform .26s ${EASE}; }
.rail[data-rail="collapsed"] .rail-item:hover {
  transform: scale(${RAIL_HOVER_SCALE});
  /* Raised above its neighbours so the swell overlaps them rather than being
     overlapped — without this the next item's background clips the shadow. */
  z-index: 20;
  box-shadow: 0 6px 16px -4px rgb(0 0 0 / .45);
}
.rail[data-rail="collapsed"] .rail-item:hover .rail-icon {
  transform: scale(${RAIL_ICON_COUNTER_SCALE});
}
.rail[data-rail="collapsed"] .rail-item:hover + .rail-item,
.rail[data-rail="collapsed"] .rail-item:has(+ .rail-item:hover) {
  transform: scale(${RAIL_NEIGHBOUR_SCALE});
  z-index: 10;
}
.rail[data-rail="collapsed"] .rail-item:active {
  transform: scale(${RAIL_ACTIVE_SCALE});
  transition-duration: .08s;
}

@media (prefers-reduced-motion: reduce) {
  /* Size change IS the dock effect, so it goes entirely; the colour change already
     on .rail-item keeps hover legible. The width morph becomes an instant snap
     rather than a slide, and labels appear without sliding. */
  .rail, .rail-chevron, .rail-label { transition: none; }
  .rail[data-rail="expanded"] .rail-label { transition-delay: 0s; }
  .rail[data-rail="collapsed"] .rail-item,
  .rail[data-rail="collapsed"] .rail-item .rail-icon { transition: none; }
  .rail[data-rail="collapsed"] .rail-item:hover,
  .rail[data-rail="collapsed"] .rail-item:active,
  .rail[data-rail="collapsed"] .rail-item:hover + .rail-item,
  .rail[data-rail="collapsed"] .rail-item:has(+ .rail-item:hover) { transform: none; }
  .rail[data-rail="collapsed"] .rail-item:hover .rail-icon { transform: none; }
}
`;
}
