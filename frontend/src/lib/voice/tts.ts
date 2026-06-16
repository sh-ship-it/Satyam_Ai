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
 * Always fires exactly one terminal onEnd so the conversation loop never stalls.
 */
import { ttsSynthesize } from "../api/client";
import { loadEngineSettings } from "@/components/SettingsDialog";

export type SpeakHooks = { onStart?: () => void; onEnd?: () => void };

let currentAudio: HTMLAudioElement | null = null;
const cache = new Map<string, string>(); // `${provider}::${lang}::${text}` → objectURL

// ── browser voice pre-loading (V2) ───────────────────────────────────────────
let voicesCache: SpeechSynthesisVoice[] = [];
function warmVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const load = () => { voicesCache = window.speechSynthesis.getVoices() || []; };
  load();
  // Chrome populates voices asynchronously.
  window.speechSynthesis.onvoiceschanged = load;
}
warmVoices();

function pickVoice(lang: "en" | "kn"): SpeechSynthesisVoice | null {
  const all = voicesCache.length
    ? voicesCache
    : (typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis.getVoices()
        : []);
  if (!all || !all.length) return null;
  const exact  = lang === "kn" ? "kn-in" : "en-in";
  const prefix = lang === "kn" ? "kn"    : "en";
  return (
    all.find((v) => v.lang?.toLowerCase() === exact) ||
    all.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    all.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    all[0] ||
    null
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
    void a.play().then(() => { a.pause(); }).catch(() => {});
    audioUnlocked = true;
  } catch { /* noop */ }
  // Also nudge speechSynthesis so the first utterance isn't swallowed on Chrome.
  try { window.speechSynthesis?.resume(); } catch { /* noop */ }
}

// ── public controls ──────────────────────────────────────────────────────────

/** Stop any in-flight speech — fetched clip AND browser voice. */
export function cancelSpeech(): void {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ""; } catch { /* noop */ }
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
  }
}

/** Pause whichever channel is active (V4). */
export function pauseSpeech(): void {
  if (currentAudio && !currentAudio.paused) {
    try { currentAudio.pause(); } catch { /* noop */ }
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { if (window.speechSynthesis.speaking) window.speechSynthesis.pause(); } catch { /* noop */ }
  }
}

/** Resume whichever channel was paused (V4). */
export function resumeSpeech(): void {
  if (currentAudio && currentAudio.paused && currentAudio.src) {
    void currentAudio.play().catch(() => {});
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { window.speechSynthesis.resume(); } catch { /* noop */ }
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
function browserSpeak(
  text: string,
  lang: "en" | "kn",
  rate: number,
  hooks?: SpeakHooks,
): void {
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
      u.onend   = () => hooks?.onEnd?.();
      u.onerror = () => hooks?.onEnd?.();
      window.speechSynthesis.speak(u);
      // Chrome bug: long utterances pause themselves ~15 s in. Kick resume every 8 s.
      const kick = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(kick); return; }
        try { window.speechSynthesis.resume(); } catch { /* noop */ }
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
 */
export async function speak(
  text: string,
  lang: "en" | "kn",
  rate = 1,
  hooks?: SpeakHooks,
): Promise<void> {
  cancelSpeech();
  if (!text?.trim()) { hooks?.onEnd?.(); return; }

  const provider = loadEngineSettings().voiceBackend; // "sarvam" | "google" | "webspeech"

  if (provider === "webspeech") {
    browserSpeak(text, lang, rate, hooks);
    return;
  }

  // sarvam or google — fetch via the backend TTS endpoint.
  try {
    const key = `${provider}::${lang}::${text}`;
    let url = cache.get(key);
    if (!url) {
      const { audio_base64, mime } = await ttsSynthesize(
        text,
        lang,
        provider as "sarvam" | "google" | "bhashini",
      );
      if (!audio_base64) throw new Error("empty audio response");
      url = URL.createObjectURL(b64ToBlob(audio_base64, mime || "audio/wav"));
      cache.set(key, url);
    }
    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.1, rate || 1);
    currentAudio = audio;
    audio.onplay = () => hooks?.onStart?.();
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      hooks?.onEnd?.();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      // Provider audio failed — degrade to browser voice, never strand the loop.
      browserSpeak(text, lang, rate, hooks);
    };
    await audio.play(); // may reject if autoplay not unlocked → caught below
  } catch {
    // Network / CORS / autoplay block — always fall back, never stall.
    browserSpeak(text, lang, rate, hooks);
  }
}

// Back-compat alias — console.tsx and Shell.tsx import `speakViaSarvam`.
export const speakViaSarvam = speak;
