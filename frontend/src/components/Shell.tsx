import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  MessageSquare,
  Map as MapIcon,
  Network,
  FileText,
  ShieldCheck,
  Mic,
  Settings,
  Languages,
  AlertTriangle,
  Copy,
  Check,
  Save,
  ClipboardList,
  CornerDownLeft,
  Volume2,
  Pause,
  Play,
} from "lucide-react";
import { type ReactNode, useState, useEffect, useRef } from "react";
import { ThemePicker } from "./ThemePicker";
import { DarkModeToggle } from "./DarkModeToggle";
import { SettingsDialog } from "./SettingsDialog";
import { ProfileMenu } from "./ProfileMenu";
import { useI18n } from "@/lib/i18n";

type VoiceScreen = { to: string; words: RegExp };
const SCREEN_ROUTES: VoiceScreen[] = [
  { to: "/console", words: /(console|chat|assistant|conversation)|ಕನ್ಸೋಲ್|ಸಂಭಾಷಣೆ/i },
  { to: "/map", words: /(map|hotspot|heat ?map|geospatial)|ನಕ್ಷೆ/i },
  { to: "/network", words: /(network|graph|ego|link analysis|connections?)|ನೆಟ್‌ವರ್ಕ್/i },
  { to: "/reports", words: /(report|reports|brief|dossier|pdf)|ವರದಿ/i },
  { to: "/audit", words: /(audit|compliance|chain|logs?)|ಆಡಿಟ್/i },
  { to: "/transcripts", words: /(transcripts?|recordings?)|ಪ್ರತಿಲೇಖನ/i },
];
const NAV_VERB = /(open|show|go to|goto|navigate|take me to|switch to|jump to)|ತೆರೆ|ಹೋಗು|ತೋರಿಸಿ/i;
const KANNADA_INTENT = /(in kannada|kannadadalli|kannada)|ಕನ್ನಡ/i;
const ENGLISH_INTENT = /(in english|english)|ಇಂಗ್ಲಿಷ್/i;

type ParsedVoice = {
  route: string | null;
  navOnly: boolean;
  langOnly: boolean;
  query: string;
  task: string;
  lang: "en" | "kn" | null;
  explicitLang: boolean;
};

