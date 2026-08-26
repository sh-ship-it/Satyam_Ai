/**
 * Provider-aware text-to-speech for Satyam.
 *
 * Settings choice (sarvam | google | webspeech):
 *   sarvam / google → POST /voice/tts  (browser fallback on ANY error)
 *   webspeech       → browser speechSynthesis only
 *
 * Fixes:
 *  - V2: browser voices load async; pick the best voice for the language.
 *  - V3: unlock audio playback on a user gesture so fetched clips can play.
 *  - V4: pauseSpeech()/resumeSpeech() control BOTH the <audio> clip and the
 *        browser voice.
 *  - V5: strip Markdown before sending to TTS (Sarvam reads ** | [] verbatim).
 *        Auto-speak typed answers when Sarvam/Google is the selected provider.
 * Always fires exactly one terminal onEnd so the conversation loop never stalls.
 */
import { ttsSynthesize } from "../api/client";
import { loadEngineSettings } from "@/components/SettingsDialog";

export type SpeakHooks = { onStart?: () => void; onEnd?: () => void };

let currentAudio: HTMLAudioElement | null = null;
// Monotonic token: every speak() call claims the next id. A call only produces
// sound / fallback while it is still the latest one, so overlapping callers can
// never double up (e.g. Sarvam clip + a stale browser fallback at the same time).
let speechSession = 0;

// ── Markdown stripper for clean TTS ──────────────────────────────────────────
/**
 * Strip Markdown syntax so Sarvam/Google reads clean prose, not
 * "asterisk asterisk bold asterisk asterisk pipe column pipe".
 */
