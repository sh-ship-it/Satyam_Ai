import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  MessageSquare,
  Network,
  FileText,
  ShieldCheck,
  Mic,
  Settings,
  Languages,
  Copy,
  Check,
  Save,
  ClipboardList,
  CornerDownLeft,
  Volume2,
  Pause,
  Play,
  Radar,
  Truck,
  Tv,
  FileLock2,
  Video,
  Fingerprint,
  Workflow,
  Globe2,
  Camera,
  CameraOff,
  Sparkles,
  LayoutDashboard,
  BarChart3,
  ChevronRight,
  Siren,
} from "lucide-react";
import { type ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { ThemePicker } from "./ThemePicker";
import { DarkModeToggle } from "./DarkModeToggle";
import { SettingsDialog, loadEngineSettings } from "./SettingsDialog";
import { ProfileMenu } from "./ProfileMenu";
import { HandsFreeLayer } from "./HandsFreeLayer";
import { VoiceOrb, type OrbState } from "./VoiceOrb";
import { loadHandsFree, saveHandsFree } from "@/config/handsFreeConfig";
import { useI18n } from "@/lib/i18n";
import {
  speakViaSarvam,
  cancelSpeech,
  isSpeechActive,
  pauseSpeech,
  resumeSpeech,
  unlockAudioPlayback,
  stripMarkdown,
} from "@/lib/voice/tts";
import { resolveLang } from "@/lib/voice/lang";
import { startSttSession, isBackendSttSupported } from "@/lib/voice/recorder";
import { SESSION_EXPIRED_EVENT, streamChat, type ChatEvent } from "@/lib/api/client";
import { planVoiceAction, type AgentPlan } from "@/lib/api/voiceAgent";
import { SCREEN_READY_EVENT, TASK_RESULT_EVENT, type TaskResult } from "@/lib/taskBus";
import { RAIL_OPEN_KEY, RAIL_WIDTH_OPEN_PX, RAIL_WIDTH_PX, railDockCss } from "@/lib/railDock";

// The voice copilot (top-right) uses ONE engine for BOTH listening and speaking.
// When its mic engine is "browser", replies use the device's built-in Web-Speech
// voice; when "sarvam", replies use the server voice provider. This overrides the
// global Settings → "Voice (Text-to-Speech)" choice (which still governs the
// chat-box / console read-aloud).
function copilotVoiceProvider(): "sarvam" | "google" | "webspeech" {
  const eng = loadEngineSettings();
  if (eng.copilotStt === "browser") return "webspeech";
  return eng.voiceBackend === "webspeech" ? "sarvam" : eng.voiceBackend;
}

type VoiceScreen = { to: string; words: RegExp };
const SCREEN_ROUTES: VoiceScreen[] = [
  // MUST stay above the generic /console "map" entry below: parseVoiceCommand
  // takes the FIRST match, and "vision map" / "tactical map" both contain "map",
  // so a later position would silently route every Vision command to Console.
  {
    to: "/vision",
    words: /(vision|tactical map|tactical view|earth view|globe view|3d map)|ವಿಷನ್|ತಂತ್ರಾತ್ಮಕ/i,
  },
  // The dedicated chat screen owns the conversational words; /console keeps only
  // its own name plus the map words below, since its dashboard is built on a map.
  { to: "/ask", words: /(ask satyam|ai chat|chat|assistant|conversation)|ಚಾಟ್|ಸಂಭಾಷಣೆ/i },
  {
    to: "/console",
    words: /(console|dashboard|overview|crime intelligence|kpi|clearance)|ಕನ್ಸೋಲ್|ಡ್ಯಾಶ್‌ಬೋರ್ಡ್/i,
  },
  // MUST stay above the /console "map" entry below, so "hotspot forecast" reaches
  // Forecast instead of Console. Deliberately does NOT claim bare "hotspot"
  // (Console owns the map) or bare "predict" (/ops-predictive owns Predictive
  // Deployment, and it sits further down this list so a claim here would steal
  // every "predictive" command). Trends and Patterns words live here because
  // /trends was folded into this screen.
  {
    to: "/forecast",
    words:
      /(forecast|early warning|risk grid|trends?|patterns?|seasonal|mo cluster|modus|time series)|ಮುನ್ಸೂಚನೆ|ಎಚ್ಚರಿಕೆ|ಪ್ರವೃತ್ತಿ|ಮಾದರಿ/i,
  },
  { to: "/console", words: /(map|hotspot|heat ?map|geospatial)|ನಕ್ಷೆ/i },
  // MUST stay above /network, which claims the singular word "graph" for link
  // analysis. Only the plural "graphs" and "charts" are claimed here, plus the
  // explicit "graph/chart screen", so "show me the network graph" still falls
  // through to /network and /board keeps "link chart". Do not loosen `charts\b`
  // to `charts?\b` — the singular would swallow /board's "link chart".
  {
    to: "/graphs",
    words:
      /(graphs\b|charts\b|chart screen|graph screen|graph view|visuali[sz]ations?)|ಗ್ರಾಫ್|ಚಾರ್ಟ್/i,
  },
  { to: "/network", words: /(network|graph|ego|link analysis|connections?)|ನೆಟ್‌ವರ್ಕ್/i },
  // MUST stay above /reports, which claims "report": "news report" would
  // otherwise open the Report Builder instead of the news channels.
  {
    to: "/news",
    words:
      /(news feed|news channels?|news|live tv|tv channels?|watch tv|broadcast)|ಸುದ್ದಿ|ವಾರ್ತೆ|ಟಿವಿ|ಚಾನೆಲ್/i,
  },
  // MUST stay above /reports, which claims bare "pdf" and "document"-adjacent
  // words: "translate this document" and "encrypt the pdf" belong here, not in the
  // Report Builder. Deliberately does NOT claim bare "translate" — that is a
  // language instruction the voice layer handles for any screen.
  {
    to: "/documents",
    words:
      /(document translation|translate (?:the |this )?(?:document|file|pdf)|document screen|seal (?:the |this )?(?:document|file|pdf)|encrypt)|ದಾಖಲೆ ಅನುವಾದ|ದಾಖಲೆ/i,
  },
  { to: "/reports", words: /(report|reports|brief|dossier|pdf)|ವರದಿ/i },
  { to: "/audit", words: /(audit|compliance|chain|logs?)|ಆಡಿಟ್/i },
  { to: "/transcripts", words: /(transcripts?|recordings?)|ಪ್ರತಿಲೇಖನ/i },
  { to: "/ops-predictive", words: /(predictive|deployment|predict)|ಭವಿಷ್ಯಸೂಚಕ/i },
  { to: "/ops-dispatch", words: /(dispatch|green corridor|corridor)|ಕಾರ್ ತಳ/i },
  { to: "/ops-camera", words: /(camera|cctv|review|yolo)|ಕ್ಯಾಮೆರಾ/i },
  { to: "/dossier", words: /(dossier|person 360|360|fingerprint|admin dossier)/i },
  { to: "/admin", words: /(access control|admin|user policy|clearance control)/i },
  { to: "/board", words: /(board|canvas|whiteboard|link chart|crime board|ಬೋರ್ಡ್)/i },
];
const NAV_VERB = /(open|show|go to|goto|navigate|take me to|switch to|jump to)|ತೆರೆ|ಹೋಗು|ತೋರಿಸಿ/i;
// Person-crime question: "what crime did X commit" / "crime rate of X" / Kannada equivalents.
const PERSON_CRIME_INTENT =
  /(crime rate|what crime|which crime|crimes?|offences?|offenses?|record of|history of)|ಅಪರಾಧ|ಕ್ರಿಮಿನಲ್|ಅಪರಾಧಗಳು/i;
// Follow-up affirmatives + the two suggested actions.
const AFFIRM = /\b(yes|yeah|yep|sure|ok|okay|please do|go ahead|details)\b|ಹೌದು|ಸರಿ|ವಿವರ|ಮಾಡಿ/i;
const MAP_ACTION = /(map|location|place|where|pin|on the map)|ನಕ್ಷೆ|ಸ್ಥಳ|ಎಲ್ಲಿ/i;
const NETWORK_ACTION = /(network|graph|connections?|links?)|ನೆಟ್‌ವರ್ಕ್|ಸಂಪರ್ಕ/i;
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

  /**
   * Rail tooltip, positioned in VIEWPORT coordinates rather than rendered inside
   * the link.
   *
   * It has to work this way now: the rail became `overflow-y-auto` to stop it
   * forcing page height, and per spec an element with one axis scrollable computes
   * the other axis to `auto` too — so `overflow-x` is no longer `visible` and the
   * old `absolute left-full` label was clipped at the rail's 64px edge. A `fixed`
   * element escapes ancestor overflow (nothing here establishes a containing block
   * for it), so the label can sit beside the rail again.
   */
  const [railTip, setRailTip] = useState<{ label: string; top: number } | null>(null);

  /**
   * Rail expanded or collapsed to icons.
   *
   * Read from localStorage in the initialiser rather than in an effect, so the
   * rail renders at its remembered width on the first paint instead of flashing
   * open and snapping shut. Guarded for SSR because TanStack Start renders this on
   * the server, where `localStorage` does not exist.
   */
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RAIL_OPEN_KEY) === "1";
  });

  const toggleRail = useCallback(() => {
    setRailOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* private mode / quota — the rail still toggles for this session */
      }
      // Labels replace the tooltip once the rail is open, so a tooltip left
      // hanging beside a visible label would show the name twice.
      setRailTip(null);
      return next;
    });
  }, []);

  // Cmd/Ctrl+B, the shortcut the reference component uses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRail]);

  // Detect admin/L4 once from the stored JWT so the Person 360 nav shows only for admins.
  const [isAdmin, setIsAdmin] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("satyam.token") : null;
      if (!tok) return;
      const payload = JSON.parse(atob(tok.split(".")[1]));
      const cl = Number(payload.clearance ?? 0);
      const rank = String(payload.rank ?? payload.role ?? "");
      setIsAdmin(cl >= 4 || ["admin", "DGP", "ADGP", "IGP", "SP"].includes(rank));
    } catch {
      /* ignore */
    }
  }, []);
  const [listening, setListening] = useState(false);
  const [micActive, setMicActive] = useState(false);

  // Hands-free master switch mirrored for the header camera toggle. Stays in
  // sync with the Settings → Hands-free tab via the "satyam:handsfree-settings"
  // broadcast that saveHandsFree() dispatches.
  const [handsFreeOn, setHandsFreeOn] = useState<boolean>(() => {
    try {
      return loadHandsFree().enabled;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const onHF = () => setHandsFreeOn(loadHandsFree().enabled);
    window.addEventListener("satyam:handsfree-settings", onHF);
    return () => window.removeEventListener("satyam:handsfree-settings", onHF);
  }, []);

  // An expired token used to leave the officer inside the app with every panel
  // quietly failing — chat blaming the backend, Settings showing three "No key"
  // badges. The client clears the dead token and fires this; the only useful
  // response is to send them to sign in again.
  useEffect(() => {
    const onExpired = () => navigate({ to: "/login" });
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate]);
  // Announce when the voice panel closes so the hands-free wake word can resume
  // listening (it is paused while the copilot mic is open to avoid two Web-Speech
  // recognizers fighting over the audio device).
  useEffect(() => {
    if (!listening) window.dispatchEvent(new CustomEvent("satyam:voice-closed"));
  }, [listening]);
  const toggleHandsFree = useCallback(() => {
    const cur = loadHandsFree();
    const next = cur.enabled
      ? { ...cur, enabled: false }
      : // Turning hands-free ON from the header enables the full experience —
        // gestures + wake word — so "Satyam" works immediately without diving
        // into Settings. Granular off-switches still live in Settings → Hands-free.
        { ...cur, enabled: true, gestures: true, wakeWord: true };
    saveHandsFree(next);
    setHandsFreeOn(next.enabled);
  }, []);
  // ── Floating voice orb ────────────────────────────────────────────────────
  // `orbMode` means "this capture was started by the floating orb", which changes
  // two things: the full-screen copilot overlay stays closed (the orb is the whole
  // UI for the turn), and the utterance does NOT auto-submit on silence — the
  // officer taps the orb again to send. Both differences are deliberate; the
  // top-bar mic keeps its existing overlay + auto-submit behaviour untouched.
  const [orbMode, setOrbMode] = useState(false);
  const orbModeRef = useRef(false);
  const orbCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    orbModeRef.current = orbMode;
  }, [orbMode]);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [editableTranscript, setEditableTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  // Supported voice locales: "auto" = detect from text, plus the two explicit locales.
  const VOICE_LANGS = ["auto", "en-IN", "kn-IN"] as const;
  const coerceVoiceLang = (v: string | null | undefined): string => {
    if (v === "auto") return "auto";
    if (v && (["en-IN", "kn-IN"] as string[]).includes(v)) return v;
    if (v && v.toLowerCase().startsWith("kn")) return "kn-IN";
    if (v && v.toLowerCase().startsWith("en")) return "en-IN";
    return "auto"; // default to auto-detect
  };
  const [voiceLang, setVoiceLang] = useState<string>(() => {
    try {
      return coerceVoiceLang(localStorage.getItem("satyam-voice-lang"));
    } catch {}
    return "auto";
  });
  const [speechRate, setSpeechRate] = useState(() => {
    try {
      const saved = localStorage.getItem("satyam-voice-rate");
      if (saved) return parseFloat(saved);
    } catch {}
    return lang === "KN" ? 0.9 : 1;
  });
  const recognitionRef = useRef<any>(null);
  const sttSessionRef = useRef<{ stop: () => void; cancel: () => void } | null>(null);

  const [conversationMode, setConversationMode] = useState(false);

  // —— turn-taking machine ——
  const phaseRef = useRef<"listening" | "processing" | "speaking">("listening");
  const conversationModeRef = useRef(false);
  const lastPersonRef = useRef<string>("");
  // Conversation id for the TOP-RIGHT COPILOT's own grounded answers. Kept
  // separate from the Console chat thread so the copilot never posts into chat.
  const copilotConvId = useRef<string | null>(null);
  const listeningRef = useRef(false);
  const voiceLangRef = useRef(voiceLang);
  const speechRateRef = useRef(speechRate);
  const liveFinalRef = useRef(""); // finalized speech this turn
  const liveInterimRef = useRef(""); // latest interim words
  const turnSubmittedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);
  useEffect(() => {
    voiceLangRef.current = voiceLang;
  }, [voiceLang]);
  useEffect(() => {
    speechRateRef.current = speechRate;
  }, [speechRate]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);
  const clearThinkWatchdog = useCallback(() => {
    if (thinkWatchdogRef.current) {
      clearTimeout(thinkWatchdogRef.current);
      thinkWatchdogRef.current = null;
    }
  }, []);

  // Re-open the mic for the user's next turn. Idempotent and self-gating.
  const resumeListening = useCallback(() => {
    clearThinkWatchdog();
    if (!conversationModeRef.current || !listeningRef.current) return;
    phaseRef.current = "listening";
    setIsSpeaking(false);
    setIsPaused(false);
    setMicActive(true); // re-runs the recognition effect (fresh transcript)
  }, [clearThinkWatchdog]);

  // Stop fully (Close / Conversation OFF).
  const stopConversation = useCallback(() => {
    clearSilenceTimer();
    clearThinkWatchdog();
    phaseRef.current = "listening";
    cancelSpeech(); // stops the Sarvam/Google clip AND the browser fallback
  }, [clearSilenceTimer, clearThinkWatchdog]);

  useEffect(() => {
    const open = () => {
      unlockAudioPlayback(); // V3: enable fetched-audio playback within the gesture
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
      // TASK 2A: resolve "auto" to detectLang(text); otherwise parse the BCP-47 locale.
      const lang: "en" | "kn" = resolveLang(speechLang, text);
      void speakViaSarvam(
        text,
        lang,
        rate,
        {
          onStart: () => setIsSpeaking(true),
          onEnd: () => setIsSpeaking(false),
        },
        copilotVoiceProvider(),
      );
    };

    const NAV_LABEL: Record<string, string> = {
      "/ask": t("Ask Satyam"),
      "/console": t("Dashboard"),
      "/map": t("Map"),
      "/vision": t("Vision"),
      "/network": t("Network"),
      "/reports": t("Reports"),
      "/audit": t("Audit"),
      "/transcripts": t("Transcripts"),
      "/news": t("News Feed"),
      "/documents": t("Documents"),
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
      const speechLang = resolved === "kn" ? "kn-IN" : "en-IN";
      const rate = detail.rate ?? speechRate;
      const closePanel = () => {
        if (conversationModeRef.current) {
          setMicActive(false);
          return;
        }
        setListening(false);
        setMicActive(false);
      };

      // The TOP-RIGHT COPILOT answers data questions ITSELF and speaks the reply
      // back, like two people talking. It calls the same grounded /chat/stream
      // API the Console uses, but NEVER forwards the turn to the Console chat
      // thread (that is exclusively the chat-box mic's job). The spoken reply
      // drives the existing satyam:ai-state state machine (thinking -> speaking
      // -> done) so the orb animates and conversation mode keeps listening.
      const answerInCopilot = (question: string, followUp?: string) => {
        const aiState = (state: "thinking" | "speaking" | "done") =>
          window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state } }));
        aiState("thinking"); // orb shows "Thinking…" + arms the recovery watchdog
        const engines = loadEngineSettings();
        let acc = "";
        // The backend emits a separate `speak` event carrying a short, TTS-shaped
        // version of the answer (from the [SPEAK]…[/SPEAK] block). /ask already
        // uses it; the copilot was ignoring it and reading the full display text
        // aloud instead — tables, citation refs and markdown included.
        let spoken = "";
        let streamError = false;
        // A dead session is not an unreachable backend, and the copilot SPEAKS
        // this text — telling an officer the server is down when their token
        // simply expired is the least actionable thing it could say.
        let sessionExpired = false;
        const finish = () => {
          // Prefer the spoken variant, but only when there is display text to
          // pair it with; a bare `speak` with no tokens means the turn broke.
          let answer = (spoken.trim() && acc.trim() ? spoken : acc).trim();
          if (sessionExpired) answer = t("Your session has expired. Please sign in again.");
          else if (streamError)
            answer = t(
              "I couldn't reach the backend just now. Please retry once the API is running.",
            );
          else if (!answer)
            answer = t(
              "No results matched your query. Try a broader question or different filters.",
            );
          // For a person-crime turn we append the spoken follow-up offer so it is
          // one continuous utterance (no mid-answer mic re-arm race).
          const toSpeak = followUp && !streamError ? `${answer}. ${followUp}` : answer;
          if (detail.speak === false) {
            aiState("done");
            return;
          }
          const spokenLang: "en" | "kn" = resolveLang(speechLang, toSpeak);
          void speakViaSarvam(
            stripMarkdown(toSpeak),
            spokenLang,
            rate,
            {
              onStart: () => aiState("speaking"),
              onEnd: () => aiState("done"),
            },
            copilotVoiceProvider(),
          );
        };
        void streamChat(
          {
            message: question,
            conversation_id: copilotConvId.current ?? undefined,
            lang: resolved, // "en" | "kn"
            brain_engine: engines.brainEngine,
            sql_engine: engines.sqlEngine,
            voice_backend: engines.voiceBackend === "webspeech" ? undefined : engines.voiceBackend,
          },
          (ev: ChatEvent) => {
            if (ev.type === "token") acc += ev.text;
            else if (ev.type === "speak") spoken = ev.text ?? "";
            else if (ev.type === "blocked") {
              acc = t(
                "Your role can't view named accused records. Showing aggregate counts instead.",
              );
              // A blocked turn REPLACES the answer, so a speak variant captured
              // before the block would read out the masked content anyway.
              spoken = "";
            } else if (ev.type === "done") copilotConvId.current = ev.conversation_id;
            else if (ev.type === "error") streamError = true;
          },
        )
          .then(finish)
          .catch((err: unknown) => {
            if ((err as { status?: number })?.status === 401) sessionExpired = true;
            else streamError = true;
            finish();
          });
      };

      // ── Voice Screen Agent executor ──────────────────────────────────────
      // Calls the backend brain (/voice/agent), navigates to the chosen screen,
      // and dispatches the structured action plan via satyam:run-task. Screens
      // execute only allow-listed actions. Falls back to answerInCopilot when
      // the agent decides it's a pure data question.
      const runScreenAgent = (
        question: string,
        resolvedLang: "en" | "kn",
        speechRate: number,
        speak: boolean,
        spokenLocale: string,
      ) => {
        const engines = loadEngineSettings();
        // Re-arming the mic is owned by the confirmation, not by a timer at the
        // call site. The confirmation now waits for the screen's ack, so a blind
        // 1200 ms re-arm could open the mic mid-synthesis and feed the
        // assistant's own voice straight back into recognition.
        const rearm = () => {
          if (conversationModeRef.current) resumeListening();
        };
        const sayConfirm = (text: string) => {
          if (!speak || !text) {
            rearm();
            return;
          }
          const sl: "en" | "kn" = resolveLang(spokenLocale, text);
          void speakViaSarvam(
            stripMarkdown(text),
            sl,
            speechRate,
            {
              onStart: () => setIsSpeaking(true),
              onEnd: () => {
                setIsSpeaking(false);
                rearm();
              },
            },
            copilotVoiceProvider(),
          );
        };
        void planVoiceAction({
          command: question,
          current_route: pathname,
          lang: resolvedLang,
          brain_engine: engines.brainEngine,
          planner: engines.copilotPlanner,
        })
          .then((planRes: AgentPlan) => {
            // The TOP-RIGHT COPILOT answers data/conversational questions ITSELF
            // and speaks the reply — it must NEVER post a turn into the Console
            // chat thread (the chat box has its own mic for that). So strip any
            // console "ask" actions from the plan; if nothing actionable is left,
            // the copilot answers out loud instead of routing to chat.
            const actions = (planRes.actions || []).filter(
              (a) => !(a.screen === "/console" && a.action === "ask"),
            );
            const strippedConsoleAsk = (planRes.actions || []).length > 0 && actions.length === 0;

            // Pure data question, or the plan was only a console "ask", or it
            // targets the Console with nothing left to automate → answer in the
            // copilot (voice only), never in the chat.
            if (
              planRes.answer ||
              strippedConsoleAsk ||
              (planRes.route === "/console" && actions.length === 0) ||
              (!planRes.route && actions.length === 0)
            ) {
              answerInCopilot(question);
              return;
            }
            // Speak the RESULT, not the plan. `planRes.speak` is the model's
            // claim about what it is going to do; the screen's handler is the only
            // thing that knows whether the action name existed and the parameter
            // survived validation. Confirming before the ack meant an unhandled
            // action or an out-of-range value was reported as success.
            let confirmed = false;
            const onResult = (e: Event) => {
              const r = (e as CustomEvent<TaskResult>).detail;
              // Route-matched so a gesture-driven run-task firing in the same
              // window cannot be mistaken for this plan's result.
              if (!r || confirmed || r.route !== planRes.route) return;
              confirmed = true;
              window.removeEventListener(TASK_RESULT_EVENT, onResult);
              if (r.applied.length === 0) sayConfirm(t("I couldn't do that on this screen."));
              else if (r.skipped.length > 0)
                sayConfirm(`${planRes.speak} ${t("Some steps didn't apply.")}`.trim());
              else sayConfirm(planRes.speak);
            };
            window.addEventListener(TASK_RESULT_EVENT, onResult);
            // A screen that never reports (older listener, or the event landed
            // between unmount and mount) must not leave the officer in silence.
            setTimeout(() => {
              if (confirmed) return;
              confirmed = true;
              window.removeEventListener(TASK_RESULT_EVENT, onResult);
              sayConfirm(t("I couldn't do that on this screen."));
            }, 3000);

            const dispatchActions = () => {
              window.dispatchEvent(
                new CustomEvent("satyam:run-task", {
                  detail: {
                    route: planRes.route,
                    actions,
                    query: question,
                    task: question,
                    lang: resolvedLang,
                    rate: speechRate,
                    speak,
                  },
                }),
              );
            };
            if (planRes.route && planRes.route !== pathname) {
              navigate({ to: planRes.route });
              // Dispatch on the destination screen's own ack. The 550 ms timer is
              // kept as a ceiling so a screen that does not announce still gets
              // its actions exactly as before — but in the normal case the mount
              // effect fires within a frame or two, so the plan no longer races
              // a fixed guess about how long navigation takes.
              const target = planRes.route;
              let sent = false;
              const go = () => {
                if (sent) return;
                sent = true;
                window.removeEventListener(SCREEN_READY_EVENT, onReady);
                dispatchActions();
              };
              const onReady = (e: Event) => {
                if ((e as CustomEvent<{ route?: string }>).detail?.route === target) go();
              };
              window.addEventListener(SCREEN_READY_EVENT, onReady);
              setTimeout(go, 550);
            } else {
              dispatchActions();
            }
          })
          .catch(() => {
            // Backend agent unreachable → fall back to answering the question.
            answerInCopilot(question);
          });
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
      // Both chat surfaces answer in-place, so they skip the screen agent and
      // fall through to the follow-up / data-question handling below.
      if (cmd.route && cmd.route !== "/console" && cmd.route !== "/ask") {
        // Hand off to the Voice Screen Agent (backend brain): it decides the
        // exact screen + the in-screen actions to automate, then we navigate
        // and dispatch the structured action plan to that screen.
        runScreenAgent(cmd.query, resolved, rate, !!detail.speak, speechLang);
        closePanel();
        // No blind re-arm here: runScreenAgent re-arms from the spoken
        // confirmation's onEnd, which is the only point at which the audio is
        // actually finished. Its own 3 s ack timeout guarantees the confirmation
        // fires, so the mic cannot be left closed.
        return;
      }
      // 2.5) Follow-up actions after a person-crime answer ("yes / on the map / in the network").
      if (
        lastPersonRef.current &&
        (AFFIRM.test(cmd.query) || MAP_ACTION.test(cmd.query) || NETWORK_ACTION.test(cmd.query))
      ) {
        const who = lastPersonRef.current;
        if (MAP_ACTION.test(cmd.query)) {
          navigate({ to: "/console" });
          window.dispatchEvent(new CustomEvent("satyam:map-focus", { detail: { person: who } }));
          if (detail.speak)
            speakText(
              resolved === "kn"
                ? `${who} ಅವರ ಅಪರಾಧ ಸ್ಥಳವನ್ನು ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ`
                : `Showing ${who}'s crime location on the map`,
              speechLang,
              rate,
            );
        } else {
          // default / "network" / bare "yes" -> open the Network graph for this person
          navigate({ to: "/network" });
          window.dispatchEvent(
            new CustomEvent("satyam:run-task", {
              detail: {
                route: "/network",
                query: who,
                task: who,
                lang: resolved,
                rate,
                speak: !!detail.speak,
              },
            }),
          );
          if (detail.speak)
            speakText(
              resolved === "kn"
                ? `${who} ಅವರ ನೆಟ್‌ವರ್ಕ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ`
                : `Opening ${who}'s network`,
              speechLang,
              rate,
            );
        }
        lastPersonRef.current = "";
        if (conversationModeRef.current) setTimeout(() => resumeListening(), 700);
        closePanel();
        return;
      }

      // 2.6) Person-crime question -> the COPILOT answers out loud ITSELF, then
      // offers the next step in the SAME spoken reply. Nothing is posted to chat.
      if (PERSON_CRIME_INTENT.test(cmd.query)) {
        // Best-effort name extraction: strip the intent words and common fillers.
        const who = cmd.query
          .replace(PERSON_CRIME_INTENT, " ")
          .replace(
            /\b(did|does|do|commit|committed|of|the|by|for|show|me|what|which|is|are|his|her|their|tell)\b/gi,
            " ",
          )
          .replace(/\s+/g, " ")
          .trim();
        if (who) lastPersonRef.current = who;
        const followUp =
          resolved === "kn"
            ? `${lastPersonRef.current} ಅವರ ಇತರ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾ? ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲೇ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಹುಡುಕಲಾ?`
            : `Do you want me to check ${lastPersonRef.current}'s other details? I can show the crime location on the map, or search them in the network.`;
        answerInCopilot(cmd.query, followUp);
        return;
      }

      // 3) No explicit screen keyword. Could be (a) an in-screen automation on
      // the CURRENT screen ("filter to theft", "set horizon 30"), or (b) a pure
      // data question. The Voice Screen Agent decides: it returns answer=true for
      // data questions (→ answerInCopilot) or an action plan for automation.
      runScreenAgent(cmd.query, resolved, rate, !!detail.speak, speechLang);
      return;
    };

    const onCmd = (e: Event) => handle((e as CustomEvent).detail || {});
    window.addEventListener("satyam:voice-command", onCmd);
    return () => window.removeEventListener("satyam:voice-command", onCmd);
  }, [pathname, lang, voiceLang, speechRate, navigate, setLang, t, resumeListening]);

  useEffect(() => {
    try {
      localStorage.setItem("satyam-voice-lang", voiceLang);
    } catch {}
  }, [voiceLang]);

  useEffect(() => {
    try {
      localStorage.setItem("satyam-voice-rate", String(speechRate));
    } catch {}
  }, [speechRate]);

  useEffect(() => {
    if (!listening || !micActive) return;
    setFinalTranscript("");
    setInterimTranscript("");
    setEditableTranscript("");
    setSpeechError(null);
    setSaved(false);
    setCaptureStatus(null);
    liveFinalRef.current = "";
    liveInterimRef.current = "";
    turnSubmittedRef.current = false;
    phaseRef.current = "listening";

    // Secure-context guard (shared): mic is blocked on plain http://<LAN-IP>.
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    ) {
      setSpeechError("Microphone needs https or localhost. Open the app at http://localhost:3000.");
      return;
    }

    // The COPILOT mic engine is chosen in Settings -> Models ("Voice copilot
    // mic"). It is fully INDEPENDENT of the chat voice (voiceBackend) and of the
    // chat-box mic; only this top-right copilot effect reads copilotStt.
    const sttEngine = loadEngineSettings().copilotStt; // "browser" | "sarvam"

    // Shared: hand a finished utterance to the Gemini brain.
    const dispatchTurn = (rawText: string, detectedLang?: string | null) => {
      if (turnSubmittedRef.current) return;
      const text = rawText.trim();
      if (!text) return;
      turnSubmittedRef.current = true;
      clearSilenceTimer();
      phaseRef.current = "processing";
      setMicActive(false);
      // Sarvam reports the language it actually heard, and the recorder has been
      // passing it to onResult all along — Shell's handler was typed
      // `(transcript: string)` and dropped the second argument. Without it,
      // "auto" reached the command handler as the literal string "auto", which
      // matches no language check, so the turn fell back to the UI language: a
      // Kannada question with the UI in English was answered and spoken in
      // English. Script detection does not cover it either, because Saaras can
      // return Kannada transliterated into Latin script.
      const turnLang =
        voiceLangRef.current === "auto" && detectedLang ? detectedLang : voiceLangRef.current; // "auto" | "kn-IN" | "en-IN"
      console.debug("[voice] dispatchTurn", { engine: sttEngine, text, turnLang });
      window.dispatchEvent(
        new CustomEvent("satyam:voice-command", {
          detail: { text, lang: turnLang, rate: speechRateRef.current, speak: true },
        }),
      );
    };

    // === OPTION A - BROWSER (Web Speech API) =================================
    // Lowest latency, live word-by-word captions. Kannada via rec.lang="kn-IN"
    // (Chrome / Edge only; Kannada accuracy is weaker than Sarvam).
    if (sttEngine === "browser") {
      const SR: any =
        (typeof window !== "undefined" &&
          ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
        null;
      if (!SR) {
        setSpeechError(
          "This browser has no speech recognition. Use Chrome/Edge, or switch the copilot mic to Sarvam in Settings.",
        );
        return;
      }
      console.debug("[voice] SpeechRecognition start", { voiceLang, uiLang: lang });

      const rec = new SR();
      rec.continuous = true; // keep listening until explicit stop
      rec.interimResults = true;
      // Concrete language hint; "auto" falls back to the UI language.
      rec.lang =
        voiceLang === "auto"
          ? lang === "KN"
            ? "kn-IN"
            : "en-IN"
          : coerceVoiceLang(voiceLang) || "en-IN";

      const armSilence = () => {
        if (turnSubmittedRef.current) return;
        clearSilenceTimer();
        // Auto-submit ~1.5s after speech stops.
        silenceTimerRef.current = setTimeout(() => {
          const text = `${liveFinalRef.current} ${liveInterimRef.current}`.trim();
          if (text) dispatchTurn(text);
        }, 1500);
      };

      rec.onstart = () => {
        setSpeechError(null);
        setCaptureStatus(null);
      };
      rec.onaudiostart = () => {
        setCaptureStatus(null);
      };
      rec.onspeechstart = () => {
        setInterimTranscript("\u2026");
      };
      rec.onresult = (e: any) => {
        let interim = "",
          finals = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finals) {
          const add = finals.trim();
          setFinalTranscript((p) => (p ? p + " " : "") + add);
          setEditableTranscript((p) => {
            const n = (p ? p + " " : "") + add;
            liveFinalRef.current = n;
            return n;
          });
        }
        liveInterimRef.current = interim;
        setInterimTranscript(interim || (liveFinalRef.current ? "" : "\u2026"));
        // Orb-initiated turns end on a tap, not on silence, so the officer can
        // pause mid-sentence without the turn being sent out from under them.
        if (!orbModeRef.current) armSilence();
      };
      rec.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed")
          setSpeechError("Microphone permission denied. Allow mic in the browser address bar.");
        else if (e.error === "audio-capture")
          setSpeechError("No microphone found, or it is in use by another app (Zoom/Meet).");
        else if (e.error === "no-speech") {
          /* keep waiting - user hasn't spoken yet */
        } else {
          setSpeechError(`Mic error: ${e.error}`);
        }
      };
      rec.onend = () => {
        // Auto-restart only if still active and no turn was submitted.
        if (recognitionRef.current !== rec) return;
        if (turnSubmittedRef.current) return;
        setTimeout(() => {
          if (recognitionRef.current !== rec || turnSubmittedRef.current) return;
          try {
            rec.start();
          } catch {
            /* effect re-creates on next render */
          }
        }, 200);
      };

      recognitionRef.current = rec;
      sttSessionRef.current = {
        stop: () => {
          const text = `${liveFinalRef.current} ${liveInterimRef.current}`.trim();
          if (text && !turnSubmittedRef.current) dispatchTurn(text);
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        },
        cancel: () => {
          recognitionRef.current = null;
          try {
            rec.onend = null;
            rec.stop();
          } catch {
            /* noop */
          }
        },
      };

      try {
        unlockAudioPlayback();
        rec.start();
        console.debug("[voice] rec.start() OK, lang=", rec.lang);
      } catch (err) {
        setSpeechError("Could not start microphone. Reload the page and try again.");
      }

      return () => {
        recognitionRef.current = null;
        clearSilenceTimer();
        try {
          rec.onend = null;
          rec.stop();
        } catch {
          /* noop */
        }
        sttSessionRef.current = null;
      };
    }

    // === OPTION B - SARVAM (Saaras v3) =======================================
    // Best Kannada accuracy. Utterance-based: shows capture status then the
    // final recognized text (no word-by-word live captions).
    if (!isBackendSttSupported()) {
      setSpeechError("This browser can't record audio for Sarvam STT. Use Chrome or Edge.");
      return;
    }

    const sttLang: "auto" | "en" | "kn" =
      voiceLang === "auto" ? "auto" : voiceLang.toLowerCase().startsWith("kn") ? "kn" : "en";

    let session: { stop: () => void; cancel: () => void } | null = null;
    let cancelled = false;

    unlockAudioPlayback();
    void startSttSession({
      lang: sttLang,
      silenceMs: 1500, // auto-end the utterance ~1.5s after speech stops
      // Orb turns are stopped by a second tap. `manual` keeps the recorder open
      // through pauses; the 60s cap is a runaway guard, not an expected path.
      manual: orbModeRef.current,
      maxMs: orbModeRef.current ? 60000 : 15000,
      callbacks: {
        onStatus: (s: string) => {
          if (!cancelled) setCaptureStatus(s);
        },
        onSpeechStart: () => {
          if (cancelled) return;
          setInterimTranscript("\u2026");
          setCaptureStatus("Hearing you\u2026");
        },
        onResult: (transcript: string, detectedLang: string | null) => {
          if (cancelled) return;
          const clean = (transcript || "").trim();
          setInterimTranscript("");
          if (clean) {
            setCaptureStatus(null);
            setFinalTranscript(clean);
            setEditableTranscript(clean);
            liveFinalRef.current = clean;
            dispatchTurn(clean, detectedLang);
          } else {
            setCaptureStatus("Didn't catch that \u2014 tap the mic to try again.");
            // The overlay can show that message and let the user retry in place.
            // The orb cannot: it has no surface for it, so an empty result has to
            // end the turn too, or tap-start → silence → tap-stop pins the orb in
            // "listening" with no way back to idle.
            if (orbModeRef.current) {
              setMicActive(false);
              setListening(false);
            }
          }
        },
        onError: (msg: string) => {
          if (!cancelled) setSpeechError(msg);
        },
      },
    })
      .then((s) => {
        if (cancelled) {
          try {
            s.cancel();
          } catch {
            /* noop */
          }
          return;
        }
        session = s;
        recognitionRef.current = s; // keep the ref live for cleanup / orb-tap stop
        sttSessionRef.current = {
          stop: () => {
            try {
              s.stop();
            } catch {
              /* noop */
            }
          },
          cancel: () => {
            try {
              s.cancel();
            } catch {
              /* noop */
            }
          },
        };
      })
      .catch(() => {
        if (!cancelled) setSpeechError("Could not start the microphone. Reload and try again.");
      });

    return () => {
      cancelled = true;
      recognitionRef.current = null;
      clearSilenceTimer();
      try {
        session?.cancel();
      } catch {
        /* noop */
      }
      sttSessionRef.current = null;
    };
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);

  useEffect(() => {
    if (!isSpeaking) return;
    const id = setInterval(() => {
      if (!isSpeechActive()) {
        setIsSpeaking(false);
        setIsPaused(false);
        resumeListening(); // hands-free: listen for the next reply
      }
    }, 300);
    return () => clearInterval(id);
  }, [isSpeaking, resumeListening]);

  // Single source of truth for the agent's turn lifecycle. Console (and Shell's
  // own confirmations) drive: thinking → speaking → done.
  useEffect(() => {
    const onState = (e: Event) => {
      const state = (e as CustomEvent).detail?.state;
      if (state === "thinking") {
        phaseRef.current = "processing";
        clearThinkWatchdog();
        // Safety net: if the backend never responds, recover the conversation.
        thinkWatchdogRef.current = setTimeout(() => resumeListening(), 25000);
      } else if (state === "speaking") {
        phaseRef.current = "speaking";
        clearThinkWatchdog();
        setIsSpeaking(true);
        setIsPaused(false);
      } else if (state === "done") {
        clearThinkWatchdog();
        // If the TTS library already started playing (isSpeaking=true), the 300ms
        // poll owns the transition — it will call resumeListening() when the audio
        // actually finishes. Only resume here when nothing is / was playing
        // (empty text, provider error before onStart, or non-speaking turns).
        if (!isSpeechActive()) {
          setIsSpeaking(false);
          setIsPaused(false);
          resumeListening();
        }
      }
    };
    window.addEventListener("satyam:ai-state", onState);
    return () => window.removeEventListener("satyam:ai-state", onState);
  }, [resumeListening, clearThinkWatchdog]);

  // ── Orb: one tap opens the mic, the next tap sends ────────────────────────
  // Reuses the copilot capture effect and the whole `satyam:voice-command`
  // pipeline rather than opening a second recognition session, so the orb answers
  // questions, navigates and automates screens exactly as the top-bar mic does.
  const orbState: OrbState = isSpeaking
    ? "speaking"
    : phaseRef.current === "processing"
      ? "thinking"
      : listening && micActive
        ? "listening"
        : "idle";

  const handleOrbToggle = useCallback(() => {
    if (listening) {
      // Second tap: close the utterance. The engine's own stop path finalises the
      // transcript and dispatches the turn, so there is no separate submit here —
      // one code path for the orb, the overlay and silence auto-submit alike.
      setCaptureStatus("Finishing\u2026");
      try {
        sttSessionRef.current?.stop();
      } catch {
        /* session already closed */
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        /* browser engine not in use */
      }
      // Guarantee the orb returns to idle. `stop()` normally resolves into a
      // transcript, which dispatches the turn and clears the mic — but a silent
      // capture, a transcription failure, or an engine that never fires its
      // result callback would all leave the orb pinned in "listening" forever.
      // The orb is the only visible control in this mode, so an unreachable idle
      // state is unrecoverable without a reload.
      if (orbCloseTimerRef.current) clearTimeout(orbCloseTimerRef.current);
      orbCloseTimerRef.current = setTimeout(() => {
        orbCloseTimerRef.current = null;
        if (!orbModeRef.current || turnSubmittedRef.current) return;
        setMicActive(false);
        setListening(false);
      }, 4000);
      return;
    }
    // First tap. unlockAudioPlayback must run inside the gesture or the spoken
    // reply is silently blocked by the autoplay policy.
    unlockAudioPlayback();
    setOrbMode(true);
    orbModeRef.current = true; // the capture effect reads the ref this same tick
    setListening(true);
    setMicActive(true);
    setIsSpeaking(false);
    setIsPaused(false);
  }, [listening]);

  // Release orb mode once the turn is fully over, so the next top-bar mic press
  // gets the normal overlay back.
  useEffect(() => {
    if (!listening && orbMode) {
      setOrbMode(false);
      if (orbCloseTimerRef.current) {
        clearTimeout(orbCloseTimerRef.current);
        orbCloseTimerRef.current = null;
      }
    }
  }, [listening, orbMode]);

  // Order is the one specified for the rail. Two notes on how the request was
  // reconciled, because it was not a clean 1:1 list:
  //
  //   * "Board" appeared at both 10 and 15, and "Person 360" at both 11 and 16.
  //     Each is placed once, at its FIRST position — a nav cannot hold an entry
  //     twice, and the earlier slot is the one the numbering implies.
  //   * Graphs and Audit were not in the list at all. They are kept, at the end,
  //     rather than dropped: removing them from the rail would leave /graphs and
  //     /audit reachable only by typed URL, and Audit is the compliance screen —
  //     hiding it is not a cosmetic change. Say where you want them and I'll move
  //     them; say drop them and I will.
  const NAV = [
    { to: "/console", icon: LayoutDashboard, label: t("Dashboard") },
    // Listed as "Chat"; this is that screen — grounded Q&A with the copilot.
    { to: "/ask", icon: Sparkles, label: t("Ask Satyam") },
    { to: "/vision", icon: Globe2, label: t("Vision") },
    { to: "/network", icon: Network, label: t("Network") },
    // Trends was folded into Forecast, so one entry covers both. `Siren` rather
    // than `ShieldCheck` because that icon already means Audit in this rail.
    { to: "/forecast", icon: Siren, label: t("Forecast") },
    { to: "/ops-camera", icon: Video, label: t("Camera") },
    { to: "/ops-predictive", icon: Radar, label: t("Predictive") },
    // `FileLock2` rather than `FileText`, which already means Reports here — this
    // screen's point is the seal, not the document.
    { to: "/documents", icon: FileLock2, label: t("Documents") },
    // Listed as "Transcription"; the screen is named Transcripts.
    { to: "/transcripts", icon: ClipboardList, label: t("Transcripts") },
    { to: "/board", icon: Workflow, label: t("Board") },
    ...(isAdmin ? [{ to: "/dossier" as const, icon: Fingerprint, label: t("Person 360") }] : []),
    { to: "/reports", icon: FileText, label: t("Reports") },
    // `Tv` rather than `Video`, which already means the Camera review screen.
    { to: "/news", icon: Tv, label: t("News Feed") },
    { to: "/ops-dispatch", icon: Truck, label: t("Dispatch") },
    { to: "/graphs", icon: BarChart3, label: t("Graphs") },
    { to: "/audit", icon: ShieldCheck, label: t("Audit") },
    ...(isAdmin ? [{ to: "/admin" as const, icon: ShieldCheck, label: t("Access Control") }] : []),
  ] as const;

  return (
    /* h-dvh + overflow-hidden, NOT min-h-screen.
       `min-h-screen` sets a floor and lets the column grow, so the tallest thing
       inside decided the page height. That was the nav rail below: ~17 items at
       h-11 plus gaps and padding is about 900px of fixed height, so on any window
       shorter than that the rail stretched the document and left a band of empty
       background under every screen's content — the "extra page".
       Pinning the shell to the viewport and scrolling the two inner regions
       instead means no screen can produce page scroll. */
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b-2 border-foreground bg-header px-5 text-header-foreground">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground text-[11px] font-extrabold nb-shadow-sm">
            SY
          </div>
          <div className="text-sm font-semibold tracking-wide">Satyam</div>
          <span className="mx-1 h-6 w-px bg-header-foreground/20" />
          <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleHandsFree}
            className={`flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground px-2.5 py-1.5 text-xs font-bold transition hover:translate-x-[2px] hover:translate-y-[2px] ${
              handsFreeOn
                ? "bg-primary text-primary-foreground"
                : "bg-secondary-background text-foreground"
            }`}
            aria-label={t("Hands-free camera")}
            title={handsFreeOn ? t("Hands-free: on") : t("Hands-free: off")}
          >
            {handsFreeOn ? (
              <Camera className="h-3.5 w-3.5" />
            ) : (
              <CameraOff className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{t("Hands-free")}</span>
          </button>
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
          <button
            onClick={() => {
              unlockAudioPlayback();
              setListening(true);
              setMicActive(true);
              setIsSpeaking(false);
              setIsPaused(false);
            }}
            className="rounded-[5px] border-2 border-header-foreground bg-secondary-background p-2 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            aria-label={t("Voice")}
          >
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

      {/* Full-screen copilot overlay — suppressed for orb-initiated turns, where
          the floating orb itself is the entire interface for the turn. */}
      {listening && !orbMode && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setListening(false);
            setMicActive(false);
            setIsSpeaking(false);
            setIsPaused(false);
            setConversationMode(false);
            setCaptureStatus(null);
            stopConversation();
            if (typeof window !== "undefined" && "speechSynthesis" in window) {
              window.speechSynthesis.cancel();
            }
          }}
        >
          <div
            className="relative flex w-[min(560px,95vw)] flex-col rounded-[10px] border-2 border-foreground bg-card text-foreground nb-shadow-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header bar */}
            <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${isSpeaking ? "bg-success animate-pulse" : speechError ? "bg-destructive" : interimTranscript ? "bg-success animate-ping" : "bg-primary animate-ping"}`}
                />
                <span className="text-xs font-extrabold uppercase tracking-wider">
                  {isSpeaking
                    ? t("Speaking…")
                    : speechError
                      ? "⚠ Error"
                      : interimTranscript && interimTranscript !== "…"
                        ? "🎙 Hearing you…"
                        : captureStatus
                          ? captureStatus
                          : finalTranscript
                            ? "✓ Got it — processing…"
                            : "Listening…"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-60">
                <span>{isSpeaking ? t("Speech output") : t("Voice input")}</span>
                <span>·</span>
                <span>{voiceLang === "auto" ? "en-IN (auto)" : voiceLang}</span>
              </div>
            </div>

            {/* Mic orb + waveform */}
            <div className="flex flex-col items-center gap-3 px-8 pt-6 pb-4">
              <div
                className={`relative grid h-24 w-24 place-items-center ${!isSpeaking ? "cursor-pointer" : ""}`}
                role="button"
                title={t("Tap to stop & send")}
                onClick={() => {
                  if (!isSpeaking) {
                    setCaptureStatus("Finishing\u2026");
                    try {
                      sttSessionRef.current?.stop();
                    } catch {
                      /* noop */
                    }
                  }
                }}
              >
                {!isSpeaking ? (
                  <>
                    <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
                    <span className="absolute inset-3 animate-pulse rounded-full bg-primary/35" />
                    <div className="relative grid h-20 w-20 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground nb-shadow">
                      <Mic className="h-8 w-8" />
                    </div>
                  </>
                ) : (
                  <>
                    <span className="absolute inset-0 animate-pulse rounded-full bg-success/20" />
                    <div className="relative grid h-20 w-20 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground nb-shadow">
                      <Volume2 className="h-8 w-8" />
                    </div>
                  </>
                )}
              </div>

              {/* Waveform bars */}
              <div className="flex items-end gap-[3px] h-6">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-primary transition-all"
                    style={{
                      height:
                        !isSpeaking && !captureStatus?.includes("Transcrib")
                          ? `${10 + Math.round(Math.sin(i * 0.8) * 8 + Math.cos(i * 1.2) * 6)}px`
                          : "4px",
                      opacity: !isSpeaking && !captureStatus?.includes("Transcrib") ? 0.8 : 0.3,
                    }}
                  />
                ))}
              </div>

              {/* Conversation toggle */}
              <button
                type="button"
                onClick={() => {
                  unlockAudioPlayback();
                  setConversationMode((on) => {
                    const next = !on;
                    if (next) {
                      phaseRef.current = "listening";
                      setIsSpeaking(false);
                      setIsPaused(false);
                      setMicActive(true);
                    } else {
                      stopConversation();
                    }
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide nb-shadow-sm transition hover:translate-x-[1px] hover:translate-y-[1px] ${conversationMode ? "bg-primary text-primary-foreground" : "bg-secondary-background text-foreground"}`}
              >
                <Volume2 className="h-3.5 w-3.5" />
                {conversationMode ? t("Conversation: ON") : t("Start conversation")}
              </button>

              {/* State hint */}
              <p className="text-[11px] text-muted-foreground text-center">
                {conversationMode
                  ? phaseRef.current === "processing"
                    ? t("Thinking…")
                    : isSpeaking
                      ? t("Speaking… (mic paused)")
                      : t("Conversation mode · just talk, the agent replies and listens again.")
                  : isSpeaking
                    ? t("Tap Pause to pause, Stop to end.")
                    : t("Tap the mic to stop & send, or wait for silence.")}
              </p>
            </div>

            {/* Settings row */}
            <div className="border-t border-border px-5 py-3 flex flex-col gap-2 bg-background/50">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20 shrink-0">
                  {t("Speech output")}
                </span>
                <select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(coerceVoiceLang(e.target.value))}
                  className="flex-1 rounded-[5px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold text-foreground outline-none"
                >
                  <option value="auto">{t("Auto (detect)")}</option>
                  <option value="en-IN">English (India)</option>
                  <option value="kn-IN">Kannada (ಕನ್ನಡ)</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20 shrink-0">
                  {t("Rate")}
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 accent-primary cursor-pointer"
                />
                <span className="text-[11px] font-bold text-muted-foreground w-8 text-right tabular-nums">
                  {speechRate.toFixed(1)}×
                </span>
              </div>
            </div>

            {/* Transcript box */}
            <div className="px-5 py-3 border-t border-border">
              <div className="relative rounded-[6px] border-2 border-foreground bg-background nb-shadow-sm">
                <textarea
                  value={
                    editableTranscript +
                    (interimTranscript ? (editableTranscript ? " " : "") + interimTranscript : "")
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditableTranscript(val);
                    setFinalTranscript(val);
                    setInterimTranscript("");
                    liveFinalRef.current = val;
                    liveInterimRef.current = "";
                  }}
                  rows={3}
                  className="w-full max-h-36 overflow-y-auto bg-transparent px-3 py-2.5 text-sm leading-relaxed text-foreground resize-none outline-none"
                  placeholder={t("Waiting for speech…")}
                />
                {interimTranscript && !editableTranscript.endsWith(interimTranscript) && (
                  <span className="pointer-events-none absolute bottom-2.5 left-3 text-sm text-muted-foreground/60 leading-relaxed">
                    {editableTranscript ? " " : ""}
                    {interimTranscript}
                  </span>
                )}
              </div>
              {speechError ? (
                <p className="mt-1.5 text-[11px] font-bold text-destructive">{speechError}</p>
              ) : (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {interimTranscript ? t("Listening…") : t("Tap textarea to edit")}
                </p>
              )}
            </div>

            {/* Action bar */}
            <div className="border-t-2 border-foreground px-5 py-3 bg-background">
              {isSpeaking ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">{t("Speaking…")}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (isPaused) {
                          resumeSpeech();
                          setIsPaused(false);
                        } else {
                          pauseSpeech();
                          setIsPaused(true);
                        }
                      }}
                      className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1 text-[11px] font-bold hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm"
                    >
                      {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                      {isPaused ? t("Resume") : t("Pause")}
                    </button>
                    <button
                      onClick={() => {
                        cancelSpeech();
                        setIsSpeaking(false);
                        setIsPaused(false);
                        setMicActive(true);
                      }}
                      className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-destructive px-3 py-1 text-[11px] font-bold text-destructive-foreground hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm"
                    >
                      <Volume2 className="h-3 w-3" />
                      {t("Stop")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(editableTranscript);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {}
                    }}
                    disabled={!editableTranscript}
                    className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? t("Copied") : t("Copy")}
                  </button>
                  <button
                    onClick={() => {
                      if (!editableTranscript.trim()) return;
                      window.dispatchEvent(
                        new CustomEvent("satyam:insert-transcript", {
                          detail: editableTranscript.trim(),
                        }),
                      );
                      setListening(false);
                    }}
                    disabled={!editableTranscript.trim()}
                    className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
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
                        }),
                      );
                      setIsPaused(false);
                    }}
                    disabled={!editableTranscript.trim()}
                    className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
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
                    className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
                    {saved ? t("Saved") : t("Save")}
                  </button>
                  <button
                    onClick={() => {
                      setListening(false);
                      setMicActive(false);
                      setIsSpeaking(false);
                      setIsPaused(false);
                      setConversationMode(false);
                      setCaptureStatus(null);
                      stopConversation();
                      if (typeof window !== "undefined" && "speechSynthesis" in window)
                        window.speechSynthesis.cancel();
                    }}
                    className="ml-auto flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1 text-[11px] font-bold hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm"
                  >
                    {t("Close")}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div
            className={`relative grid h-20 w-20 place-items-center ${!isSpeaking ? "cursor-pointer" : ""}`}
            role="button"
            title={t("Tap to stop & send")}
            onClick={() => {
              if (!isSpeaking) {
                setCaptureStatus("Finishing\u2026");
                try {
                  sttSessionRef.current?.stop();
                } catch {
                  /* noop */
                }
              }
            }}
          >
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
          {captureStatus && !speechError && (
            <p className="text-center text-xs font-bold text-primary">{captureStatus}</p>
          )}
          <div className="text-center">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {isSpeaking
                ? `${t("Speech output")} · ${voiceLang === "auto" ? t("Auto (detect)") : voiceLang}`
                : `${t("Voice input")} · ${voiceLang === "auto" ? (lang === "KN" ? "kn-IN" : "en-IN") + " " + t("(auto)") : voiceLang}`}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {isSpeaking ? t("Speaking…") : t("Listening…")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {conversationMode
                ? phaseRef.current === "processing"
                  ? t("Thinking…")
                  : isSpeaking
                    ? t("Speaking… (mic paused)")
                    : t("Conversation mode · just talk, the agent replies and listens again.")
                : isSpeaking
                  ? t("Tap Pause to pause, Stop to end.")
                  : t("Speak now. Tap anywhere to stop.")}
            </div>
          </div>
        </div>
      )}

      {/* Body: rail + content */}
      <div className="flex flex-1 min-h-0">
        {/* Dock magnification for the collapsed rail. See lib/railDock.ts for why
            the growth stays inside the rail instead of popping out of it. */}
        <style>{railDockCss()}</style>
        {/* shrink-0 keeps the 4rem width; overflow-y-auto is what stops the rail
            forcing page height on a short window. The scrollbar is hidden because
            a 64px-wide column has no room for one — the rail still scrolls by
            wheel, drag and keyboard, so nothing becomes unreachable. */}
        <nav
          // data-rail is what scopes the dock magnification to the collapsed view,
          // as asked: the CSS keys off it, so expanding the rail turns the swell
          // off without a second class list to keep in sync.
          data-rail={railOpen ? "expanded" : "collapsed"}
          style={{ width: railOpen ? RAIL_WIDTH_OPEN_PX : RAIL_WIDTH_PX }}
          // items-center is kept as a utility as well as in railDock.ts: the rail
          // must be centred even on the first paint, before the injected <style>
          // has been applied.
          className="rail flex shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden overscroll-contain border-r-2 border-foreground bg-rail py-3 text-rail-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          // A tooltip pinned to viewport coordinates goes stale the moment the rail
          // scrolls under it, so drop it rather than leave it pointing at nothing.
          onScroll={() => setRailTip(null)}
          onMouseLeave={() => setRailTip(null)}
        >
          <button
            type="button"
            onClick={toggleRail}
            aria-expanded={railOpen}
            aria-label={railOpen ? t("Collapse sidebar") : t("Expand sidebar")}
            className="rail-toggle mb-1 flex h-9 shrink-0 items-center gap-3 rounded-[5px] border-2 border-transparent px-2.5 text-rail-foreground/60 transition-colors hover:border-rail-foreground hover:bg-rail-foreground/10 hover:text-rail-foreground"
          >
            <ChevronRight className="rail-chevron h-5 w-5 shrink-0" />
            <span className="rail-label whitespace-nowrap text-[11px] font-bold uppercase tracking-wider">
              {t("Collapse")}
            </span>
          </button>

          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            // Only the collapsed rail needs a tooltip; once expanded the label is
            // right there, and showing both would name the icon twice.
            const show = (el: HTMLElement) => {
              if (railOpen) return;
              const r = el.getBoundingClientRect();
              setRailTip({ label, top: r.top + r.height / 2 });
            };
            return (
              <Link
                key={to}
                to={to}
                className={`rail-item relative flex h-11 shrink-0 items-center gap-3 rounded-[5px] border-2 px-2.5 ${
                  active
                    ? "border-foreground bg-primary text-primary-foreground nb-shadow-sm"
                    : "border-transparent text-rail-foreground/70 hover:border-rail-foreground hover:bg-rail-foreground/10 hover:text-rail-foreground"
                }`}
                // aria-label, not title: `title` would raise the browser's own
                // tooltip on top of the styled one, giving two labels for one icon.
                // The link's content is an SVG plus a label that is clipped away
                // when collapsed, so without this it can have no accessible name.
                aria-label={label}
                onMouseEnter={(e) => show(e.currentTarget)}
                onFocus={(e) => show(e.currentTarget)}
                onBlur={() => setRailTip(null)}
              >
                <Icon className="rail-icon h-5 w-5 shrink-0" />
                <span className="rail-label whitespace-nowrap text-[12px] font-bold">{label}</span>
              </Link>
            );
          })}
        </nav>

        {railTip && (
          <div
            role="tooltip"
            // left-16 (64px) + 8px clears the rail and its 2px border.
            style={{ top: railTip.top, left: "calc(4rem + 8px)" }}
            className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1 text-[11px] font-bold text-foreground nb-shadow-sm"
          >
            {railTip.label}
          </div>
        )}

        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>

      {/* Floating voice orb — present on every screen because Shell wraps every
          route. Hidden while the full overlay is up so there is only ever one
          visible mic control. */}
      <VoiceOrb state={orbState} onToggle={handleOrbToggle} hidden={listening && !orbMode} />

      {/* Hands-free multimodal layer: gesture control, face-presence auto-lock,
          wake word, and War-room mode. Self-gates on the user's settings. */}
      <HandsFreeLayer />
    </div>
  );
}
