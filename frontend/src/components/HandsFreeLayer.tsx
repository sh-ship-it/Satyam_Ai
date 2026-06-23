// HandsFreeLayer — the single integration point that wires the hands-free
// multimodal input layer into the running app. It is mounted once inside the
// Shell (which lives under the Router + I18n providers), so it has access to
// navigation, the current route, and the UI language.
//
// Responsibilities:
//   • Mount the input controllers based on the user's hands-free settings
//     (GestureController, FacePresenceController) and the security LockOverlay.
//   • Own the War-room (presentation) mode boolean and render its banner.
//   • Manage the always-on wake word ("Satyam…") lifecycle, pausing it while
//     the copilot mic is actively listening so the two recognizers don't fight.
//   • Execute the high-level GestureIntents dispatched by the GestureController
//     on the "satyam:gesture" event bus — navigation, scrolling, voice arming,
//     map/board control, war-room toggle — and surface bilingual feedback.
//   • Mount the sonner <Toaster/> so gesture feedback (and existing app toasts)
//     are visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useI18n } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { speakViaSarvam } from "@/lib/voice/tts";

import { GestureController } from "@/input/GestureController";
import { FacePresenceController } from "@/input/FacePresenceController";
import { LockOverlay } from "@/components/LockOverlay";
import { WarRoomBanner } from "@/components/WarRoomMode";

import { loadHandsFree } from "@/config/handsFreeConfig";
import type { HandsFreeSettings } from "@/input/types";
import type { GestureIntent, GLabel } from "@/input/gestureActions";
import { SCREEN_CYCLE, cycleIndex } from "@/input/gestureActions";
import {
  isWakeWordSupported,
  startWakeWord,
  pauseWakeWord,
  resumeWakeWord,
} from "@/lib/voice/wakeWord";

