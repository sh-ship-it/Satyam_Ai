/**
 * Self-check for the collapsed rail's dock magnification.
 *
 *   node --experimental-strip-types scripts/check-rail-dock.mjs
 *
 * The constraint worth enforcing is geometric, not cosmetic. The rail is a scroll
 * container, so `overflow-x` computes to `auto`: any tile that grows wider than the
 * rail is clipped mid-hover AND raises a horizontal scrollbar. Nudging the scale up
 * for a punchier effect is exactly how that regresses, so the arithmetic is checked
 * rather than left in a comment.
 */
import assert from "node:assert/strict";

const m = await import("../src/lib/railDock.ts");
const {
  RAIL_WIDTH_PX,
  RAIL_WIDTH_OPEN_PX,
  RAIL_TILE_PX,
  RAIL_HOVER_SCALE,
  RAIL_NEIGHBOUR_SCALE,
  RAIL_ACTIVE_SCALE,
  RAIL_ICON_COUNTER_SCALE,
  railDockCss,
} = m;

// ── the geometry that keeps the swell inside the rail ────────────────────────
const grown = RAIL_TILE_PX * RAIL_HOVER_SCALE;
assert.ok(
  grown <= RAIL_WIDTH_PX,
  `hovered tile is ${grown.toFixed(1)}px in a ${RAIL_WIDTH_PX}px rail — it will be clipped`,
);
assert.ok(
  RAIL_TILE_PX * RAIL_NEIGHBOUR_SCALE <= RAIL_WIDTH_PX,
  "a neighbour tile must fit the rail too",
);

// ── the falloff IS the dock; without it this is a plain hover ────────────────
assert.ok(RAIL_HOVER_SCALE > RAIL_NEIGHBOUR_SCALE, "hovered item must outgrow its neighbours");
assert.ok(RAIL_NEIGHBOUR_SCALE > 1, "neighbours must grow, or there is no falloff");
assert.ok(RAIL_ACTIVE_SCALE < RAIL_HOVER_SCALE, "press should settle back, not grow further");
assert.ok(
  RAIL_ICON_COUNTER_SCALE < 1 && RAIL_ICON_COUNTER_SCALE * RAIL_HOVER_SCALE > 1,
  "the glyph should gain padding but still end up larger than at rest",
);

// The expanded panel must be genuinely wider, or the toggle does nothing visible
// and the labels stay clipped.
assert.ok(
  RAIL_WIDTH_OPEN_PX > RAIL_WIDTH_PX + 80,
  "expanded rail needs real room for labels, not a few extra pixels",
);

// ── the CSS actually carries the pieces the effect needs ─────────────────────
const css = railDockCss();
assert.ok(css.includes(`scale(${RAIL_HOVER_SCALE})`), "hover scale must reach the stylesheet");
assert.ok(
  /transform-origin:\s*center/.test(css),
  "off-centre origin pushes the tile out of the rail",
);
assert.ok(
  !/translateX\(\s*\d/.test(css),
  "an outward translate is clipped by the scroll container",
);
assert.ok(css.includes("z-index"), "the swell must sit above its neighbours or the shadow clips");
assert.ok(css.includes("transition: width"), "the width morph is the sidebar animation itself");

// ── the bug that broke the rail ──────────────────────────────────────────────
// A collapsed label must take ZERO width, not merely be transparent. An invisible
// label still occupies its inline size, and `justify-content: center` spreads the
// resulting overflow to BOTH sides — which pushed each icon to a negative x, where
// the rail's `overflow-x: hidden` sliced it against the left edge and left the
// collapse toggle unreachable.
const collapsedLabel = css.slice(
  css.indexOf('.rail[data-rail="collapsed"] .rail-label'),
  css.indexOf('.rail[data-rail="expanded"] .rail-item'),
);
assert.ok(collapsedLabel.includes("width: 0"), "collapsed label must collapse to zero width");
const collapsedTile = css.slice(
  css.indexOf('.rail[data-rail="collapsed"] .rail-item,'),
  css.indexOf('.rail[data-rail="collapsed"] .rail-label'),
);
assert.ok(
  /gap:\s*0/.test(collapsedTile),
  "a gap beside a zero-width label still shifts the icon off centre",
);
assert.ok(
  /overflow:\s*hidden/.test(collapsedTile),
  "the tile must clip its own contents so nothing can escape the rail",
);

// ── the dock is scoped to the COLLAPSED rail, which is what was asked ────────
// Every magnification rule must sit behind [data-rail="collapsed"]. A bare
// `.rail-item:hover` would swell the full-width rows too and burst the open panel.
for (const rule of [
  ".rail-item:hover",
  ".rail-item:active",
  ".rail-item:hover + .rail-item",
  ":has(+ .rail-item:hover)",
]) {
  let from = 0;
  let seen = 0;
  for (;;) {
    const at = css.indexOf(rule, from);
    if (at === -1) break;
    seen += 1;
    const lineStart = css.lastIndexOf("\n", at) + 1;
    assert.ok(
      css.slice(lineStart, at + rule.length).includes('[data-rail="collapsed"]'),
      `"${rule}" is not scoped to the collapsed rail`,
    );
    from = at + rule.length;
  }
  assert.ok(seen > 0, `"${rule}" missing — the falloff is the dock effect`);
}

// Reduced motion must cancel the size change, not merely shorten it.
const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
assert.ok(reduced.includes("transform: none"), "reduced motion must cancel the scaling");
assert.ok(reduced.includes("transition: none"), "reduced motion must cancel the transition");

console.log(
  `check-rail-dock: PASS (tile ${RAIL_TILE_PX}px → ${grown.toFixed(1)}px inside ${RAIL_WIDTH_PX}px; ` +
    `rail ${RAIL_WIDTH_PX}→${RAIL_WIDTH_OPEN_PX}px)`,
);
