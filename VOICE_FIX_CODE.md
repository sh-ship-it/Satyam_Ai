# Satyam — Voice Input Fix (MediaRecorder STT)

This fixes the "mic records nothing / Waiting for speech…" bug. Two files change.

## Root cause
- Old `ScriptProcessor` capture needed a **running** `AudioContext`; created after `await getUserMedia()` it starts **suspended**, so `onaudioprocess` never fires → **zero audio**, no error.
- Browser `SpeechRecognition` depends on Google servers + is extension-sensitive → "Listening…" forever, no error.

## Fix
`MediaRecorder` records the stream directly (immune to the suspended-context bug) → decode offline → re-encode to **16 kHz mono WAV** → POST to the working Sarvam `/voice/stt` (auto-detects EN/KN). Browser recognition kept as automatic fallback. Every stage is shown on-screen.

---

## 1. REPLACE entire file: `frontend/src/lib/voice/recorder.ts`

```ts
/**
 * Microphone capture for server-side STT — MediaRecorder edition.
 *
 * WHY MediaRecorder (not the old AudioContext + ScriptProcessor capture):
 *   A ScriptProcessor only pumps audio while its AudioContext is "running".
 *   A context created right after `await getUserMedia()` frequently starts
 *   "suspended" (the await breaks the user-gesture chain), and while suspended
 *   `onaudioprocess` NEVER fires -> zero audio captured, silently, with no
 *   error. That was the real reason the mic "heard nothing".
 *
 *   MediaRecorder records the MediaStream directly and does NOT depend on an
 *   AudioContext callback loop, so it is immune to that gotcha. We then decode
 *   the recorded (compressed) blob OFFLINE via decodeAudioData (which works
 *   regardless of context state) and re-encode it to a 16 kHz mono 16-bit PCM
 *   WAV -- the format Sarvam Saaras v3 accepts with no backend transcoding --
 *   before POSTing it to /voice/stt. The backend auto-detects the spoken
 *   language (Saaras v3 `language_code="unknown"`).
 *
 * Every stage reports through `onStatus` so the UI can show exactly what is
 * happening (and exactly why it failed) instead of a silent spinner.
 */
import { sttTranscribe } from "../api/client";

export type SttCallbacks = {
  /** Human-readable capture stage, for visible on-screen diagnostics. */
  onStatus?: (status: string) => void;
  /** Fired once when speech energy is first detected (VAD). */
  onSpeechStart?: () => void;
  /** Fired with the final transcript + provider-detected BCP-47 language. */
  onResult?: (transcript: string, detectedLang: string | null) => void;
  /** Fired on mic-permission / device / network / provider error. */
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
  /** Quiet time (ms) after speech to auto-end the utterance. */
  silenceMs?: number;
  /** Hard cap (ms) on a single utterance. */
  maxMs?: number;
  /** When true, never auto-stop on silence -- the caller stops via stop(). */
  manual?: boolean;
  callbacks?: SttCallbacks;
};

const TARGET_RATE = 16000;
const VOICE_RMS_THRESHOLD = 0.012; // analyser-based VAD "speech started" gate

/** True when MediaRecorder + getUserMedia + an AudioContext decoder exist. */
export function isBackendSttSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    typeof (window as any).MediaRecorder !== "undefined" &&
    !!((window as any).AudioContext || (window as any).webkitAudioContext)
  );
}

/** Pick the first MediaRecorder mime type this browser supports. */
function pickMimeType(): string {
  const MR: any = (window as any).MediaRecorder;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MR?.isTypeSupported?.(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return ""; // let the browser choose its default
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

  const status = (s: string) => {
    try {
      callbacks.onStatus?.(s);
    } catch {
      /* ignore */
    }
  };

  status("Requesting microphone\u2026");
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    const name = e?.name || "";
    const msg =
      name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone permission denied. Click the mic icon in the address bar, choose Allow, then try again."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No microphone found. Select an input device in your OS sound settings."
          : name === "NotReadableError" || name === "TrackStartError"
            ? "Microphone is busy in another app (Zoom/Meet/Teams). Close it and retry."
            : `Could not open microphone (${name || "unknown error"}).`;
    callbacks.onError?.(msg);
    return { stop: () => {}, cancel: () => {} };
  }

  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== "live") {
    callbacks.onError?.(
      "Microphone opened but produced no live audio track. Check your input device / OS mic privacy settings.",
    );
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    return { stop: () => {}, cancel: () => {} };
  }

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (e: any) {
    callbacks.onError?.(`MediaRecorder could not start: ${e?.message || e}`);
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    return { stop: () => {}, cancel: () => {} };
  }

  const chunks: BlobPart[] = [];
  let finished = false;
  let willTranscribe = true;

  // ---- best-effort VAD (drives silence auto-stop) -------------------------
  let vadCtx: AudioContext | null = null;
  let vadTimer: ReturnType<typeof setInterval> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let speechStarted = false;
  let lastVoiceTs = Date.now();
  const startTs = Date.now();

  const stopVad = () => {
    if (vadTimer) {
      clearInterval(vadTimer);
      vadTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    try {
      void vadCtx?.close();
    } catch {
      /* ignore */
    }
    vadCtx = null;
  };

  const handleStop = async () => {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    if (!willTranscribe) return;
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    console.debug("[stt] recorded blob", { bytes: blob.size, mimeType });
    if (!blob.size) {
      callbacks.onError?.(
        "No audio was recorded (0 bytes). The mic may be muted at the OS level.",
      );
      return;
    }
    status(`Transcribing\u2026 (${Math.round(blob.size / 1024)} KB)`);
    let payload: Blob = blob;
    try {
      payload = await blobToWav(blob, TARGET_RATE);
    } catch (e) {
      // Decode failed -> send the raw recorded blob; Sarvam may still accept it.
      console.debug("[stt] WAV transcode failed, sending raw blob", e);
    }
    try {
      const { transcript, detected_lang } = await sttTranscribe(payload, lang);
      callbacks.onResult?.((transcript || "").trim(), detected_lang ?? null);
    } catch (e: any) {
      callbacks.onError?.(e?.message || "Transcription request failed.");
    }
  };

  const finalize = (transcribe: boolean) => {
    if (finished) return;
    finished = true;
    willTranscribe = transcribe;
    stopVad();
    try {
      if (recorder.state !== "inactive") {
        recorder.stop(); // fires onstop -> handleStop
      } else {
        void handleStop();
      }
    } catch {
      void handleStop();
    }
  };

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    void handleStop();
  };
  recorder.onerror = (e: any) => {
    callbacks.onError?.(`Recorder error: ${e?.error?.name || "unknown"}`);
  };

  try {
    recorder.start(250); // timeslice -> periodic ondataavailable
  } catch (e: any) {
    callbacks.onError?.(`Could not start recording: ${e?.message || e}`);
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    return { stop: () => {}, cancel: () => {} };
  }
  status("Listening\u2026 speak now");
  console.debug("[stt] MediaRecorder started", { mimeType, state: recorder.state });

  // VAD is non-fatal: if it cannot run, we still auto-stop at maxMs (or the
  // caller stops manually), and MediaRecorder has captured the audio anyway.
  try {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    vadCtx = new AC();
    if (vadCtx.state === "suspended") {
      try {
        await vadCtx.resume();
      } catch {
        /* ignore */
      }
    }
    const src = vadCtx.createMediaStreamSource(stream);
    const analyser = vadCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    vadTimer = setInterval(() => {
      if (finished) return;
      const now = Date.now();
      let rms = 0;
      try {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        rms = Math.sqrt(sum / buf.length);
      } catch {
        /* ignore */
      }
      if (rms > VOICE_RMS_THRESHOLD) {
        if (!speechStarted) {
          speechStarted = true;
          callbacks.onSpeechStart?.();
        }
        lastVoiceTs = now;
      }
      if (now - startTs > maxMs) {
        finalize(true);
        return;
      }
      if (!manual && speechStarted && now - lastVoiceTs > silenceMs) {
        finalize(true);
      }
    }, 100);
  } catch (e) {
    console.debug("[stt] VAD unavailable; relying on manual stop + maxMs", e);
    if (!manual) maxTimer = setTimeout(() => finalize(true), maxMs);
  }

  return {
    stop: () => finalize(true),
    cancel: () => finalize(false),
  };
}

// ── decode any recorded blob -> 16 kHz mono WAV ─────────────────────────────
async function blobToWav(blob: Blob, targetRate: number): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const decodeCtx = new AC();
  try {
    const audioBuf = await decodeAudio(decodeCtx, arrayBuf);
    const chs = audioBuf.numberOfChannels;
    const len = audioBuf.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < chs; c++) {
      const data = audioBuf.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += data[i] / chs;
    }
    return encodeWav(mono, audioBuf.sampleRate, targetRate);
  } finally {
    try {
      void decodeCtx.close();
    } catch {
      /* ignore */
    }
  }
}

/** decodeAudioData with both promise + callback forms (idempotent resolve). */
function decodeAudio(
  ctx: AudioContext,
  arrayBuf: ArrayBuffer,
): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const done = (b: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(b);
      }
    };
    const fail = (e: any) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    try {
      const ret: any = ctx.decodeAudioData(arrayBuf, done, fail);
      if (ret && typeof ret.then === "function") ret.then(done, fail);
    } catch (e) {
      fail(e);
    }
  });
}

// ── WAV helpers ─────────────────────────────────────────────
function downsample(
  buf: Float32Array,
  inRate: number,
  outRate: number,
): Float32Array {
  if (outRate >= inRate) return buf;
  const ratio = inRate / outRate;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0,
      n = 0;
    for (let j = start; j < end; j++) {
      sum += buf[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(
  samples: Float32Array,
  inRate: number,
  outRate: number,
): Blob {
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, outRate, true); // sample rate
  view.setUint32(28, outRate * 2, true); // byte rate (rate * blockAlign)
  view.setUint16(32, 2, true); // block align (mono * 16-bit)
  view.setUint16(34, 16, true); // bits per sample
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

```

