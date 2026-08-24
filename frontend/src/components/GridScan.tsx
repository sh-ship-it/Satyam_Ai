import { useEffect, useRef } from "react";
import { cn, cssColorToRgb, mixRgb } from "@/lib/utils";

/**
 * Scanning-grid backdrop: a hard grid with a beam sweeping down it, lighting the
 * lines as it passes, plus a pool of light that follows the pointer.
 *
 * Written here rather than installed. The usage this came from imports a local
 * `./GridScan` that does not exist in this repo, and the published component of
 * that name is a React Three Fiber piece leaning on `@react-three/postprocessing`
 * for bloom, chromatic aberration and noise. That would be four new dependencies
 * (`@react-three/fiber`, `drei`, `postprocessing`, plus their peer graph) for a
 * decorative layer, when `three` is already a dependency and the whole effect is
 * procedural — it is one fullscreen quad and one fragment shader.
 *
 * The prop names and defaults match that usage so the call site reads the same.
 *
 * ## Theme
 *
 * `linesColor` and `scanColor` are optional on purpose. Left unset they are read
 * from the live theme tokens — `--main` for the beam, `--foreground` blended
 * toward `--background` for the lines — and re-read whenever `ThemePicker` or
 * `DarkModeToggle` rewrites them, so the backdrop follows all thirteen themes and
 * both modes for free. Passing a colour explicitly opts out of that and pins it.
 *
 * ## SSR
 *
 * `three` is imported inside the effect, not at module scope: this route is
 * server-rendered and the module touches `document` on construction. Until the
 * GPU path is up (and permanently, if it fails) the host div paints the plain CSS
 * grid it replaced, so the screen is never blank and never depends on WebGL.
 */

/**
 * `gridScale` is expressed as a fraction of this width, so the default `0.1`
 * gives 80px cells — the same pitch as the CSS grid this replaced on /login.
 * Fixed rather than viewport-relative so the grid does not change density when
 * the window resizes.
 */
const GRID_BASE_PX = 800;

/** Cell pitch in CSS px for a given `gridScale`. */
function gridCellPx(gridScale: number): number {
  // Guard the divide-by-nothing case: a zero or negative scale would make the
  // shader's `fract(p / uCell)` produce NaN and blank the canvas.
  return Math.max(GRID_BASE_PX * gridScale, 2);
}

/** Seconds for one top-to-bottom sweep. */
const SWEEP_SECONDS = 7;

/**
 * Where in the sweep the beam sits at first paint.
 *
 * Not zero: the sweep starts above the top edge so it enters cleanly rather than
 * materialising, which means a phase of 0 spends the first second of every page
 * load with nothing on screen but a static grid. Starting a quarter in puts the
 * beam at roughly a fifth of the way down, already visible.
 */
const SWEEP_PHASE = 0.28;

/**
 * Under `prefers-reduced-motion` the sweep is slowed, not stopped.
 *
 * Consistent with the trust badges on the same screen: a beam crawling down over
 * 24s reads as ambient rather than as motion demanding to be tracked, whereas a
 * frozen beam parked mid-screen looks like the page failed to load.
 */
const REDUCED_SWEEP_SECONDS = 24;