function parseVoiceCommand(raw: string): ParsedVoice {
  const text = (raw || "").trim();
  // Auto-detect language: an explicit "in Kannada/English" phrase wins,
  // otherwise detect by script (Kannada Unicode block vs. Latin letters).
  let lang: "en" | "kn" | null = null;
  let explicitLang = false;
  if (KANNADA_INTENT.test(text)) {
    lang = "kn";
    explicitLang = true;
  } else if (ENGLISH_INTENT.test(text)) {
    lang = "en";
    explicitLang = true;
  } else if (/[\u0C80-\u0CFF]/.test(text)) {
    lang = "kn";
  } else if (/[A-Za-z]/.test(text)) {
    lang = "en";
  }

  let route: string | null = null;
  for (const s of SCREEN_ROUTES) {
    if (s.words.test(text)) {
      route = s.to;
      break;
    }
  }

  let residual = text.replace(NAV_VERB, " ");
  for (const s of SCREEN_ROUTES) residual = residual.replace(s.words, " ");
  residual = residual
    .replace(KANNADA_INTENT, " ")
    .replace(ENGLISH_INTENT, " ")
    .replace(/\b(the|to|screen|page|tab|please|view|me|in|on|and|a)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const residualWords = residual.split(" ").filter(Boolean).length;
  const navOnly = route !== null && residualWords < 1;
  const langOnly = route === null && explicitLang && residualWords < 1;
  return { route, navOnly, langOnly, query: text, task: residual, lang, explicitLang };
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [editableTranscript, setEditableTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [voiceLang, setVoiceLang] = useState(() => {
    try {
      const saved = localStorage.getItem("satyam-voice-lang");
      if (saved) return saved;
    } catch {}
    return lang === "KN" ? "kn-IN" : "en-IN";
  });
  const [speechRate, setSpeechRate] = useState(() => {
    try {
      const saved = localStorage.getItem("satyam-voice-rate");
      if (saved) return parseFloat(saved);
    } catch {}
    return lang === "KN" ? 0.9 : 1;
  });
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const open = () => {
      setListening(true);
      setMicActive(true);
      setIsSpeaking(false);
      setIsPaused(false);
    };
    window.addEventListener("satyam:open-voice", open);
    return () => window.removeEventListener("satyam:open-voice", open);
  }, []);

  // Global voice-command handler: parses spoken commands for language
  // ("in Kannada"), screen navigation, and tasks, then routes accordingly and
  // speaks confirmations in the chosen language.
  useEffect(() => {
    const speakText = (text: string, speechLang: string, rate: number) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = speechLang;
        u.rate = rate;
        setIsSpeaking(true);
        window.speechSynthesis.speak(u);
      } catch {}
    };

    const NAV_LABEL: Record<string, string> = {
      "/console": t("Console"),
      "/map": t("Map"),
      "/network": t("Network"),
      "/reports": t("Reports"),
      "/audit": t("Audit"),
      "/transcripts": t("Transcripts"),
    };

    const handle = (detail: { text?: string; lang?: string; rate?: number; speak?: boolean }) => {
      const cmd = parseVoiceCommand(detail?.text || "");
      if (!cmd.query) return;
      const resolved: "en" | "kn" =
        cmd.lang ??
        ((detail.lang || "").toLowerCase().startsWith("kn")
          ? "kn"
          : voiceLang.startsWith("kn")
            ? "kn"
            : lang === "KN"
              ? "kn"
              : "en");
      // Sync the UI + speech-recognition language on an explicit request.
      if (cmd.explicitLang && cmd.lang === "kn") {
        setLang("KN");
        setVoiceLang("kn-IN");
      } else if (cmd.explicitLang && cmd.lang === "en") {
        setLang("EN");
      }
      const speechLang =
        resolved === "kn"
          ? "kn-IN"
          : detail.lang && !detail.lang.toLowerCase().startsWith("kn")
            ? detail.lang
            : "en-IN";
      const rate = detail.rate ?? speechRate;
      const closePanel = () => {
        setListening(false);
        setMicActive(false);
      };

      // 0) Pure language switch ("speak in Kannada").
      if (cmd.langOnly) {
        closePanel();
        if (detail.speak)
          speakText(
            resolved === "kn" ? "ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ" : "Language set to English",
            speechLang,
            rate,
          );
        return;
      }
      // 1) Pure navigation ("open the map").
      if (cmd.route && cmd.navOnly) {
        navigate({ to: cmd.route });
        closePanel();
        if (detail.speak) {
          const label = NAV_LABEL[cmd.route] ?? cmd.route;
          speakText(
            resolved === "kn" ? `${label} ತೆರೆಯಲಾಗುತ್ತಿದೆ` : `Opening ${label}`,
            speechLang,
            rate,
          );
        }
        return;
      }
      // 2) Screen + task (non-console): open it and let the screen run the task.
      if (cmd.route && cmd.route !== "/console") {
        navigate({ to: cmd.route });
        window.dispatchEvent(
          new CustomEvent("satyam:run-task", {
            detail: { route: cmd.route, query: cmd.query, task: cmd.task, lang: resolved, rate, speak: !!detail.speak },
          }),
        );
        closePanel();
        return;
      }
      // 3) Data query -> Console (grounded answer, spoken in chosen language).
      const out = { text: cmd.query, lang: speechLang, rate, speak: detail.speak !== false };
      if (pathname === "/console") {
        window.dispatchEvent(new CustomEvent("satyam:voice-send", { detail: out }));
      } else {
        try {
          sessionStorage.setItem("satyam:pending-voice", JSON.stringify(out));
        } catch {}
        navigate({ to: "/console" });
      }
      closePanel();
    };

    const onCmd = (e: Event) => handle((e as CustomEvent).detail || {});
    window.addEventListener("satyam:voice-command", onCmd);
    return () => window.removeEventListener("satyam:voice-command", onCmd);
  }, [pathname, lang, voiceLang, speechRate, navigate, setLang, t]);

  useEffect(() => {
    try { localStorage.setItem("satyam-voice-lang", voiceLang); } catch {}
  }, [voiceLang]);

  useEffect(() => {
    try { localStorage.setItem("satyam-voice-rate", String(speechRate)); } catch {}
  }, [speechRate]);

  useEffect(() => {
    if (!listening || !micActive) return;
    setFinalTranscript("");
    setInterimTranscript("");
    setEditableTranscript("");
    setSpeechError(null);
    setSaved(false);

    const SR: any =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setSpeechError("Speech recognition is not supported in this browser.");
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang === "KN" ? "kn-IN" : "en-IN";
    rec.onresult = (e: any) => {
      let interim = "";
      let finals = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (finals) {
        setFinalTranscript((prev) => (prev ? prev + " " : "") + finals.trim());
        setEditableTranscript((prev) => (prev ? prev + " " : "") + finals.trim());
      }
      setInterimTranscript(interim);
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setSpeechError("Microphone permission denied.");
      } else if (e.error === "no-speech") {
        // ignore
      } else {
        setSpeechError(`Mic error: ${e.error}`);
      }
    };
    rec.onend = () => {
      // auto-restart while popup still open
      if (recognitionRef.current === rec) {
        try { rec.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch {}

    return () => {
      recognitionRef.current = null;
      try { rec.onend = null; rec.stop(); } catch {}
    };
  }, [listening, micActive, lang]);

  useEffect(() => {
    if (!isSpeaking) return;
    const id = setInterval(() => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          setIsSpeaking(false);
          setIsPaused(false);
        }
      }
    }, 300);
    return () => clearInterval(id);
  }, [isSpeaking]);

  const NAV = [
    { to: "/console", icon: MessageSquare, label: t("Console") },
    { to: "/map", icon: MapIcon, label: t("Map") },
    { to: "/network", icon: Network, label: t("Network") },
    { to: "/reports", icon: FileText, label: t("Reports") },
    { to: "/audit", icon: ShieldCheck, label: t("Audit") },
    { to: "/transcripts", icon: ClipboardList, label: t("Transcripts") },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Synthetic data banner */}
      <div className="flex items-center justify-center gap-2 border-b-2 border-foreground bg-warning px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-warning-foreground">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t("Synthetic / demo data — not real case records")}
      </div>

      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b-2 border-foreground bg-header px-5 text-header-foreground">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground text-[11px] font-extrabold nb-shadow-sm">
            SY
          </div>
          <div className="text-sm font-semibold tracking-wide">Satyam</div>
          <span className="mx-1 h-6 w-px bg-header-foreground/20" />
          <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>


        <div className="flex items-center gap-1.5">
          <ThemePicker />
          <DarkModeToggle />
          <button
            onClick={() => setLang(lang === "EN" ? "KN" : "EN")}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-secondary-background px-2.5 py-1.5 text-xs font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
          >
            <Languages className="h-3.5 w-3.5" />
            <span className={lang === "EN" ? "text-foreground" : "opacity-40"}>EN</span>
            <span className="opacity-30">|</span>
            <span className={`font-kn ${lang === "KN" ? "text-foreground" : "opacity-40"}`}>
              ಕನ್ನಡ
            </span>
          </button>
          <button onClick={() => setListening(true)} className="rounded-[5px] border-2 border-header-foreground bg-secondary-background p-2 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition" aria-label={t("Voice")}>
            <Mic className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-[5px] border-2 border-header-foreground bg-secondary-background p-2 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            aria-label={t("Settings")}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {listening && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setListening(false);
            setMicActive(false);
            setIsSpeaking(false);
            setIsPaused(false);
            if (typeof window !== "undefined" && "speechSynthesis" in window) {
              window.speechSynthesis.cancel();
            }
          }}
        >
          <div
            className="relative flex w-[min(540px,92vw)] flex-col items-center gap-5 rounded-[10px] border-2 border-foreground bg-card px-8 py-7 text-foreground nb-shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative grid h-20 w-20 place-items-center">
              {!isSpeaking ? (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
                  <span className="absolute inset-2 animate-pulse rounded-full bg-primary/60" />
                  <div className="relative grid h-16 w-16 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground">
                    <Mic className="h-7 w-7" />
                  </div>
                </>
              ) : (
                <>
                  <span className="absolute inset-0 animate-pulse rounded-full bg-primary/30" />
                  <div className="relative grid h-16 w-16 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground">
                    <Volume2 className="h-7 w-7" />
                  </div>
                </>
              )}
            </div>
            <div className="text-center">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {isSpeaking ? `${t("Speech output")} · ${voiceLang}` : `${t("Voice input")} · ${lang === "KN" ? "kn-IN" : "en-IN"}`}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {isSpeaking ? t("Speaking…") : t("Listening…")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {isSpeaking ? t("Tap Pause to pause, Stop to end.") : t("Speak now. Tap anywhere to stop.")}
              </div>
            </div>

            <div className="w-full flex flex-col gap-2">
              <div className="w-full flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t("Speech output")}</span>
                <select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(e.target.value)}
                  className="flex-1 rounded-[5px] border-2 border-foreground bg-background px-2 py-1 text-xs text-foreground outline-none"
                >
                  <option value="en-IN">English (India)</option>
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="kn-IN">Kannada (ಕನ್ನಡ)</option>
                  <option value="hi-IN">Hindi (हिन्दी)</option>
                  <option value="ta-IN">Tamil (தமಿ಴்)</option>
                  <option value="te-IN">Telugu (తెలుగు)</option>
                  <option value="ml-IN">Malayalam (മലയാളം)</option>
                </select>
              </div>
              <div className="w-full flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t("Rate")}</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="flex-1 h-2 accent-primary cursor-pointer"
                />
                <span className="text-[11px] font-bold text-muted-foreground w-8 text-right">{speechRate.toFixed(1)}×</span>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2">
              <div className="relative w-full rounded-[6px] border-2 border-foreground bg-background">
                <textarea
                  value={editableTranscript + (interimTranscript ? (editableTranscript ? " " : "") + interimTranscript : "")}
                  onChange={(e) => {
                    const val = e.target.value;
                    // If user deletes into interim portion, just accept the edit
                    setEditableTranscript(val);
                    // Update finalTranscript so future speech appends correctly
                    setFinalTranscript(val);
                    setInterimTranscript("");
                  }}
                  className="w-full min-h-[88px] max-h-48 overflow-y-auto bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground resize-none outline-none"
                  placeholder={t("Waiting for speech…")}
                />
                {interimTranscript && !editableTranscript.endsWith(interimTranscript) && (
                  <span className="pointer-events-none absolute bottom-3 left-4 text-sm text-muted-foreground leading-relaxed">
                    {editableTranscript ? " " : ""}{interimTranscript}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {isSpeaking ? (
                  <>
                    <span className="text-xs text-muted-foreground">{t("Speaking…")}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (typeof window !== "undefined" && "speechSynthesis" in window) {
                            if (isPaused) {
                              window.speechSynthesis.resume();
                              setIsPaused(false);
                            } else {
                              window.speechSynthesis.pause();
                              setIsPaused(true);
                            }
                          }
                        }}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
                      >
                        {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        {isPaused ? t("Resume") : t("Pause")}
                      </button>
                      <button
                        onClick={() => {
                          if (typeof window !== "undefined" && "speechSynthesis" in window) {
                            window.speechSynthesis.cancel();
                          }
                          setIsSpeaking(false);
                          setIsPaused(false);
                          setMicActive(true);
                        }}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-destructive px-2.5 py-1 text-[11px] font-bold text-destructive-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
                      >
                        <Volume2 className="h-3 w-3" />
                        {t("Stop speech")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {speechError ? (
                      <span className="text-xs text-destructive">{speechError}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {interimTranscript ? t("Listening…") : t("Tap textarea to edit")}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(editableTranscript);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          } catch {}
                        }}
                        disabled={!editableTranscript}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? t("Copied") : t("Copy")}
                      </button>
                      <button
                        onClick={() => {
                          if (!editableTranscript.trim()) return;
                          window.dispatchEvent(new CustomEvent("satyam:insert-transcript", { detail: editableTranscript.trim() }));
                          setListening(false);
                        }}
                        disabled={!editableTranscript.trim()}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <CornerDownLeft className="h-3 w-3" />
                        {t("Send to chat")}
                      </button>
                      <button
                        onClick={() => {
                          const text = editableTranscript.trim();
                          if (!text) return;
                          window.dispatchEvent(
                            new CustomEvent("satyam:voice-command", {
                              detail: { text, lang: voiceLang, rate: speechRate, speak: true },
                            })
                          );
                          setIsPaused(false);
                        }}
                        disabled={!editableTranscript.trim()}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Volume2 className="h-3 w-3" />
                        {t("Speak reply")}
                      </button>
                      <button
                        onClick={() => {
                          if (!editableTranscript.trim()) return;
                          const list = JSON.parse(localStorage.getItem("satyam-transcripts") || "[]");
                          list.unshift({
                            id: crypto.randomUUID(),
                            text: editableTranscript.trim(),
                            lang: lang === "KN" ? "kn-IN" : "en-IN",
                            createdAt: new Date().toISOString(),
                          });
                          localStorage.setItem("satyam-transcripts", JSON.stringify(list));
                          setSaved(true);
                          setTimeout(() => setSaved(false), 1500);
                        }}
                        disabled={!editableTranscript.trim()}
                        className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
                        {saved ? t("Saved") : t("Save")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setListening(false);
                setMicActive(false);
                setIsSpeaking(false);
                setIsPaused(false);
                if (typeof window !== "undefined" && "speechSynthesis" in window) {
                  window.speechSynthesis.cancel();
                }
              }}
              className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-1.5 text-xs font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            >
              {t("Close")}
            </button>
          </div>
        </div>
      )}


      {/* Body: rail + content */}
      <div className="flex flex-1 min-h-0">
        <nav className="flex w-16 flex-col items-center gap-2 border-r-2 border-foreground bg-rail py-4 text-rail-foreground">
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className={`group relative flex h-11 w-11 items-center justify-center rounded-[5px] border-2 transition ${
                  active
                    ? "border-foreground bg-primary text-primary-foreground nb-shadow-sm"
                    : "border-transparent text-rail-foreground/70 hover:border-rail-foreground hover:bg-rail-foreground/10 hover:text-rail-foreground"
                }`}
                title={label}
              >
                <Icon className="h-5 w-5" />
                <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1 text-[11px] font-bold text-foreground nb-shadow-sm opacity-0 transition group-hover:opacity-100 z-50">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