---

## 2. Edits in `frontend/src/components/Shell.tsx`

### 2a. Add import (after the `@/lib/voice/lang` import)

```tsx
import {
  startSttSession,
  isBackendSttSupported,
  type SttSession,
} from "@/lib/voice/recorder";
```

### 2b. Add state (next to the other `useState` declarations, near `speechError`)

```tsx
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
```
(line ~117)

### 2c. Add ref (right after `const recognitionRef = useRef<any>(null);`)

```tsx
  const sttSessionRef = useRef<SttSession | null>(null);
```
(line ~141)

### 2d. REPLACE the whole listening `useEffect` (the old browser-SpeechRecognition effect) with:

```tsx
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

    // Secure-context guard: mic is blocked on plain http://<LAN-IP>.
    if (typeof window !== "undefined" && !window.isSecureContext &&
        location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setSpeechError("Microphone needs https or localhost. Open the app at http://localhost:3000.");
      return;
    }

    let disposed = false;

    // Backend STT language: "auto" lets Saaras v3 auto-detect EN/KN.
    const sttLang: "auto" | "en" | "kn" =
      voiceLang === "auto"
        ? "auto"
        : voiceLang.toLowerCase().startsWith("kn") ? "kn" : "en";

    const dispatchTurn = (rawText: string, detected: string | null) => {
      if (turnSubmittedRef.current) return;
      const text = rawText.trim();
      if (!text) return;
      turnSubmittedRef.current = true;
      clearSilenceTimer();
      phaseRef.current = "processing";
      setMicActive(false); // mute mic while the agent works/talks
      // Provider-detected language (e.g. "kn-IN"/"en-IN") wins; otherwise keep
      // the "auto" sentinel so Console detects the reply language from text.
      const turnLang = detected || voiceLangRef.current;
      console.debug("[voice] dispatchTurn", { text, detected, turnLang });
      window.dispatchEvent(new CustomEvent("satyam:voice-command", {
        detail: { text, lang: turnLang, rate: speechRateRef.current, speak: true },
      }));
    };

    // ---- Fallback: browser SpeechRecognition (only used if MediaRecorder
    //      capture is unsupported or fails to produce audio) ----------------
    const startBrowserRecognition = () => {
      const SR: any =
        (typeof window !== "undefined" &&
          ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
      if (!SR) {
        setSpeechError("Microphone capture failed and this browser has no speech recognition. Use Chrome or Edge on http://localhost.");
        return;
      }
      setCaptureStatus("Listening (browser recognizer)\u2026");
      console.debug("[voice] browser recognition fallback", { voiceLang, uiLang: lang });
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang =
        voiceLang === "auto"
          ? (lang === "KN" ? "kn-IN" : "en-IN")
          : (coerceVoiceLang(voiceLang) || "en-IN");
      const armSilence = () => {
        if (turnSubmittedRef.current) return;
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          dispatchTurn(`${liveFinalRef.current} ${liveInterimRef.current}`.trim(), null);
        }, 1500);
      };
      rec.onstart = () => { setSpeechError(null); };
      rec.onaudiostart = () => { setCaptureStatus("Recording (browser)\u2026"); };
      rec.onresult = (e: any) => {
        let interim = "", finals = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals += r[0].transcript; else interim += r[0].transcript;
        }
        if (finals) {
          const add = finals.trim();
          setFinalTranscript((p) => (p ? p + " " : "") + add);
          setEditableTranscript((p) => { const n = (p ? p + " " : "") + add; liveFinalRef.current = n; return n; });
        }
        liveInterimRef.current = interim;
        setInterimTranscript(interim);
        armSilence();
      };
      rec.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed")
          setSpeechError("Microphone permission denied. Allow mic access in the browser.");
        else if (e.error === "audio-capture")
          setSpeechError("No microphone found, or it is used by another app.");
        else if (e.error === "no-speech") { /* keep waiting */ }
        else setSpeechError(`Mic error: ${e.error}`);
      };
      rec.onend = () => {
        if (recognitionRef.current !== rec || turnSubmittedRef.current || disposed) return;
        setTimeout(() => {
          if (recognitionRef.current !== rec || turnSubmittedRef.current || disposed) return;
          try { rec.start(); } catch { /* re-created by effect if needed */ }
        }, 250);
      };
      recognitionRef.current = rec;
      sttSessionRef.current = {
        stop: () => { try { rec.stop(); } catch { /* noop */ } },
        cancel: () => { recognitionRef.current = null; try { rec.onend = null; rec.stop(); } catch { /* noop */ } },
      };
      try { rec.start(); } catch (err) { console.debug("[voice] rec.start failed", err); }
    };

    // ---- Primary: MediaRecorder capture -> Sarvam /voice/stt --------------
    // Re-arms a fresh session if a capture returns an empty transcript while
    // still listening (handles a missed first word, brief silence, etc.).
    const armStt = () => {
      if (disposed || turnSubmittedRef.current) return;
      startSttSession({
        lang: sttLang,
        silenceMs: 1500,
        maxMs: 15000,
        manual: false, // auto-stop on silence; tapping the mic also force-stops
        callbacks: {
          onStatus: (s) => { if (!disposed) setCaptureStatus(s); },
          onSpeechStart: () => { if (!disposed) setInterimTranscript("\u2026"); },
          onResult: (transcript, detected) => {
            if (disposed) return;
            const clean = (transcript || "").trim();
            if (clean) {
              setCaptureStatus(null);
              setFinalTranscript(clean);
              setEditableTranscript(clean);
              liveFinalRef.current = clean;
              dispatchTurn(clean, detected);
            } else {
              // Captured audio but no words: gentle hint + re-arm so the user
              // can simply speak again without reopening the panel.
              setCaptureStatus(null);
              setSpeechError("Didn't catch that \u2014 please speak a bit louder, then try again.");
              if (!disposed && listeningRef.current && !turnSubmittedRef.current) {
                setTimeout(() => armStt(), 400);
              }
            }
          },
          onError: (msg) => {
            if (disposed) return;
            console.debug("[voice] MediaRecorder STT error", msg);
            // Capture-engine problems -> try the browser recognizer instead.
            if (/no live audio|MediaRecorder|Recorder error|Could not start|No audio was recorded/i.test(msg)) {
              setCaptureStatus("Switching to browser microphone\u2026");
              startBrowserRecognition();
            } else {
              // Permission / device / network errors: show the exact reason.
              setSpeechError(msg);
              setCaptureStatus(null);
            }
          },
        },
      }).then((session) => {
        if (disposed) { session.cancel(); return; }
        sttSessionRef.current = session;
      }).catch((err) => {
        console.debug("[voice] startSttSession threw", err);
        if (!disposed) startBrowserRecognition();
      });
    };

    if (isBackendSttSupported()) {
      console.debug("[voice] MediaRecorder STT primary", { sttLang });
      armStt();
    } else {
      startBrowserRecognition();
    }

    return () => {
      disposed = true;
      // Null the recognizer ref FIRST so any onend timeout can't restart it.
      recognitionRef.current = null;
      clearSilenceTimer();
      try { sttSessionRef.current?.cancel(); } catch { /* noop */ }
      sttSessionRef.current = null;
    };
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);
```

### 2e. Mic circle = tap-to-stop + visible status line (replace the mic `<div>` block)

```tsx
            <div
              className={`relative grid h-20 w-20 place-items-center ${!isSpeaking ? "cursor-pointer" : ""}`}
              role="button"
              title={t("Tap to stop & send")}
              onClick={() => {
                if (!isSpeaking) {
                  setCaptureStatus("Finishing\u2026");
                  try { sttSessionRef.current?.stop(); } catch { /* noop */ }
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
```
