import { useEffect, useRef, useState } from "react";
import { Palette, Check, Moon, Sun } from "lucide-react";

type Theme = {
  id: string;
  label: string;
  desc: string;
  swatch: string;
  main: string;
  background: string;
};

const THEMES: Theme[] = [
  { id: "default", label: "Default Blue", desc: "Cool blue theme", swatch: "#91C5FD", main: "#91C5FD", background: "#f0f6fc" },
  { id: "coral", label: "Coral", desc: "Warm coral and orange theme", swatch: "#FF7A59", main: "#FF7A59", background: "#FFF4EE" },
  { id: "rose", label: "Rose", desc: "Pink and rose theme", swatch: "#F472B6", main: "#F472B6", background: "#FDF2F8" },
  { id: "purple", label: "Purple", desc: "Purple and violet theme", swatch: "#A78BFA", main: "#A78BFA", background: "#F5F3FF" },
  { id: "ocean", label: "Ocean", desc: "Blue ocean theme", swatch: "#38BDF8", main: "#38BDF8", background: "#ECFEFF" },
  { id: "emerald", label: "Emerald", desc: "Green emerald theme", swatch: "#34D399", main: "#34D399", background: "#ECFDF5" },
  { id: "sunshine", label: "Sunshine", desc: "Yellow sunshine theme", swatch: "#FACC15", main: "#FACC15", background: "#FEFCE8" },
];

const STORAGE_KEY = "fq-theme";
const DARK_KEY = "fq-dark";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--main", t.main);
  root.style.setProperty("--background", t.background);
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
    setActive(t.id);
    applyTheme(t);
    const d = localStorage.getItem(DARK_KEY) === "1";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
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
    applyTheme(t);
    localStorage.setItem(STORAGE_KEY, t.id);
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(DARK_KEY, next ? "1" : "0");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={buttonClass || "flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-secondary-background px-2.5 py-1.5 text-xs font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"}
        aria-label="Theme"
      >
        <Palette className="h-3.5 w-3.5" />
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-foreground"
          style={{ background: THEMES.find((t) => t.id === active)?.main }}
        />
        <span>Theme</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-[5px] border-2 border-foreground bg-main nb-shadow z-50 overflow-hidden">
          <div className="flex items-center gap-2 border-b-2 border-foreground bg-main px-3 py-2.5 text-main-foreground">
            <Palette className="h-4 w-4" />
            <span className="text-sm font-extrabold">Color Themes</span>
          </div>
          <div className="bg-secondary-background">
            {THEMES.map((t) => {
              const isActive = active === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => choose(t)}
                  className="flex w-full items-start gap-3 border-b border-foreground/10 px-3 py-2.5 text-left hover:bg-main/10 transition"
                >
                  <span
                    className="mt-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-foreground"
                    style={{ background: t.swatch }}
                  >
                    {isActive && <Check className="h-3 w-3 text-foreground" strokeWidth={3} />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-bold leading-tight text-foreground">{t.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{t.desc}</span>
                  </span>
                  {isActive && <Check className="mt-1 h-4 w-4 text-foreground" strokeWidth={3} />}
                </button>
              );
            })}
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
