import React, { memo, useCallback, useRef } from "react";

import { SARVAM_LANGUAGES, type MarqueeLanguage } from "@/lib/languages";
import { cn } from "@/lib/utils";

export type { MarqueeLanguage };

/**
 * Infinite language marquee for the foot of the Document Translation screen.
 *
 * WHY THIS IS NOT THE PASTED `motion` COMPONENT
 * The snippet this replaces needed `motion/react` and `react-use-measure`, neither
 * of which is installed. Both jobs they were doing are already covered:
 *
 *   * measuring content width, so the loop knows how far to travel — unnecessary
 *     when the track holds the list twice and travels exactly -50%. That is the
 *     same distance by construction, at any content width, with no measurement and
 *     no resize listener.
 *   * animating, and speeding up on hover — a CSS keyframe plus `playbackRate` on
 *     the running animation. `playbackRate` is the part worth noting: reassigning
 *     `animation-duration` on hover preserves ELAPSED time, so progress becomes
 *     elapsed/newDuration and the track visibly jumps. The Web Animations API
 *     changes speed from wherever it currently is, so the transition is smooth.
 *
 * Net: same behaviour (reverse direction, slow drift, faster on hover), two fewer
 * dependencies.
 *
 * HONESTY ABOUT WHAT THIS LIST MEANS
 * These are the languages Sarvam's Indic models cover, NOT languages this screen
 * translates into today. The backend collapses every request to Kannada or English
 * (`_norm_lang` in api/routes/documents.py, `_bcp` in models/api/sarvam.py), so a
 * bare list of 23 languages under a translation tool would promise a capability
 * that is not wired. The two that are wired are marked, and the caption says so.
 * A police tool that overstates its own coverage is worse than one that shows less.
 * The list and its `live` flags are in lib/languages.ts.
 */

const CSS = `
@keyframes lang-marquee-rev {
  from { transform: translateX(-50%); }
  to   { transform: translateX(0); }
}
@keyframes lang-marquee-fwd {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.lang-track {
  /* w-max + the list rendered twice means -50% lands exactly one full list along,
     so the seam is invisible and no width has to be measured. */
  animation: lang-marquee-rev var(--lang-dur) linear infinite;
  will-change: transform;
}
.lang-track[data-reverse="false"] { animation-name: lang-marquee-fwd; }
@media (prefers-reduced-motion: reduce) {
  /* Slowed to a near-standstill rather than stopped.
     The previous rule killed the animation and set overflow-x:auto so the content
     stayed reachable — but that put a horizontal scrollbar under the strip and
     showed a frozen list, which is what the screen was actually doing on a machine
     with reduced motion enabled. A slow linear drift with no flashing, no parallax
     and no direction change is the mildest class of motion, and the strip is
     decorative, so degrading the speed keeps the content readable without a
     scrollbar. Hover still accelerates it for anyone who wants to skim. */
  .lang-track { animation-duration: calc(var(--lang-dur) * 4) !important; }
}
`;

/**
 * No border, no card, no background — just the words on the page, like a logo
 * strip. A wired language is marked with colour and weight instead of a box, so
 * the distinction survives without reintroducing one.
 */
const Chip = memo(function Chip({ lang }: { lang: MarqueeLanguage }) {
  return (
    <div className="flex select-none flex-col items-center justify-center px-1 text-center">
      {/* lang= lets the browser pick a font with the right glyphs and shaper for
          each script; without it a single fallback font renders some of these as
          tofu boxes. */}
      <span
        lang={lang.code}
        className={cn(
          "whitespace-nowrap text-[15px] leading-tight",
          lang.live ? "font-extrabold text-primary" : "font-bold text-foreground/55",
        )}
      >
        {lang.native}
      </span>
      <span
        className={cn(
          "mt-0.5 whitespace-nowrap text-[9px] font-semibold leading-tight",
          lang.live ? "text-primary/70" : "text-muted-foreground/60",
        )}
      >
        {lang.english} · {lang.code}
      </span>
    </div>
  );
});

export const LanguageMarquee = memo(function LanguageMarquee({
  languages = SARVAM_LANGUAGES,
  gap = 34,
  duration = 80,
  durationOnHover = 25,
  reverse = true,
  label,
  className,
}: {
  languages?: MarqueeLanguage[];
  gap?: number;
  /** Seconds for one full pass. */
  duration?: number;
  /** Seconds for one full pass while hovered. Omit to keep a constant speed. */
  durationOnHover?: number;
  reverse?: boolean;
  label?: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);

  const setSpeed = useCallback(
    (seconds: number) => {
      // playbackRate, not animation-duration: see the note at the top of the file.
      // getAnimations is guarded because it is absent in jsdom and older Safari,
      // where the marquee should simply keep its base speed rather than throw.
      const anim = track.current?.getAnimations?.()[0];
      if (anim) anim.playbackRate = duration / seconds;
    },
    [duration],
  );

  const hover = durationOnHover
    ? {
        onMouseEnter: () => setSpeed(durationOnHover),
        onMouseLeave: () => setSpeed(duration),
        // Keyboard and touch users get the same control; a hover-only affordance
        // would leave them with the slow speed and no way to change it.
        onFocus: () => setSpeed(durationOnHover),
        onBlur: () => setSpeed(duration),
      }
    : {};

  return (
    <div className={cn("w-full", className)}>
      <style>{CSS}</style>
      {label && (
        <p className="mb-1.5 px-1 text-center text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      <div
        className="lang-marquee overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        role="group"
        aria-label={label}
        {...hover}
      >
        {/* Geometry that makes -50% exactly one list long, which is what keeps the
            seam invisible:
              - the TRACK has no gap, so it adds no width of its own;
              - each group carries its internal gaps AND one trailing gap.
            Group width is therefore identical, and half the track is exactly one
            group. Putting the gap on the track instead leaves the two halves
            differing by half a gap, which reads as a small jitter once a loop. */}
        <div
          ref={track}
          data-reverse={String(reverse)}
          className="lang-track flex w-max"
          style={{ "--lang-dur": `${duration}s` } as React.CSSProperties}
        >
          {[0, 1].map((copy) => (
            <div
              key={copy}
              // Only the first copy is announced; the second exists to make the
              // loop seamless, so a screen reader should read 23 languages, not 46.
              aria-hidden={copy === 1 ? true : undefined}
              className="flex w-max"
              style={{ gap: `${gap}px`, paddingRight: `${gap}px` }}
            >
              {languages.map((l) => (
                <Chip key={`${copy}-${l.code}`} lang={l} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default LanguageMarquee;