export function HandsFreeLayer() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { lang: uiLang } = useI18n();
  const lang: "en" | "kn" = uiLang === "KN" ? "kn" : "en";

  const [settings, setSettings] = useState<HandsFreeSettings>(() => loadHandsFree());
  const [warRoom, setWarRoom] = useState(false);

  // Latest values for the long-lived gesture-event handler.
  const pathnameRef = useRef(pathname);
  const langRef = useRef(lang);
  const settingsRef = useRef(settings);
  const warRoomRef = useRef(warRoom);
  pathnameRef.current = pathname;
  langRef.current = lang;
  settingsRef.current = settings;
  warRoomRef.current = warRoom;

  // ── Live settings updates (Settings dialog dispatches this) ────────────────
  useEffect(() => {
    const onSettings = (e: Event) => {
      const next = (e as CustomEvent).detail as HandsFreeSettings | undefined;
      setSettings(next ?? loadHandsFree());
    };
    window.addEventListener("satyam:handsfree-settings", onSettings as EventListener);
    return () =>
      window.removeEventListener("satyam:handsfree-settings", onSettings as EventListener);
  }, []);

  // ── Feedback: bilingual toast + optional spoken confirmation ───────────────
  const feedback = useCallback((label: GLabel) => {
    const text = label[langRef.current] || label.en;
    toast(text, { duration: 1200 });
    if (settingsRef.current.speakFeedback) {
      void speakViaSarvam(text, langRef.current, 1).catch(() => {});
    }
  }, []);

  // ── Read the current screen aloud (presentation "read" gesture) ────────────
  const readScreen = useCallback(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const parts: string[] = [];
    main.querySelectorAll("h1, h2, h3").forEach((el) => {
      const txt = (el.textContent || "").trim();
      if (txt) parts.push(txt);
    });
    const text = parts.slice(0, 6).join(". ").slice(0, 320);
    if (text) void speakViaSarvam(text, langRef.current, 1).catch(() => {});
  }, []);

  // ── Execute a GestureIntent ─────────────────────────────────────────────────
  const runIntent = useCallback(
    (intent: GestureIntent) => {
      switch (intent.kind) {
        case "arm_voice":
          window.dispatchEvent(new CustomEvent("satyam:open-voice"));
          break;
        case "navigate":
          if (intent.to !== pathnameRef.current) navigate({ to: intent.to });
          break;
        case "nav_cycle": {
          const i = cycleIndex(pathnameRef.current);
          const next = (i + intent.dir + SCREEN_CYCLE.length) % SCREEN_CYCLE.length;
          const to = SCREEN_CYCLE[next];
          if (to !== pathnameRef.current) navigate({ to });
          break;
        }
        case "scroll": {
          // The app scrolls inside <main>, not the window.
          const main = document.querySelector("main");
          (main ?? window).scrollBy({
            top: intent.dy * window.innerHeight,
            behavior: "smooth",
          });
          break;
        }
        case "history_back":
          window.history.back();
          break;
        case "toggle_warroom":
          setWarRoom((v) => !v);
          break;
        case "read_screen":
          readScreen();
          break;
        case "map_pan":
          window.dispatchEvent(
            new CustomEvent("satyam:hands-map", {
              detail: { action: "pan", dir: intent.dir },
            }),
          );
          break;
        case "map_zoom":
          window.dispatchEvent(
            new CustomEvent("satyam:hands-map", {
              detail: { action: "zoom", delta: intent.delta },
            }),
          );
          break;
        case "board_pan":
          window.dispatchEvent(
            new CustomEvent("satyam:hands-board", {
              detail: { action: "pan", dir: intent.dir },
            }),
          );
          break;
        case "board_zoom":
          window.dispatchEvent(
            new CustomEvent("satyam:hands-board", {
              detail: { action: "zoom", delta: intent.delta },
            }),
          );
          break;
        case "run_task":
          window.dispatchEvent(
            new CustomEvent("satyam:run-task", {
              detail: { route: intent.route, actions: intent.actions, lang: langRef.current },
            }),
          );
          break;
      }
      feedback(intent.label);
    },
    [navigate, feedback, readScreen],
  );

  // ── Gesture event bus ───────────────────────────────────────────────────────
  useEffect(() => {
    const onGesture = (e: Event) => {
      const detail = (e as CustomEvent).detail as { intent?: GestureIntent } | undefined;
      if (detail?.intent) runIntent(detail.intent);
    };
    window.addEventListener("satyam:gesture", onGesture as EventListener);
    return () => window.removeEventListener("satyam:gesture", onGesture as EventListener);
  }, [runIntent]);

  // ── Wake-word lifecycle ───────────────────────────────────────────────────────
  // Start/stop the always-on listener with the master + wakeWord switches. The
  // copilot mic and the wake word both use Web Speech, so we pause the wake word
  // whenever the copilot mic opens and resume it when the turn finishes.
  useEffect(() => {
    const active = settings.enabled && settings.wakeWord && isWakeWordSupported();
    if (!active) return;

    const stop = startWakeWord({
      lang: lang === "kn" ? "kn-IN" : "en-IN",
      onWake: () => window.dispatchEvent(new CustomEvent("satyam:open-voice")),
    });

    const onVoiceOpen = () => pauseWakeWord();
    const onVoiceClosed = () => resumeWakeWord();
    const onAiState = (e: Event) => {
      if ((e as CustomEvent).detail?.state === "done") resumeWakeWord();
    };
    window.addEventListener("satyam:open-voice", onVoiceOpen);
    window.addEventListener("satyam:voice-closed", onVoiceClosed);
    window.addEventListener("satyam:ai-state", onAiState as EventListener);

    return () => {
      stop();
      window.removeEventListener("satyam:open-voice", onVoiceOpen);
      window.removeEventListener("satyam:voice-closed", onVoiceClosed);
      window.removeEventListener("satyam:ai-state", onAiState as EventListener);
    };
  }, [settings.enabled, settings.wakeWord, lang]);

  // Leaving War-room when hands-free is fully disabled keeps state consistent.
  useEffect(() => {
    if (!settings.enabled) setWarRoom(false);
  }, [settings.enabled]);

  const gesturesOn = settings.enabled && settings.gestures;
  const presenceOn = settings.enabled && settings.presenceLock;

  return (
    <>
      <Toaster />
      {gesturesOn && (
        <GestureController route={pathname} lang={lang} presentation={warRoom} />
      )}
      {presenceOn && (
        <FacePresenceController absenceSeconds={settings.absenceSeconds} lang={lang} />
      )}
      <LockOverlay />
      <WarRoomBanner active={warRoom} lang={lang} onExit={() => setWarRoom(false)} />
    </>
  );
}
