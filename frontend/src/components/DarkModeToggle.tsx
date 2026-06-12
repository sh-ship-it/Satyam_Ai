import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const DARK_KEY = "fq-dark";

export function DarkModeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const d = localStorage.getItem(DARK_KEY) === "1";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(DARK_KEY, next ? "1" : "0");
  };

  return (
    <button
      onClick={toggle}
      className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
