import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { revealThemeChange } from "@/lib/viewTransition";
import { applyStoredTheme, DARK_STORAGE_KEY as DARK_KEY } from "@/lib/theme";

export function DarkModeToggle() {
  const [dark, setDark] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = localStorage.getItem(DARK_KEY) === "1";
    setDark(d);
    applyStoredTheme(d);
  }, []);

  const toggle = () => {
    const next = !dark;
    // The circle grows from this button, so the switch appears to originate where
    // it was pressed.
    revealThemeChange(btnRef.current, () => {
      // `flushSync` so the icon swap is part of the snapshot the transition
      // captures. Left to React's normal batching it would land a frame later and
      // visibly pop after the wipe had already passed over it.
      flushSync(() => setDark(next));
      // Goes through the theme layer rather than toggling the class directly: for
      // the legacy themes the inline `--background` override has to be dropped in
      // dark mode, and a bare class toggle left it pinned to a light value.
      applyStoredTheme(next);
    });
    localStorage.setItem(DARK_KEY, next ? "1" : "0");
  };

  return (
    <button
      ref={btnRef}
      onClick={toggle}
      className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
