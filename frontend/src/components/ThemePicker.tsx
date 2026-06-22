import { useEffect, useRef, useState } from "react";
import { Palette, Check, Moon, Sun } from "lucide-react";

type Theme = {
  id: string;
  label: string;
  desc: string;
  swatch: string;
  main: string;
  background: string;
  /** If true, uses data-theme CSS variables instead of inline style overrides. */
  usesDataTheme?: boolean;
};

const THEMES: Theme[] = [
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

const STORAGE_KEY = "fq-theme";
const DARK_KEY = "fq-dark";

/** The set of data-theme IDs — used to clean up when switching away. */
const DATA_THEME_IDS = new Set(THEMES.filter((t) => t.usesDataTheme).map((t) => t.id));

function applyTheme(t: Theme, dark: boolean) {
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
    root.style.setProperty("--background", t.background);
  }

  // Ensure dark class is in sync so [data-theme="x"].dark blocks apply.
  root.classList.toggle("dark", dark);
}

interface ThemePickerProps {
  buttonClass?: string;
}

export function ThemePicker({ buttonClass }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("default");
  const [dark, setDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? "default";
    const t = THEMES.find((x) => x.id === saved) ?? THEMES[0];
    const d = localStorage.getItem(DARK_KEY) === "1";
    setActive(t.id);
    setDark(d);
    applyTheme(t, d);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const choose = (t: Theme) => {
    setActive(t.id);
    applyTheme(t, dark);
    localStorage.setItem(STORAGE_KEY, t.id);
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    const t = THEMES.find((x) => x.id === active) ?? THEMES[0];
    document.documentElement.classList.toggle("dark", next);
    // Re-apply theme so data-theme + dark class are consistent.
    applyTheme(t, next);
    localStorage.setItem(DARK_KEY, next ? "1" : "0");
  };

  const activeTheme = THEMES.find((t) => t.id === active) ?? THEMES[0];

  // Group themes for display
  const legacyThemes = THEMES.filter((t) => !t.usesDataTheme);
  const proThemes = THEMES.filter((t) => t.usesDataTheme);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClass ||
          "flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-secondary-background px-2.5 py-1.5 text-xs font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
        }
        aria-label="Theme"
      >
        <Palette className="h-3.5 w-3.5" />
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-foreground"
          style={{ background: activeTheme.swatch }}
        />
        <span>Theme</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-[5px] border-2 border-foreground bg-main nb-shadow z-50 overflow-hidden">
          <div className="flex items-center gap-2 border-b-2 border-foreground bg-main px-3 py-2.5 text-main-foreground">
            <Palette className="h-4 w-4" />
            <span className="text-sm font-extrabold">Color Themes</span>
          </div>

          <div className="bg-secondary-background max-h-[420px] overflow-y-auto">
            {/* Legacy themes */}
            {legacyThemes.map((t) => (
              <ThemeRow key={t.id} theme={t} active={active} choose={choose} />
            ))}

            {/* Divider */}
            <div className="flex items-center gap-2 border-y border-foreground/20 bg-muted/40 px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Professional
              </span>
            </div>

            {/* Professional themes */}
            {proThemes.map((t) => (
              <ThemeRow key={t.id} theme={t} active={active} choose={choose} />
            ))}

            {/* Dark mode toggle */}
            <button
              onClick={toggleDark}
              className="flex w-full items-center gap-2 border-t-2 border-foreground bg-secondary-background px-3 py-2.5 text-sm font-bold text-foreground hover:bg-main/10 transition"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              Switch to {dark ? "Light" : "Dark"} Mode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeRow({
  theme,
  active,
  choose,
}: {
  theme: Theme;
  active: string;
  choose: (t: Theme) => void;
}) {
  const isActive = active === theme.id;
  return (
    <button
      onClick={() => choose(theme)}
      className="flex w-full items-start gap-3 border-b border-foreground/10 px-3 py-2.5 text-left hover:bg-main/10 transition"
    >
      <span
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-foreground"
        style={{ background: theme.swatch }}
      >
        {isActive && <Check className="h-3 w-3 text-foreground" strokeWidth={3} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold leading-tight text-foreground">{theme.label}</span>
        <span className="block text-[11px] text-muted-foreground">{theme.desc}</span>
      </span>
      {isActive && <Check className="mt-1 h-4 w-4 shrink-0 text-foreground" strokeWidth={3} />}
    </button>
  );
}