export function stripMarkdown(text: string): string {
  return (
    (text || "")
      // fenced code blocks
      .replace(/```[\s\S]*?```/g, "")
      // inline code
      .replace(/`[^`]*`/g, "")
      // headings
      .replace(/^#{1,6}\s+/gm, "")
      // bold/italic
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
      // GFM table rows → comma-separated
      .replace(/\|([^\n]+)\|/g, (_m, inner: string) =>
        inner
          .split("|")
          .map((c: string) => c.trim())
          .filter(Boolean)
          .join(", "),
      )
      // table separator rows
      .replace(/^[\s|:-]+$/gm, "")
      // markdown links [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // inline citations like [ref]
      .replace(/\[[^\]]+\]/g, "")
      // blockquotes
      .replace(/^>\s*/gm, "")
      // horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // bullet/numbered list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      // excess blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ── browser voice pre-loading (V2) ───────────────────────────────────────────
let voicesCache: SpeechSynthesisVoice[] = [];
function warmVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const load = () => {
    voicesCache = window.speechSynthesis.getVoices() || [];
  };
  load();
  // Chrome populates voices asynchronously.
  window.speechSynthesis.onvoiceschanged = load;
}
warmVoices();

function pickVoice(lang: "en" | "kn"): SpeechSynthesisVoice | null {
  const all = voicesCache.length
    ? voicesCache
    : typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis.getVoices()
      : [];
  if (!all || !all.length) return null;
  const exact = lang === "kn" ? "kn-in" : "en-in";
  const prefix = lang === "kn" ? "kn" : "en";
  return (
    all.find((v) => v.lang?.toLowerCase() === exact) ||
    all.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    all.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    all[0] ||
    null
  );
}

/**
 * Fired whenever a chosen cloud provider could not be used and the BROWSER voice
 * spoke instead.
 *
 * This exists because the fallback used to be completely silent. When Sarvam was
 * selected and its clip could not play, the officer heard the operating system's
 * voice with no indication anything had gone wrong — which reads as "Sarvam is
 * connected but sounds wrong", and sends you looking at the API key instead of at
 * the real cause. A substituted voice must announce itself.
 */
export const TTS_FALLBACK_EVENT = "satyam:tts-fallback";

export type TtsFallbackDetail = { provider: string; reason: string };

function announceFallback(provider: string, reason: string): void {
  console.warn(`[tts] "${provider}" was selected but the browser voice spoke instead — ${reason}`);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TtsFallbackDetail>(TTS_FALLBACK_EVENT, { detail: { provider, reason } }),
  );
}

// ── autoplay unlock (V3) ─────────────────────────────────────────────────────
let audioUnlocked = false;
/**
 * Call synchronously inside a click/tap handler (mic-open, conversation-start).
 * Satisfies the browser autoplay policy so subsequent async audio.play() calls
 * are allowed.
 */
export function unlockAudioPlayback(): void {
  if (audioUnlocked || typeof window === "undefined") return;
  try {
    // Play a 0-length silent WAV to "spend" the gesture token.
    const a = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
    );
    a.volume = 0;
    void a
      .play()
      .then(() => {
        a.pause();
        // Only NOW is playback genuinely unlocked.
        //
        // This used to be set unconditionally, right after kicking off play().
        // If that very first attempt happened outside a user gesture the browser
        // rejected it, but the flag latched `true` anyway — so every later call
        // returned early at the guard above and NO subsequent gesture could ever
        // unlock audio again. The result was a permanent, silent degrade to the
        // browser voice for the whole page session, with Sarvam returning perfectly
        // good audio that was never allowed to play.
        audioUnlocked = true;
      })
      .catch(() => {
        // Stay locked so the next real gesture gets another attempt.
        audioUnlocked = false;
      });
  } catch {
    /* noop */
  }
  // Also nudge speechSynthesis so the first utterance isn't swallowed on Chrome.
  try {
    window.speechSynthesis?.resume();
  } catch {
    /* noop */
  }
}

// ── public controls ──────────────────────────────────────────────────────────

/** Stop any in-flight speech — fetched clip AND browser voice. */
export function cancelSpeech(): void {
  speechSession++; // invalidate any in-flight speak() awaiting a fetch
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = "";
    } catch {
      /* noop */
    }
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
  }
}

/** Pause whichever channel is active (V4). */
export function pauseSpeech(): void {
  if (currentAudio && !currentAudio.paused) {
    try {
      currentAudio.pause();
    } catch {
      /* noop */
    }
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
    } catch {
      /* noop */
    }
  }
}

/** Resume whichever channel was paused (V4). */
export function resumeSpeech(): void {
  if (currentAudio && currentAudio.paused && currentAudio.src) {
    void currentAudio.play().catch(() => {});
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.resume();
    } catch {
      /* noop */
    }
  }
}

/** True while either the fetched clip or the browser voice is playing. */
export function isSpeechActive(): boolean {
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) return true;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis.speaking || window.speechSynthesis.pending;
  }
  return false;
}

// ── internal helpers ─────────────────────────────────────────────────────────

/** Browser Web Speech fallback — always fires exactly one onEnd. */
function browserSpeak(text: string, lang: "en" | "kn", rate: number, hooks?: SpeakHooks): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    hooks?.onEnd?.();
    return;
  }
  const run = () => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "kn" ? "kn-IN" : "en-IN";
      u.rate = Math.max(0.5, Math.min(2, rate || 1));
      const v = pickVoice(lang);
      if (v) u.voice = v;
      if (lang === "kn" && (!v || !v.lang?.toLowerCase().startsWith("kn"))) {
        // No Kannada voice installed on this device — Sarvam is the reliable path.
        console.warn("[tts] no kn-IN browser voice; output may be silent. Use Sarvam/Google.");
      }
      u.onstart = () => hooks?.onStart?.();
      u.onend = () => hooks?.onEnd?.();
      u.onerror = () => hooks?.onEnd?.();
      window.speechSynthesis.speak(u);
      // Chrome bug: long utterances pause themselves ~15 s in. Kick resume every 8 s.
      const kick = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          clearInterval(kick);
          return;
        }
        try {
          window.speechSynthesis.resume();
        } catch {
          /* noop */
        }
      }, 8000);
    } catch {
      hooks?.onEnd?.();
    }
  };
  // Ensure voices are loaded before speaking (V2 async loading).
  if (!voicesCache.length && window.speechSynthesis.getVoices().length === 0) {
    let fired = false;
    const once = () => {
      if (fired) return;
      fired = true;
      voicesCache = window.speechSynthesis.getVoices();
      run();
    };
    window.speechSynthesis.onvoiceschanged = once;
    setTimeout(once, 250); // fallback if the event never fires
  } else {
    run();
  }
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── main entry point ─────────────────────────────────────────────────────────

/**
 * Speak `text` using the provider chosen in Settings.
 *   sarvam | google → backend /voice/tts (browser fallback on any error)
 *   webspeech       → browser speechSynthesis only
 *
 * Fires exactly one terminal `onEnd` regardless of path, so the conversation
 * loop (satyam:ai-state "done") never stalls.
 *
 * Markdown is stripped before synthesis so providers don't read
 * "asterisk asterisk bold asterisk asterisk" etc.
 */
export async function speak(
  text: string,
  lang: "en" | "kn",
  rate = 1,
  hooks?: SpeakHooks,
  providerOverride?: "sarvam" | "google" | "webspeech",
): Promise<void> {
  cancelSpeech();
  const session = ++speechSession; // claim this turn
  const cleaned = stripMarkdown(text);
  if (!cleaned) {
    hooks?.onEnd?.();
    return;
  }

  // An explicit override (e.g. the voice copilot forcing its own engine) wins
  // over the global Settings → Models "Voice (Text-to-Speech)" choice.
  const provider = providerOverride ?? loadEngineSettings().voiceBackend; // "sarvam" | "google" | "webspeech"
  console.debug("[tts] speak provider=", provider, "lang=", lang);

  if (provider === "webspeech") {
    browserSpeak(cleaned, lang, rate, hooks);
    return;
  }

  // sarvam or google — fetch via the backend TTS endpoint.
  // V5: No module-level cache — objectURLs can get revoked; just always fetch
  // (the backend Sarvam call is fast, ~300ms, and not called for typed queries
  // unless the user explicitly enables voice output in settings).
  try {
    const { audio_base64, mime } = await ttsSynthesize(
      cleaned,
      lang,
      provider as "sarvam" | "google" | "bhashini",
    );
    // A newer speak() superseded us while we were fetching — abort silently so
    // we don't play over the newer utterance. The newer call owns the loop.
    if (session !== speechSession) return;
    if (!audio_base64) throw new Error("empty audio response");
    const url = URL.createObjectURL(b64ToBlob(audio_base64, mime || "audio/wav"));
    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.1, rate || 1);
    currentAudio = audio;
    let started = false; // once the Sarvam/Google clip actually plays, never
    // fall back to the browser voice (prevents double audio)
    audio.onplay = () => {
      started = true;
      hooks?.onStart?.();
    };
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      URL.revokeObjectURL(url);
      hooks?.onEnd?.();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      URL.revokeObjectURL(url);
      // Only degrade to the browser voice if the provider clip NEVER started and
      // we're still the active turn — otherwise just end (no second voice).
      if (!started && session === speechSession) {
        announceFallback(provider, "the returned audio clip failed to decode or play");
        browserSpeak(cleaned, lang, rate, hooks);
      } else hooks?.onEnd?.();
    };
    await audio.play(); // may reject if autoplay not unlocked → caught below
  } catch (err) {
    // Network / CORS / autoplay block — fall back only if we're still the active
    // turn and nothing has started, so we never stack a second voice.
    if (session === speechSession) {
      // NotAllowedError here is the autoplay policy, which means
      // unlockAudioPlayback() was never called inside a user gesture on this
      // route. That is a wiring bug, not a provider outage, and naming it is the
      // difference between a five-minute fix and suspecting the API key.
      const name = (err as { name?: string })?.name;
      announceFallback(
        provider,
        name === "NotAllowedError"
          ? "the browser blocked playback (autoplay not unlocked on this screen)"
          : `the request failed (${name || "network or provider error"})`,
      );
      browserSpeak(cleaned, lang, rate, hooks);
    } else hooks?.onEnd?.();
  }
}

// Back-compat alias — console.tsx and Shell.tsx import `speakViaSarvam`.
export const speakViaSarvam = speak;

/**
 * Returns true when the currently selected voice backend is a server-side
 * provider (Sarvam or Google) rather than the browser's built-in Web Speech.
 * Use this to decide whether to auto-speak typed (non-voice) answers.
 */
export function isServerVoiceEnabled(): boolean {
  const p = loadEngineSettings().voiceBackend;
  return p === "sarvam" || p === "google";
}
