/**
 * Theme catalogue and the single function that applies one to the document.
 *
 * Extracted from `components/ThemePicker.tsx` because two components need it now:
 * the picker itself and the header's `DarkModeToggle`. Toggling the `dark` class
 * on its own is not sufficient (see `applyTheme` below), so the toggle has to go
 * through the same code path rather than keep a second copy of the rule.
 *
 * It lives in `lib/` rather than being exported from the component file so Vite's
 * fast refresh keeps working — a module that exports both a component and plain
 * functions loses HMR for the whole file.
 */

export type Theme = {
  id: string;
  label: string;
  desc: string;
  swatch: string;
  main: string;
  background: string;
  /** If true, uses data-theme CSS variables instead of inline style overrides. */
  usesDataTheme?: boolean;
};

export const THEMES: Theme[] = [
  // ── Existing themes (inline --main / --background overrides) ──────────────
  {
    id: "default",
    label: "Default Blue",
    desc: "Cool blue theme",
    swatch: "#91C5FD",
    main: "#91C5FD",
    background: "#f0f6fc",
  },
  {
    id: "coral",
    label: "Coral",
    desc: "Warm coral and orange",
    swatch: "#FF7A59",
    main: "#FF7A59",
    background: "#FFF4EE",
  },
  {
    id: "rose",
    label: "Rose",
    desc: "Pink and rose theme",
    swatch: "#F472B6",
    main: "#F472B6",
    background: "#FDF2F8",
  },
  {
    id: "purple",
    label: "Purple",
    desc: "Purple and violet theme",
    swatch: "#A78BFA",
    main: "#A78BFA",
    background: "#F5F3FF",
  },
  {
    id: "ocean",
    label: "Ocean",
    desc: "Blue ocean theme",
    swatch: "#38BDF8",
    main: "#38BDF8",
    background: "#ECFEFF",
  },
  {
    id: "emerald",
    label: "Emerald",
    desc: "Green emerald theme",
    swatch: "#34D399",
    main: "#34D399",
    background: "#ECFDF5",
  },
  {
    id: "sunshine",
    label: "Sunshine",
    desc: "Yellow sunshine theme",
    swatch: "#FACC15",
    main: "#FACC15",
    background: "#FEFCE8",
  },

  // ── Professional themes (data-theme CSS variable blocks) ──────────────────
  {
    id: "slate",
    label: "Slate",
    desc: "Clean corporate blue-gray",
    swatch: "hsl(215 20% 45%)",
    main: "hsl(215 20% 45%)",
    background: "hsl(215 20% 96%)",
    usesDataTheme: true,
  },
  {
    id: "indigo",
    label: "Indigo",
    desc: "Modern premium violet-blue",
    swatch: "hsl(239 84% 67%)",
    main: "hsl(239 84% 67%)",
    background: "hsl(240 20% 97%)",
    usesDataTheme: true,
  },
  {
    id: "forest",
    label: "Forest",
    desc: "Calm, trustworthy deep green",
    swatch: "hsl(158 45% 38%)",
    main: "hsl(158 45% 38%)",
    background: "hsl(150 20% 96%)",
    usesDataTheme: true,
  },
  {
    id: "graphite",
    label: "Graphite",
    desc: "Near-monochrome, very premium",
    swatch: "hsl(220 9% 36%)",
    main: "hsl(220 9% 36%)",
    background: "hsl(220 10% 95%)",
    usesDataTheme: true,
  },
  {
    id: "midnight",
    label: "Midnight",
    desc: "Navy-leaning, executive dark",
    swatch: "hsl(222 40% 42%)",
    main: "hsl(222 40% 42%)",
    background: "hsl(222 20% 96%)",
    usesDataTheme: true,
  },
  {
    id: "pine",
    label: "Pine",
    desc: "Muted evergreen, deep forest",
    swatch: "hsl(165 25% 32%)",
    main: "hsl(165 25% 32%)",
    background: "hsl(160 15% 96%)",
    usesDataTheme: true,
  },
];

export const THEME_STORAGE_KEY = "fq-theme";
export const DARK_STORAGE_KEY = "fq-dark";

export function applyTheme(t: Theme, dark: boolean) {
  const root = document.documentElement;

  // Always clear any previous data-theme so old CSS blocks don't bleed.
  root.removeAttribute("data-theme");

  if (t.usesDataTheme) {
    // New professional themes: set data-theme and let CSS do the work.
    root.setAttribute("data-theme", t.id);
    // Remove any inline --main / --background overrides from previous themes.
    root.style.removeProperty("--main");
    root.style.removeProperty("--background");
  } else {
    // Legacy themes: override via inline style properties.
    root.style.setProperty("--main", t.main);

    // `--background` is deliberately NOT pinned in dark mode.
    //
    // These themes only ever defined light-mode values (`#f0f6fc`, `#FFF4EE`, and
    // so on). An inline custom property on <html> outranks every selector, so
    // setting one here beat `.dark { --background: oklch(18% ...) }` and left the
    // main content area on a near-white background while `--foreground` correctly
    // flipped to near-white text. The result was unreadable: on /ask the headline
    // came out white-on-white. Dropping the override in dark mode lets the `.dark`
    // block win, which is what it was written for.
    //
    // `--main` is still applied in both modes: it is the accent hue the officer
    // picked, it is only ever used against a surface rather than as one, and
    // clearing it would collapse all seven legacy themes to an identical dark
    // palette.
    if (dark) root.style.removeProperty("--background");
    else root.style.setProperty("--background", t.background);
  }

  // Ensure dark class is in sync so [data-theme="x"].dark blocks apply.
  root.classList.toggle("dark", dark);
}

/** Look up the saved theme and apply it for the given light/dark state. */
export function applyStoredTheme(dark: boolean) {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) ?? "default";
  applyTheme(THEMES.find((x) => x.id === saved) ?? THEMES[0], dark);
}
