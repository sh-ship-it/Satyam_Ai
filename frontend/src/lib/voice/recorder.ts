/**
 * Microphone capture + silence detection for genuine server-side STT.
 *
 * Records mic audio via the Web Audio API, encodes a 16 kHz mono 16-bit PCM WAV
 * (a format both Sarvam Saaras and Google STT accept), then uploads it to the
 * backend /voice/stt endpoint, which auto-detects the spoken language
 * (Saaras v3 `language_code="unknown"`).
 *
 * Why WAV (not MediaRecorder/webm): Sarvam STT rejects Opus/webm; a PCM WAV is
 * universally accepted and needs no backend transcoding. We capture PCM with a
 * ScriptProcessor so we also get real-time RMS for voice-activity detection.
 */
import { sttTranscribe } from "../api/client";

export type SttCallbacks = {
  /** Fired once when speech is first detected. */
  onSpeechStart?: () => void;
  /** Fired with the final transcript + provider-detected BCP-47 language. */
  onResult?: (transcript: string, detectedLang: string | null) => void;
  /** Fired on mic-permission / network / provider error. */
  onError?: (message: string) => void;
};

export type SttSession = {
  /** Force-stop now and transcribe what was captured. */
  stop: () => void;
  /** Abort immediately with no transcription. */
  cancel: () => void;
};

export type SttSessionOptions = {
  /** "auto" lets the backend auto-detect (Saaras v3). */
  lang?: "auto" | "en" | "kn";
  /** Quiet time (ms) after speech to end the utterance. */
  silenceMs?: number;
  /** Hard cap (ms) on a single utterance. */
  maxMs?: number;
  /** When true, never auto-stop on silence — the caller stops via stop(). */
  manual?: boolean;
  callbacks?: SttCallbacks;
};

const TARGET_RATE = 16000;
const VOICE_RMS_THRESHOLD = 0.002; // was too high; quiet mics never tripped it
const MIN_PEAK_TO_SEND = 0.001;    // any signal above this is worth transcribing

export function isBackendSttSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    !!((window as any).AudioContext || (window as any).webkitAudioContext)
  );
}

export async function startSttSession(
  opts: SttSessionOptions = {},
): Promise<SttSession> {
  const {
    lang = "auto",
    silenceMs = 1500,
    maxMs = 15000,
    manual = false,
    callbacks = {},
  } = opts;

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    callbacks.onError?.("Microphone permission denied.");
    return { stop: () => {}, cancel: () => {} };
  }

  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  // CRITICAL: a freshly created AudioContext is often "suspended" because it is
  // built AFTER the await getUserMedia() above, which breaks the user-gesture
  // chain. While suspended, ScriptProcessor.onaudioprocess never fires, so NO
  // audio is captured and the transcript comes back empty. Resume it explicitly.
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* noop */ }
  }
  console.debug("[stt] session start", { ctxState: ctx.state, sampleRate: ctx.sampleRate });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  // Route through a muted gain node so the mic isn't played back (no feedback),
  // while still pumping the ScriptProcessor's onaudioprocess.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const chunks: Float32Array[] = [];
  const inputRate = ctx.sampleRate;
  let speechStarted = false;
  let maxPeakRef = 0;           // running max absolute sample value (track even quiet audio)
  let maxRms = 0;               // track maximum RMS seen during the session
  let framesSeen = false;       // set true on the first onaudioprocess call
  let audioFrames = 0;          // how many onaudioprocess callbacks fired
  let lastVoiceTs = Date.now();
  const startTs = Date.now();
  let finished = false;

  // No-frames watchdog: if onaudioprocess never fires within 1200 ms the
  // AudioContext is not pumping (still suspended on this browser/OS). Report
  // "no-audio-frames" so the caller falls back to browser recognition.
  const frameWatchdog = setTimeout(() => {
    if (framesSeen || finished) return;
    console.debug("[stt] no audio frames in 1200ms — AudioContext not pumping");
    callbacks.onError?.("no-audio-frames");
    void finalize(false); // tear down; caller's onError will start browser rec
  }, 1200);

  // Legacy broader watchdog kept as a second safety net.
  const noAudioWatchdog = setTimeout(() => {
    if (finished || audioFrames > 0) return;
    finished = true;
    cleanup();
    callbacks.onError?.("No audio captured (microphone/audio engine not running).");
  }, 1600);

  const cleanup = () => {
    try { clearTimeout(frameWatchdog); } catch { /* noop */ }
    try { clearTimeout(noAudioWatchdog); } catch { /* noop */ }
    try { processor.onaudioprocess = null as any; } catch { /* noop */ }
    try { processor.disconnect(); } catch { /* noop */ }
    try { source.disconnect(); } catch { /* noop */ }
    try { mute.disconnect(); } catch { /* noop */ }
    try { stream?.getTracks().forEach((tr) => tr.stop()); } catch { /* noop */ }
    try { void ctx.close(); } catch { /* noop */ }
  };

  const finalize = async (transcribe: boolean) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!transcribe) return;
    // Send if there is ANY real signal — don't require the RMS gate to have
    // been crossed (quiet mics never trip it).
    const hasSignal = speechStarted || maxPeakRef > MIN_PEAK_TO_SEND;
    const wav = hasSignal ? encodeWav(flatten(chunks), inputRate, TARGET_RATE) : null;
    console.debug("[stt] finalize", { speechStarted, maxPeak: maxPeakRef, wavBytes: wav?.size });
    if (!hasSignal || !wav || wav.size < 2000) {
      callbacks.onResult?.("", null);
      return;
    }
    try {
      const { transcript, detected_lang } = await sttTranscribe(wav, lang);
      callbacks.onResult?.((transcript || "").trim(), detected_lang ?? null);
    } catch (e: any) {
      callbacks.onError?.(e?.message || "STT request failed.");
    }
  };

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    if (finished) return;
    if (!framesSeen) {
      framesSeen = true;
      clearTimeout(frameWatchdog); // first frame arrived — cancel the no-frames watchdog
    }
    audioFrames++;
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const a = Math.abs(input[i]);
      sum += input[i] * input[i];
      if (a > peak) peak = a;
    }
    if (peak > maxPeakRef) maxPeakRef = peak;
    const rms = Math.sqrt(sum / input.length);
    if (rms > maxRms) maxRms = rms;
    const now = Date.now();
    if (rms > VOICE_RMS_THRESHOLD) {
      if (!speechStarted) {
        speechStarted = true;
        callbacks.onSpeechStart?.();
      }
      lastVoiceTs = now;
    }
    if (now - startTs > maxMs) { void finalize(true); return; }
    if (!manual && speechStarted && now - lastVoiceTs > silenceMs) {
      void finalize(true);
    }
  };

  return {
    stop: () => { void finalize(true); },
    cancel: () => { void finalize(false); },
  };
}

// ── WAV helpers ─────────────────────────────────────────────
function flatten(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function downsample(buf: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return buf;
  const ratio = inRate / outRate;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += buf[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, inRate: number, outRate: number): Blob {
  const pcm = downsample(samples, inRate, outRate);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, outRate, true);     // sample rate
  view.setUint32(28, outRate * 2, true); // byte rate (rate * blockAlign)
  view.setUint16(32, 2, true);           // block align (mono * 16-bit)
  view.setUint16(34, 16, true);          // bits per sample
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}
