// Full-screen session-lock overlay (PII blur + resume gate).
//
// This component is the visual security boundary: when it shows, it covers the
// entire app with a heavy backdrop blur so no PII is readable, and blocks all
// interaction behind it. It listens for window events from the
// FacePresenceController:
//   - "satyam:session-lock"     → show the overlay (officer left the camera)
//   - "satyam:session-present"  → officer is back; show a subtle hint
//   - clicking "Resume" hides the overlay and dispatches "satyam:session-unlock"
//     (the only thing that re-arms the presence controller).
//
// Bilingual (English / Kannada) — language read from localStorage
// "satyam.lang" (default "en").

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

type Lang = "en" | "kn";

function readLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    // The i18n provider persists the UI language under "fq-lang" as "EN"/"KN".
    return window.localStorage.getItem("fq-lang") === "KN" ? "kn" : "en";
  } catch {
    return "en";
  }
}

const COPY = {
  title: { en: "Session locked", kn: "ಸೆಷನ್ ಲಾಕ್ ಆಗಿದೆ" },
  subtitle: {
    en: "No officer detected at the workstation. Sensitive information has been hidden.",
    kn: "ಕಾರ್ಯಸ್ಥಳದಲ್ಲಿ ಅಧಿಕಾರಿ ಪತ್ತೆಯಾಗಿಲ್ಲ. ಸೂಕ್ಷ್ಮ ಮಾಹಿತಿಯನ್ನು ಮರೆಮಾಡಲಾಗಿದೆ.",
  },
  resume: { en: "Resume session", kn: "ಸೆಷನ್ ಮುಂದುವರಿಸಿ" },
  present: { en: "Officer detected — confirm to resume.", kn: "ಅಧಿಕಾರಿ ಪತ್ತೆಯಾಗಿದೆ — ಮುಂದುವರಿಸಲು ದೃಢೀಕರಿಸಿ." },
} as const;

export function LockOverlay() {
  const [locked, setLocked] = useState(false);
  const [present, setPresent] = useState(false);
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const onLock = () => {
      setLang(readLang());
      setPresent(false);
      setLocked(true);
    };
    const onPresent = () => setPresent(true);

    window.addEventListener("satyam:session-lock", onLock as EventListener);
    window.addEventListener("satyam:session-present", onPresent as EventListener);
    return () => {
      window.removeEventListener("satyam:session-lock", onLock as EventListener);
      window.removeEventListener("satyam:session-present", onPresent as EventListener);
    };
  }, []);

  if (!locked) return null;

  const resume = () => {
    setLocked(false);
    setPresent(false);
    window.dispatchEvent(new CustomEvent("satyam:session-unlock", { detail: {} }));
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={COPY.title[lang]}
      className="fixed inset-0 flex items-center justify-center bg-zinc-950/70 backdrop-blur-xl"
      style={{ zIndex: 2147483600 }}
    >
      <div className="mx-4 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-zinc-700/60 bg-background/95 p-8 text-center shadow-2xl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800/80 ring-1 ring-zinc-600/60">
          <Lock className="h-8 w-8 text-zinc-100" aria-hidden="true" />
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">{COPY.title[lang]}</h2>
          <p className="text-sm text-muted-foreground">{COPY.subtitle[lang]}</p>
        </div>

        {present && (
          <p className="text-sm font-medium text-emerald-400">{COPY.present[lang]}</p>
        )}

        <button
          type="button"
          onClick={resume}
          autoFocus
          className="mt-2 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
        >
          {COPY.resume[lang]}
        </button>
      </div>
    </div>
  );
}
