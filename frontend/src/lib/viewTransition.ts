/**
 * Circular-reveal transition for theme switches.
 *
 * Written against the native View Transitions API rather than installing a
 * component. The referenced `AnimatedThemeToggler` is a self-contained button,
 * and dropping it in would have meant a *second* dark-mode control alongside the
 * two this app already has (`DarkModeToggle` in the header and the switch inside
 * `ThemePicker`), with its own storage key and its own idea of the current mode.
 * Three sources of truth for one boolean is how themes end up disagreeing with
 * each other. This is the animation on its own, so both existing toggles can
 * call it and `fq-dark` stays the only record of the setting.
 *
 * The paint order is set up in `styles.css`: the browser's default cross-fade on
 * `::view-transition-*(root)` is switched off there, otherwise it would run at
 * the same time as the clip-path animation and wash it out.
 */

/** Not in lib.dom yet in TS 5.8, so the two members used here are declared locally. */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

const DURATION_MS = 520;

/**
 * Reduced motion shortens the wipe instead of skipping it.
 *
 * A one-shot reveal on an explicit button press is a different thing from
 * unprompted looping motion, and cutting it entirely means anyone with OS
 * animations disabled sees the theme snap and assumes the control is plain —
 * this project already shipped that mistake once on the login badges. Kept short
 * enough that it reads as a fast wipe rather than a sweep.
 */
const REDUCED_DURATION_MS = 180;

/**
 * Apply a theme change, revealing it as a circle growing from `origin`.
 *
 * `apply` must mutate the DOM synchronously — the API snapshots the page before
 * and after the callback, so a change queued for later (an unflushed React state
 * update, say) lands outside the transition and is not animated. Callers that
 * need React state included should wrap their `setState` in `flushSync`.
 *
 * Falls back to calling `apply` directly where the API is missing (Firefox and
 * Safari before 18), which is a plain instant switch rather than a broken one.
 */
export function revealThemeChange(origin: HTMLElement | null, apply: () => void) {
  const doc = document as ViewTransitionDocument;

  if (typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }

  // Centre the circle on the button that was pressed, so the new theme looks
  // like it is coming out from under the user's cursor. Falls back to the middle
  // of the viewport if the caller had no element to hand.
  const rect = origin?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

  // Radius needed to cover the furthest corner from that point, so the circle
  // finishes by filling the viewport rather than stopping short of a corner.
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? REDUCED_DURATION_MS
    : DURATION_MS;

  const transition = doc.startViewTransition(() => {
    apply();
  });

  void transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // A transition that is skipped (another one started, or the tab was
      // hidden) rejects `ready`. The DOM change in `apply` has already happened,
      // so there is nothing to repair — only the animation was lost.
    });
}