/** The CSS grid painted behind the canvas — the no-WebGL and pre-hydration state. */
const FALLBACK_GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px)",
  backgroundSize: "80px 80px",
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // The quad is already in clip space (PlaneGeometry(2, 2)), so no camera
    // transform is applied — this is a full-viewport blit.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;

  uniform vec2  uRes;          // drawing surface in CSS px
  uniform float uTime;         // seconds since mount, for the noise dither
  uniform float uSweep;        // beam position, 0..1 top to bottom
  uniform vec3  uBg;
  uniform vec3  uLines;
  uniform vec3  uScan;
  uniform float uCell;         // px between grid lines
  uniform float uThickness;    // px
  uniform float uScanOpacity;
  uniform float uSensitivity;
  uniform float uBloom;
  uniform float uCA;
  uniform float uNoise;
  uniform vec3  uPointer;      // xy in CSS px from the top-left, z = presence 0..1

  /**
   * Coverage of the nearest grid line at p, antialiased over one pixel.
   *
   * fract(p / uCell) is 0 on a line, so abs(fract - 0.5) * uCell is the distance
   * from the cell centre; subtracting it from the half-cell gives the distance to
   * the nearest line, in px, which smoothsteps into a constant-width stroke at
   * any cell size.
   */
  float lineMask(vec2 p, float thick) {
    vec2 fromCentre = abs(fract(p / uCell) - 0.5) * uCell;
    vec2 toLine = uCell * 0.5 - fromCentre;
    float d = min(toLine.x, toLine.y);
    return 1.0 - smoothstep(thick * 0.5, thick * 0.5 + 1.0, d);
  }

  /**
   * Beam intensity at height py, with the narrow core returned separately so the
   * bloom pass can glow the core without also glowing the long tail.
   *
   * The beam overshoots both edges (-0.2 .. 1.2) so it enters and leaves cleanly
   * instead of materialising at the top of the screen.
   */
  float beam(float py, float trail, out float core) {
    float y = mix(-0.2, 1.2, uSweep) * uRes.y;
    float d = py - y;
    core = exp(-abs(d) / max(uThickness * 2.0, 2.0));
    // The tail sits above the beam: that is the part of the grid it has passed.
    float tail = d < 0.0 ? exp(d / trail) : 0.0;
    return max(core, tail * 0.85);
  }

  /** Final opaque colour at one point, in CSS px, top-left origin. */
  vec3 layer(vec2 p) {
    // sensitivity drives how far the beam's influence reaches and how hard it
    // lights what it reaches — one knob, both halves of "responsive".
    float trail = mix(60.0, 240.0, uSensitivity);
    float reach = mix(90.0, 260.0, uSensitivity);
    float gain = 0.45 + uSensitivity;

    float core;
    float wave = beam(p.y, trail, core);
    float pool = uPointer.z * exp(-length(p - uPointer.xy) / reach);
    float lit = clamp((wave + pool) * gain, 0.0, 1.4);

    float stroke = lineMask(p, uThickness);
    float lineA = stroke;

    // The beam lights the lines hard and the cell interiors faintly, so it reads
    // as a sheet passing over a grid rather than a bar drawn on top of one.
    float scanA = (stroke * 0.9 + 0.16) * lit * uScanOpacity;

    if (uBloom > 0.0) {
      // ponytail: bloom is a wide, dim second stroke rather than a real
      // blur-and-add pass. Ceiling — it glows the lines and the beam core, not
      // arbitrary bright pixels, which is all this image contains anyway. Upgrade
      // path if that stops being true: EffectComposer + UnrealBloomPass, which
      // costs two render targets and several passes per frame.
      // Only the lit terms bloom. An earlier version also widened the resting
      // grid, which made the backdrop read heavier than the 8% CSS grid it
      // replaced — bloom should glow what the beam touches, not the whole page.
      float halo = lineMask(p, uThickness + 7.0) * 0.30;
      scanA += halo * lit * uScanOpacity * uBloom;
      scanA += core * uScanOpacity * uBloom * 0.5;
    }

    float total = clamp(lineA + scanA, 0.0, 1.0);
    vec3 c = (uLines * lineA + uScan * scanA) / max(lineA + scanA, 1e-4);
    // Composited against the theme background here rather than left as straight
    // alpha for the browser to blend. The channel split below has to have a
    // background to fringe against: with a transparent canvas, an offset sample
    // that lands on a line while its neighbours do not contributes to one channel
    // only, and a 1px grid stroke comes out as solid red and blue lines instead of
    // a lens fringe on the edge of a stroke.
    return mix(uBg, c, total);
  }

  void main() {
    // vUv runs bottom-up; flip so the beam sweeps downward on screen and the
    // pointer position needs no conversion from client coordinates.
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 p = uv * uRes;

    vec3 o;
    if (uCA > 0.0) {
      // Radial split, zero at the centre and widest at the corners, like a lens.
      vec2 off = (uv - 0.5) * uCA * uRes;
      o = vec3(layer(p + off).r, layer(p).g, layer(p - off).b);
    } else {
      o = layer(p);
    }

    if (uNoise > 0.0) {
      float n = fract(sin(dot(gl_FragCoord.xy + uTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
      o += (n - 0.5) * uNoise * 2.0;
    }

    gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
  }
`;

export type GridScanProps = {
  className?: string;
  /** 0..1 — how far the beam's influence spreads and how hard it lights the grid. */
  sensitivity?: number;
  /** Grid stroke width in CSS px. */
  lineThickness?: number;
  /** Grid line colour. Omit to follow the theme. */
  linesColor?: string;
  /** Cell pitch as a fraction of 800px, so 0.1 is an 80px grid. */
  gridScale?: number;
  /** Beam colour. Omit to follow the theme's `--main`. */
  scanColor?: string;
  /** Peak opacity of the beam. */
  scanOpacity?: number;
  /** Master switch for the three cheap in-shader post effects below. */
  enablePost?: boolean;
  bloomIntensity?: number;
  /** Channel split at the corners, as a fraction of the viewport. */
  chromaticAberration?: number;
  noiseIntensity?: number;
};

export function GridScan({
  className,
  sensitivity = 0.55,
  lineThickness = 1,
  linesColor,
  gridScale = 0.1,
  scanColor,
  scanOpacity = 0.4,
  enablePost = true,
  bloomIntensity = 0.6,
  chromaticAberration = 0.002,
  noiseIntensity = 0.01,
}: GridScanProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Every prop is a dependency, so a change rebuilds the renderer rather than
  // patching uniforms in place. Deliberate: these are configuration, set once at
  // the call site, and the alternative is a ref mirror of all ten of them.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let teardown: (() => void) | undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    void import("three")
      .then((THREE) => {
        if (disposed) return;

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block";

        const renderer = new THREE.WebGLRenderer({
          canvas,
          // Opaque: the shader composites against `--background` itself so the
          // chromatic split has something to fringe against. Visually identical to
          // a transparent canvas as long as this sits on a `bg-background`
          // surface, which is the only way it is used.
          alpha: false,
          // The shader antialiases the strokes analytically, so MSAA would only
          // cost fill rate.
          antialias: false,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const resolveColors = () => {
          const cs = getComputedStyle(document.documentElement);
          const isDark = document.documentElement.classList.contains("dark");
          const bg = cssColorToRgb(
            cs.getPropertyValue("--background"),
            isDark ? [0.14, 0.15, 0.19] : [0.94, 0.96, 0.99],
          );
          const fg = cssColorToRgb(
            cs.getPropertyValue("--foreground"),
            isDark ? [0.92, 0.92, 0.92] : [0, 0, 0],
          );
          return {
            bg,
            // Matches the 8%-of-foreground CSS grid this replaced, pre-mixed
            // against the background so the stroke can be drawn at full alpha.
            lines: linesColor
              ? cssColorToRgb(linesColor, fg)
              : mixRgb(bg, fg, isDark ? 0.16 : 0.09),
            // --main is the token ThemePicker actually rewrites for all thirteen
            // themes, which is why the beam reads it rather than --primary.
            scan: scanColor
              ? cssColorToRgb(scanColor, [0, 0.5, 0.98])
              : cssColorToRgb(cs.getPropertyValue("--main"), [0.57, 0.77, 0.99]),
          };
        };

        const initial = resolveColors();
        const uniforms = {
          uRes: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uSweep: { value: 0 },
          uBg: { value: new THREE.Vector3(...initial.bg) },
          uLines: { value: new THREE.Vector3(...initial.lines) },
          uScan: { value: new THREE.Vector3(...initial.scan) },
          uCell: { value: gridCellPx(gridScale) },
          uThickness: { value: Math.max(lineThickness, 0.25) },
          uScanOpacity: { value: scanOpacity },
          uSensitivity: { value: Math.min(Math.max(sensitivity, 0), 1) },
          uBloom: { value: enablePost ? bloomIntensity : 0 },
          uCA: { value: enablePost ? chromaticAberration : 0 },
          uNoise: { value: enablePost ? noiseIntensity : 0 },
          uPointer: { value: new THREE.Vector3(0, 0, 0) },
        };

        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms,
          depthTest: false,
          depthWrite: false,
          // One opaque quad covering every pixel — there is nothing to blend with,
          // so gl_FragColor is written verbatim.
          blending: THREE.NoBlending,
        });
        const mesh = new THREE.Mesh(geometry, material);
        // The vertex shader ignores the camera, so the quad's world-space bounds
        // mean nothing to the frustum test — leaving culling on risks the whole
        // effect being skipped for reasons that have no bearing on what it draws.
        mesh.frustumCulled = false;
        const scene = new THREE.Scene();
        scene.add(mesh);
        // render() needs a camera object but the quad ignores it.
        const camera = new THREE.Camera();

        const resize = () => {
          const w = Math.max(host.clientWidth, 1);
          const h = Math.max(host.clientHeight, 1);
          renderer.setSize(w, h, false);
          uniforms.uRes.value.set(w, h);
        };
        const ro = new ResizeObserver(resize);
        ro.observe(host);
        resize();

        // Re-read the palette only when the theme actually changes, not per frame.
        const mo = new MutationObserver(() => {
          const next = resolveColors();
          uniforms.uBg.value.set(...next.bg);
          uniforms.uLines.value.set(...next.lines);
          uniforms.uScan.value.set(...next.scan);
        });
        mo.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });

        // Tracked on the window, not the canvas: the pointer is over the sign-in
        // card most of the time, and a listener on the canvas would go dead the
        // moment it did.
        let px = 0;
        let py = 0;
        let presence = 0;
        let target = 0;
        const onMove = (e: PointerEvent) => {
          const r = host.getBoundingClientRect();
          px = e.clientX - r.left;
          py = e.clientY - r.top;
          target = 1;
        };
        // A pointer that leaves the window never sends a final position, so
        // without this the pool would stay lit wherever it was last seen.
        const onLeave = () => {
          target = 0;
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        document.addEventListener("pointerleave", onLeave);

        host.appendChild(canvas);
        // GPU path is live — drop the CSS fallback so the two grids do not stack.
        host.style.backgroundImage = "none";

        const start = performance.now();
        const frame = (now: number) => {
          if (disposed) return;
          const t = (now - start) / 1000;
          const period = reduced.matches ? REDUCED_SWEEP_SECONDS : SWEEP_SECONDS;
          uniforms.uTime.value = t;
          uniforms.uSweep.value = (t / period + SWEEP_PHASE) % 1;
          presence += (target - presence) * 0.08;
          uniforms.uPointer.value.set(px, py, presence);
          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        teardown = () => {
          ro.disconnect();
          mo.disconnect();
          window.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerleave", onLeave);
          geometry.dispose();
          material.dispose();
          renderer.dispose();
        };
      })
      .catch((e) => {
        // Leaves the CSS fallback grid in place, which is the whole point of it.
        console.warn("GridScan: WebGL unavailable, using static grid.", e);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      teardown?.();
      host.replaceChildren();
      host.style.backgroundImage = "";
    };
  }, [
    sensitivity,
    lineThickness,
    linesColor,
    gridScale,
    scanColor,
    scanOpacity,
    enablePost,
    bloomIntensity,
    chromaticAberration,
    noiseIntensity,
  ]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={FALLBACK_GRID}
    />
  );
}
