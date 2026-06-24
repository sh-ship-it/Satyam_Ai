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
  Siren,
  Radar,
  Truck,
  Video,
  Fingerprint,
  Workflow,
  Camera,
  CameraOff,
} from "lucide-react";
import { type ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { ThemePicker } from "./ThemePicker";
import { DarkModeToggle } from "./DarkModeToggle";
import { SettingsDialog, loadEngineSettings } from "./SettingsDialog";
import { ProfileMenu } from "./ProfileMenu";
import { HandsFreeLayer } from "./HandsFreeLayer";
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
import { streamChat, type ChatEvent } from "@/lib/api/client";
import { planVoiceAction, type AgentPlan } from "@/lib/api/voiceAgent";

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
  { to: "/console", words: /(console|chat|assistant|conversation)|ಕನ್ಸೋಲ್|ಸಂಭಾಷಣೆ/i },
  { to: "/console", words: /(map|hotspot|heat ?map|geospatial)|ನಕ್ಷೆ/i },
  { to: "/network", words: /(network|graph|ego|link analysis|connections?)|ನೆಟ್‌ವರ್ಕ್/i },
  { to: "/reports", words: /(report|reports|brief|dossier|pdf)|ವರದಿ/i },
  { to: "/audit", words: /(audit|compliance|chain|logs?)|ಆಡಿಟ್/i },
  { to: "/transcripts", words: /(transcripts?|recordings?)|ಪ್ರತಿಲೇಖನ/i },
  { to: "/operations", words: /(response ops|operations|live ops|live map)|ಕಾರ್ಯಾಚರಣೆ/i },
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
      setIsAdmin(cl >= 4 || ["admin","DGP","ADGP","IGP","SP"].includes(rank));
    } catch { /* ignore */ }
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
      // Turning hands-free ON from the header enables the full experience —
      // gestures + wake word — so "Satyam" works immediately without diving
      // into Settings. Granular off-switches still live in Settings → Hands-free.
      : { ...cur, enabled: true, gestures: true, wakeWord: true };
    saveHandsFree(next);
    setHandsFreeOn(next.enabled);
  }, []);
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
      void speakViaSarvam(text, lang, rate, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      }, copilotVoiceProvider());
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
        let streamError = false;
        const finish = () => {
          let answer = acc.trim();
          if (streamError)
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
          void speakViaSarvam(stripMarkdown(toSpeak), spokenLang, rate, {
            onStart: () => aiState("speaking"),
            onEnd: () => aiState("done"),
          }, copilotVoiceProvider());
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
            else if (ev.type === "blocked")
              acc = t(
                "Your role can't view named accused records. Showing aggregate counts instead.",
              );
            else if (ev.type === "done") copilotConvId.current = ev.conversation_id;
            else if (ev.type === "error") streamError = true;
          },
        )
          .then(finish)
          .catch(() => {
            streamError = true;
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
        const sayConfirm = (text: string) => {
          if (!speak || !text) return;
          const sl: "en" | "kn" = resolveLang(spokenLocale, text);
          void speakViaSarvam(stripMarkdown(text), sl, speechRate, {
            onStart: () => setIsSpeaking(true),
            onEnd: () => setIsSpeaking(false),
          }, copilotVoiceProvider());
        };
        void planVoiceAction({
          command: question,
          current_route: pathname,
          lang: resolvedLang,
          brain_engine: engines.brainEngine,
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
            const strippedConsoleAsk =
              (planRes.actions || []).length > 0 && actions.length === 0;

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
              // Let the destination screen mount its run-task listener first.
              setTimeout(dispatchActions, 550);
            } else {
              dispatchActions();
            }
            sayConfirm(planRes.speak);
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
      if (cmd.route && cmd.route !== "/console") {
        // Hand off to the Voice Screen Agent (backend brain): it decides the
        // exact screen + the in-screen actions to automate, then we navigate
        // and dispatch the structured action plan to that screen.
        runScreenAgent(cmd.query, resolved, rate, !!detail.speak, speechLang);
        closePanel();
        if (conversationModeRef.current) setTimeout(() => resumeListening(), 1200);
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
    const dispatchTurn = (rawText: string) => {
      if (turnSubmittedRef.current) return;
      const text = rawText.trim();
      if (!text) return;
      turnSubmittedRef.current = true;
      clearSilenceTimer();
      phaseRef.current = "processing";
      setMicActive(false);
      const turnLang = voiceLangRef.current; // "auto" | "kn-IN" | "en-IN"
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
        armSilence(); // reset end-of-utterance timer on every speech event
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
      maxMs: 15000,
      callbacks: {
        onStatus: (s: string) => {
          if (!cancelled) setCaptureStatus(s);
        },
        onSpeechStart: () => {
          if (cancelled) return;
          setInterimTranscript("\u2026");
          setCaptureStatus("Hearing you\u2026");
        },
        onResult: (transcript: string) => {
          if (cancelled) return;
          const clean = (transcript || "").trim();
          setInterimTranscript("");
          if (clean) {
            setCaptureStatus(null);
            setFinalTranscript(clean);
            setEditableTranscript(clean);
            liveFinalRef.current = clean;
            dispatchTurn(clean);
          } else {
            setCaptureStatus("Didn't catch that \u2014 tap the mic to try again.");
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

  const NAV = [
    { to: "/console", icon: MessageSquare, label: t("Console") },
    { to: "/network", icon: Network, label: t("Network") },
    { to: "/forecast", icon: ShieldCheck, label: t("Forecast") },
    { to: "/trends", icon: FileText, label: t("Trends") },
    { to: "/reports", icon: FileText, label: t("Reports") },
    { to: "/audit", icon: ShieldCheck, label: t("Audit") },
    { to: "/transcripts", icon: ClipboardList, label: t("Transcripts") },
    { to: "/operations", icon: Siren, label: t("Live Ops") },
    { to: "/ops-predictive", icon: Radar, label: t("Predictive") },
    { to: "/ops-dispatch", icon: Truck, label: t("Dispatch") },
    { to: "/ops-camera", icon: Video, label: t("Camera") },
    { to: "/board", icon: Workflow, label: t("Board") },
    ...(isAdmin ? [{ to: "/dossier" as const, icon: Fingerprint, label: t("Person 360") }] : []),
    ...(isAdmin ? [{ to: "/admin" as const, icon: ShieldCheck, label: t("Access Control") }] : []),
  ] as const;

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
            {handsFreeOn ? <Camera className="h-3.5 w-3.5" /> : <CameraOff className="h-3.5 w-3.5" />}
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

      {listening && (
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

      {/* Hands-free multimodal layer: gesture control, face-presence auto-lock,
          wake word, and War-room mode. Self-gates on the user's settings. */}
      <HandsFreeLayer />
    </div>
  );
}
