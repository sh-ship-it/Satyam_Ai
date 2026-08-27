/**
 * Geometry, animation CSS and eye maths for the login page's ghost mascot.
 *
 * Kept out of the component so the parts that can be wrong in a way you would not
 * notice by looking — the path closing, and the eye clamp — are importable by
 * scripts/check-ghost-mascot.mjs without a DOM.
 *
 * WHY THIS IS NOT THE PASTED `MeshGradientSVG`
 * The reference imports `@/components/ui/shader-svg`, which does not exist here, and
 * its dependencies are `framer-motion` and `@paper-design/shaders-react` — neither
 * installed. The second is a WebGL shader runtime, which is a lot of machine for one
 * decorative gradient, and it would put a GL context on the page a user has to get
 * through before they can work.
 *
 * WHY RADIAL GRADIENTS AND NOT A BLUR
 * The first version soft-edged the colour blobs with a big feGaussianBlur. That is
 * fine for a 160px badge and wrong for a full-height background: an SVG filter is
 * recomputed whenever anything inside it changes, and everything inside it is moving,
 * so a ~60vh element would re-run a large convolution every frame. Blobs filled with
 * a radial gradient that fades to transparent have no hard edge to begin with, so the
 * softness costs nothing and only transforms animate.
 */

/** SVG user-unit canvas. */
export const VIEW_W = 300;
export const VIEW_H = 340;

/** How far the eyes may travel from centre. Beyond this they leave the sockets. */
export const EYE_TRAVEL = 11;
/** Pointer distance, in px, at which the eyes reach full deflection. */
export const EYE_FULL_AT_PX = 260;
/**
 * Vertical aim point as a fraction of the rendered height. The eyes sit above the
 * middle of the body, and aiming from the true centre makes the ghost look
 * permanently downcast.
 */
export const EYE_AIM_Y = 0.42;

/** Left and right edges of the body, and how many scallops span the skirt. */
export const BODY_LEFT = 24;
export const BODY_RIGHT = 276;
export const SCALLOPS = 3;
/** Width of one scallop. Must divide the skirt exactly or the shape does not close. */
export const SCALLOP_W = (BODY_RIGHT - BODY_LEFT) / SCALLOPS;

/**
 * Dome plus a scalloped skirt.
 *
 * The q runs travel right-to-left and must land back on BODY_LEFT. An unclosed
 * subpath still fills, but through the shortest straight line, which lops a corner
 * off the ghost — a failure that looks like a design choice rather than a bug, so the
 * arithmetic is asserted instead of trusted.
 */
export const GHOST_PATH =
  `M${BODY_LEFT} 292 V160 C${BODY_LEFT} 78 80 16 150 16 ` +
  `C220 16 ${BODY_RIGHT} 78 ${BODY_RIGHT} 160 V292 ` +
  `${`q-${SCALLOP_W / 2} 48 -${SCALLOP_W} 0 `.repeat(SCALLOPS)}Z`;

/**
 * Where the eyes should sit for a pointer offset from the face, in user units.
 *
 * The invariant that matters: the magnitude never exceeds EYE_TRAVEL, so the eyes
 * cannot slide out of the body however far away the pointer is.
 */
export function eyeOffset(dx: number, dy: number): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  // Under a pixel is a pointer sitting on the face; treat it as looking straight
  // ahead rather than dividing by something near zero.
  if (dist < 1) return { x: 0, y: 0 };
  // Direction times an eased magnitude, so a pointer close to the face does not slam
  // the eyes straight to their limit.
  const reach = Math.min(1, dist / EYE_FULL_AT_PX) * EYE_TRAVEL;
  return { x: (dx / dist) * reach, y: (dy / dist) * reach };
}

/**
 * THE LIQUID READ, AND WHY IT IS THREE ANIMATIONS RATHER THAN ONE
 *
 * A plain translateY bob looks like a lift, not a float. What makes motion read as
 * liquid is that the body's VOLUME lags its position: it stretches thin as it rises
 * and squashes wide as it settles. So the bob and the squash are separate keyframes
 * on separate elements with DIFFERENT periods (7s and 4.4s) — co-prime enough that
 * they drift in and out of phase and never settle into an obvious loop.
 *
 * The third is the colour: the blob group rotates a full turn while each blob also
 * drifts on its own cycle, so the colours sweep past one another and blend instead of
 * sliding as a rigid unit.
 *
 * Every one of these is a transform, which the compositor can handle without
 * repainting. That is the whole reason the blur had to go.
 */
export const GHOST_CSS = `
/* Position: the float. Rises and falls, eased so it lingers at the top. */
@keyframes ghost-float {
  0%,100% { transform: translateY(2.5%); }
  50%     { transform: translateY(-2.5%); }
}
/* Volume: the squash. Deliberately NOT the same period as the float, so the shape is
   not always thinnest at exactly the top of its rise. */
@keyframes ghost-squash {
  0%,100% { transform: scale(1.022, 0.978); }
  50%     { transform: scale(0.978, 1.022); }
}
/* Colour: a full rotation, so the blobs sweep across one another. */
@keyframes ghost-swirl {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes ghost-drift-a {
  0%,100% { transform: translate(0,0) scale(1); }
  50%     { transform: translate(26px,-18px) scale(1.14); }
}
@keyframes ghost-drift-b {
  0%,100% { transform: translate(0,0) scale(1); }
  50%     { transform: translate(-30px,22px) scale(1.1); }
}
@keyframes ghost-drift-c {
  0%,100% { transform: translate(0,0) scale(1); }
  50%     { transform: translate(18px,26px) scale(1.08); }
}

.ghost-float  { animation: ghost-float 7s ease-in-out infinite; will-change: transform; }
.ghost-squash { animation: ghost-squash 4.4s ease-in-out infinite; }
/* fill-box, or the origin is the whole SVG viewport and the group orbits instead of
   spinning in place. */
.ghost-squash, .ghost-swirl, .ghost-blob-a, .ghost-blob-b, .ghost-blob-c {
  transform-box: fill-box;
  transform-origin: center;
}
.ghost-swirl  { animation: ghost-swirl 26s linear infinite; }
.ghost-blob-a { animation: ghost-drift-a 14s ease-in-out infinite; }
.ghost-blob-b { animation: ghost-drift-b 18s ease-in-out infinite; }
.ghost-blob-c { animation: ghost-drift-c 11s ease-in-out infinite; }
.ghost-eyes   { transition: transform .12s linear; }

@media (prefers-reduced-motion: reduce) {
  /* All of the above is autonomous motion, so all of it stops. The eyes are NOT
     stopped: they move only while the pointer does, which is direct feedback to the
     user's own input rather than something animating at them. */
  .ghost-float, .ghost-squash, .ghost-swirl,
  .ghost-blob-a, .ghost-blob-b, .ghost-blob-c { animation: none; }
}
`;
