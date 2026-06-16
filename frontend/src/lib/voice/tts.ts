/**
 * Provider-aware text-to-speech for Satyam.
 *
 * Reads the user's choice from Settings (sarvam | google | webspeech).
 *   sarvam / google → POST /voice/tts (browser fallback on any error)
 *   webspeech       → browser speechSynthesis only (no backend call)
 *
 * Keeps ONE audio element in flight at a time and caches synthesized clips
 * per (provider, lang, text) — so repeated phrases never re-bill API credits.
 *
 * The `speakViaSarvam` export is a back-compat alias so the console.tsx /
 * Shell.tsx call-sites from the Voice v2 spec need zero further changes.
 */
import { ttsSynthesize } from "../api/client";
import { loadEngineSettings } from "@/components/SettingsDialog";

export type SpeakHooks = { onStart?: () => void; onEnd?: () => void };

let currentAudio: HTMLAudioElement | null = null;
const cache = new Map<string, string>(); // `${provider}::${lang}::${text}` → objectURL

/** Stop any in-flight speech — Sarvam/Google clip AND browser voice. */
export function cancelSpeech(): void {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ""; } catch { /* noop */ }
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
  }
}

/** True while either the backend audio clip or the browser voice is playing. */
export function isSpeechActive(): boolean {
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) return true;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis.speaking || window.speechSynthesis.pending;
  }
  return false;
}

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
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "kn" ? "kn-IN" : "en-IN";
    u.rate = rate;
    u.onstart = () => hooks?.onStart?.();
    u.onend = () => hooks?.onEnd?.();
    u.onerror = () => hooks?.onEnd?.();
    window.speechSynthesis.speak(u);
  } catch {
    hooks?.onEnd?.();
  }
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

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
    await audio.play();
  } catch {
    // Network / CORS / autoplay block — always fall back, never stall.
    browserSpeak(text, lang, rate, hooks);
  }
}

// Back-compat alias — console.tsx and Shell.tsx import `speakViaSarvam`
// from the Voice v2 spec; that call-site is unchanged.
export const speakViaSarvam = speak;
