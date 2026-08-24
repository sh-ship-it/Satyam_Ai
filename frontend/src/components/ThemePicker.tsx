import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Palette, Check, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { revealThemeChange } from "@/lib/viewTransition";
import {
  applyTheme,
  DARK_STORAGE_KEY as DARK_KEY,
  THEME_STORAGE_KEY as STORAGE_KEY,
  THEMES,
  type Theme,
} from "@/lib/theme";

interface ThemePickerProps {
  buttonClass?: string;
}

export function ThemePicker({ buttonClass }: ThemePickerProps) {
  const { t } = useI18n();
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

  // Both handlers below reveal the change as a circle growing from the control
  // that triggered it. `flushSync` keeps the React-driven bits (the active swatch,
  // the tick, the sun/moon icon) inside the snapshot the transition captures;
  // without it they would repaint a frame after the wipe had passed over them.
  const choose = (t: Theme) => {
    revealThemeChange(ref.current, () => {
      flushSync(() => setActive(t.id));
      applyTheme(t, dark);
    });
    localStorage.setItem(STORAGE_KEY, t.id);
  };

  const toggleDark = () => {
    const next = !dark;
    const t = THEMES.find((x) => x.id === active) ?? THEMES[0];
    revealThemeChange(ref.current, () => {
      flushSync(() => setDark(next));
      document.documentElement.classList.toggle("dark", next);
      // Re-apply theme so data-theme + dark class are consistent.
      applyTheme(t, next);
    });
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
        aria-label={t("Theme")}
      >
        <Palette className="h-3.5 w-3.5" />
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-foreground"
          style={{ background: activeTheme.swatch }}
        />
        <span>{t("Theme")}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-[5px] border-2 border-foreground bg-main nb-shadow z-50 overflow-hidden">
          <div className="flex items-center gap-2 border-b-2 border-foreground bg-main px-3 py-2.5 text-main-foreground">
            <Palette className="h-4 w-4" />
            <span className="text-sm font-extrabold">{t("Color Themes")}</span>
          </div>

          <div className="bg-secondary-background max-h-[420px] overflow-y-auto">
            {/* Legacy themes */}
            {legacyThemes.map((t) => (
              <ThemeRow key={t.id} theme={t} active={active} choose={choose} />
            ))}

            {/* Divider */}
            <div className="flex items-center gap-2 border-y border-foreground/20 bg-muted/40 px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("Professional")}
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
              {dark ? t("Switch to Light Mode") : t("Switch to Dark Mode")}
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
