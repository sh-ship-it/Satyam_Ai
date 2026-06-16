# Satyam — MediaRecorder → /voice/stt Wiring + Genuine Input Language Auto-Detect

**Goal:** Make spoken-input language **genuinely auto-detected** by routing the
microphone through the backend `/voice/stt` endpoint (Sarvam Saaras v3 / Google
STT) instead of relying on the browser's `webkitSpeechRecognition`, whose `lang`
must be fixed up front and therefore could not truly auto-detect.

Apply every block below **exactly as written** (full file for new files,
before/after for edits). All snippets are final and compile-checked.

---

## Change map

| # | File | Change |
|---|------|--------|
| 1 | `frontend/src/lib/voice/recorder.ts` | **NEW** — mic capture, silence VAD, 16 kHz mono WAV encoder, uploads to `/voice/stt` |
| 2 | `frontend/src/components/Shell.tsx` | Add imports; preserve `"auto"` reply sentinel; fix header mic button; rewrite recognition effect (backend-STT path + browser fallback) |
| 3 | `frontend/src/lib/api/client.ts` | Upload filename `audio.webm` → `audio.wav` |
| 4 | `backend/app/models/api/google_voice.py` | `GoogleSTT` encoding `WEBM_OPUS`/`48000` → `LINEAR16`/`16000` to match the WAV the frontend now sends |

Backend `/voice/stt` route, `SarvamSTT.transcribe_with_lang`, and the registry
were audited and are **already correct** — no change needed (see §5).

---

## 1) NEW FILE — `frontend/src/lib/voice/recorder.ts`

Create this file with the full content:

```ts
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
const VOICE_RMS_THRESHOLD = 0.012; // empirically separates speech from room noise

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
  let lastVoiceTs = Date.now();
  const startTs = Date.now();
  let finished = false;

  const cleanup = () => {
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
    // Require some real speech to avoid empty/near-empty uploads.
    if (!speechStarted) {
      callbacks.onResult?.("", null);
      return;
    }
    const wav = encodeWav(flatten(chunks), inputRate, TARGET_RATE);
    if (wav.size < 2000) {
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
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
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
```

---

## 2) `frontend/src/components/Shell.tsx`

### 2a) Add imports (near the other `./SettingsDialog` import, ~line 22)

**BEFORE**
```tsx
import { SettingsDialog } from "./SettingsDialog";
```

**AFTER**
```tsx
import { SettingsDialog, loadEngineSettings } from "./SettingsDialog";
import { startSttSession, isBackendSttSupported, type SttSession } from "@/lib/voice/recorder";
```

### 2b) Preserve the `"auto"` reply-language sentinel (voice-command `handle()`)

Pre-resolving `"auto"` to a concrete locale here defeats reply-language
auto-detection in Console (`resolveLang`).

**BEFORE**
```tsx
      const out = { text: cmd.query, lang: speechLang, rate, speak: detail.speak !== false };
```

**AFTER**
```tsx
      // Preserve the "auto" sentinel so Console can auto-detect the reply
      // language from the actual answer text (resolveLang). Pre-resolving to a
      // concrete locale here would defeat reply-language auto-detection.
      const out = { text: cmd.query, lang: voiceLang === "auto" ? "auto" : speechLang, rate, speak: detail.speak !== false };
```

### 2c) Fix the header microphone button (it only set `listening`, so the recognition effect bailed on `!micActive`)

**BEFORE**
```tsx
          <button onClick={() => setListening(true)} className="rounded-[5px] border-2 border-header-foreground bg-secondary-background p-2 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition" aria-label={t("Voice")}>
```

**AFTER**
```tsx
          <button onClick={() => { unlockAudioPlayback(); setListening(true); setMicActive(true); setIsSpeaking(false); setIsPaused(false); }} className="rounded-[5px] border-2 border-header-foreground bg-secondary-background p-2 text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition" aria-label={t("Voice")}>
```

### 2d) Replace the entire recognition `useEffect`

Replace the whole effect that begins with `if (!listening || !micActive) return;`
(the one that created `webkitSpeechRecognition`) with the version below. It picks
the **backend STT path** when the provider is Sarvam/Google (genuine server-side
auto-detect) and falls back to **browser SpeechRecognition** for the Web Speech
provider or on any error. The provider-detected language wins over the manual
selector.

**AFTER (full effect)**
```tsx
  useEffect(() => {
    if (!listening || !micActive) return;
    setFinalTranscript("");
    setInterimTranscript("");
    setEditableTranscript("");
    setSpeechError(null);
    setSaved(false);
    liveFinalRef.current = "";
    liveInterimRef.current = "";
    turnSubmittedRef.current = false;
    phaseRef.current = "listening";

    let disposed = false;
    let sttSession: SttSession | null = null;
    let browserRec: any = null;

    // Dispatch one completed spoken turn. `detected` is the provider-detected
    // BCP-47 language (backend STT only); when present it wins over the manual
    // selector so the reply matches what was actually spoken.
    const dispatchTurn = (rawText: string, detected?: string | null) => {
      if (turnSubmittedRef.current) return;
      const text = rawText.trim();
      if (!text) return;
      turnSubmittedRef.current = true;
      clearSilenceTimer();
      phaseRef.current = "processing";
      setMicActive(false); // mute the mic while the agent works/talks
      const turnLang =
        detected && detected.toLowerCase().startsWith("kn") ? "kn-IN"
        : detected && detected.toLowerCase().startsWith("en") ? "en-IN"
        : voiceLangRef.current;
      window.dispatchEvent(
        new CustomEvent("satyam:voice-command", {
          detail: { text, lang: turnLang, rate: speechRateRef.current, speak: true },
        }),
      );
    };

    // ───────── Browser SpeechRecognition (Web Speech provider / fallback) ────
    const startBrowserRecognition = () => {
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
      // Browser recognition needs a language up front; "auto" falls back to the
      // UI language. Genuine input auto-detect uses the backend STT path below.
      rec.lang =
        voiceLang === "auto"
          ? (lang === "KN" ? "kn-IN" : "en-IN")
          : coerceVoiceLang(voiceLang) || "en-IN";

      const armSilence = () => {
        if (!conversationModeRef.current || turnSubmittedRef.current) return;
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          dispatchTurn(`${liveFinalRef.current} ${liveInterimRef.current}`.trim());
        }, 1600);
      };

      rec.onresult = (e: any) => {
        let interim = "";
        let finals = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finals += res[0].transcript;
          else interim += res[0].transcript;
        }
        if (finals) {
          const add = finals.trim();
          setFinalTranscript((prev) => (prev ? prev + " " : "") + add);
          setEditableTranscript((prev) => {
            const next = (prev ? prev + " " : "") + add;
            liveFinalRef.current = next;
            return next;
          });
        }
        liveInterimRef.current = interim;
        setInterimTranscript(interim);
        armSilence(); // any speech (interim or final) resets the pause clock
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
        if (recognitionRef.current !== rec) return;
        setTimeout(() => {
          if (recognitionRef.current !== rec) return;
          try { rec.start(); } catch { /* re-created by the effect if needed */ }
        }, 250);
      };
      recognitionRef.current = rec;
      browserRec = rec;
      try { rec.start(); } catch {}
    };

    // ───────── Backend STT (genuine server-side auto-detect via /voice/stt) ──
    // Captures a WAV utterance, uploads it to the backend, and uses the
    // provider-detected language. This is the path that makes "Auto (detect)"
    // actually detect the spoken language instead of following the UI toggle.
    const armBackendStt = () => {
      if (disposed) return;
      const voiceHint: "auto" | "en" | "kn" =
        voiceLang === "auto" ? "auto"
        : voiceLang.toLowerCase().startsWith("kn") ? "kn"
        : "en";
      void startSttSession({
        lang: voiceHint,
        silenceMs: 1500,
        maxMs: 15000,
        callbacks: {
          onError: (msg) => {
            if (disposed) return;
            // Permission / network / provider failure → fall back to the browser.
            console.warn("[stt] backend STT unavailable, using browser recognition:", msg);
            startBrowserRecognition();
          },
          onResult: (text, detected) => {
            if (disposed) return;
            setInterimTranscript("");
            const clean = (text || "").trim();
            let submitted = false;
            if (clean) {
              setFinalTranscript((prev) => (prev ? prev + " " : "") + clean);
              setEditableTranscript((prev) => {
                const next = (prev ? prev + " " : "") + clean;
                liveFinalRef.current = next;
                return next;
              });
              if (conversationModeRef.current) {
                dispatchTurn(clean, detected);
                submitted = true; // setMicActive(false) tears down this effect
              }
            }
            // Manual mode (or an empty conversation turn): keep listening.
            if (!submitted && !disposed && listeningRef.current) armBackendStt();
          },
        },
      }).then((s) => {
        if (disposed) s.cancel();
        else sttSession = s;
      });
    };

    const provider = loadEngineSettings().voiceBackend; // sarvam | google | webspeech
    if (provider !== "webspeech" && isBackendSttSupported()) {
      armBackendStt();
    } else {
      startBrowserRecognition();
    }

    return () => {
      disposed = true;
      clearSilenceTimer();
      try { sttSession?.cancel(); } catch { /* noop */ }
      if (browserRec) {
        recognitionRef.current = null;
        try { browserRec.onend = null; browserRec.stop(); } catch { /* noop */ }
      }
    };
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);
```

> **Note:** The dependency array must end exactly as
> `}, [listening, micActive, lang, voiceLang, clearSilenceTimer]);` with **no**
> trailing stray `}` after it.

---

## 3) `frontend/src/lib/api/client.ts`

The frontend now sends a WAV, so the upload filename must reflect that
(prevents servers/inference from mis-sniffing the container).

**BEFORE** (inside `sttTranscribe`)
```ts
  fd.append("file", audio, "audio.webm");
```

**AFTER**
```ts
  fd.append("file", audio, "audio.wav");
```

For reference, the full function should read:

```ts
/** Transcribe a recorded audio blob via the backend voice provider.
 *  Sends lang="auto" so Saaras v3 auto-detects the spoken language. */
export async function sttTranscribe(
  audio: Blob,
  lang: "en" | "kn" | "auto" = "auto",
): Promise<SttResult> {
  const fd = new FormData();
  fd.append("file", audio, "audio.wav");
  fd.append("lang", lang);
  const token = getAuthToken();
  // No content-type header — browser sets the multipart boundary.
  const res = await fetch(`${API_BASE}/voice/stt`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new ApiError(res.status, `STT failed: ${res.status}`);
  return (await res.json()) as SttResult;
}
```

---

## 4) `backend/app/models/api/google_voice.py`

The frontend always sends **16 kHz mono 16-bit PCM WAV** now, so the Google STT
config must declare `LINEAR16` / `16000` (the old `WEBM_OPUS` / `48000` would
reject or mis-decode the audio).

**BEFORE**
```python
class GoogleSTT:
    """Google Cloud Speech-to-Text. Expects WEBM/Opus audio (MediaRecorder default)."""

    def __init__(self) -> None:
        self._key = get_settings().google_tts_api_key

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if not self._key or not audio:
            return ""
        payload = {
            "config": {
                "encoding": "WEBM_OPUS",
                "sampleRateHertz": 48000,
                "languageCode": _lang_code(lang),
            },
            "audio": {"content": base64.b64encode(audio).decode("ascii")},
        }
```

**AFTER**
```python
class GoogleSTT:
    """Google Cloud Speech-to-Text. Expects 16 kHz mono 16-bit PCM WAV (LINEAR16),
    which is what the frontend recorder uploads."""

    def __init__(self) -> None:
        self._key = get_settings().google_tts_api_key

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if not self._key or not audio:
            return ""
        payload = {
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": 16000,
                "languageCode": _lang_code(lang),
            },
            "audio": {"content": base64.b64encode(audio).decode("ascii")},
        }
```

---

## 5) Backend already correct (no change needed) — verified

These were audited end-to-end and need **no edits**:

- **`backend/app/api/routes/voice.py` `/stt`** — reads the `UploadFile`, forwards
  the raw `lang` (`"auto"`) to `transcribe_with_lang`, and returns
  `STTResponse(transcript, detected_lang, provider)`.
- **`backend/app/models/api/sarvam.py` `SarvamSTT.transcribe_with_lang`** — maps
  `"auto"`/`"unknown"` → `language_code="unknown"` so **Saaras v3 auto-detects**,
  posts `files={"file": ("audio.wav", audio, "audio/wav")}`, and returns the
  detected `language_code` from the response.
- **`backend/app/models/registry.py` `get_stt`** — resolves
  per-request backend → `MODEL_BACKEND=local` Whisper → `voice_backend`
  (sarvam/google/bhashini).

**End-to-end flow**
```
Mic (Web Audio, 16 kHz mono PCM WAV)
  → sttTranscribe(wav, "auto")  [client.ts]
  → POST /voice/stt (multipart, lang=auto)  [voice.py]
  → SarvamSTT.transcribe_with_lang(audio, lang="auto") → language_code="unknown"
  → Saaras v3 auto-detects → { transcript, detected_lang }
  → onResult(transcript, detected) → dispatchTurn picks kn-IN/en-IN from detected
  → reply spoken in the language actually spoken
```

---

## 6) Testing & caveats

1. **Provider must be Sarvam or Google** (Settings → Voice). With **Web Speech**
   selected, the app uses the browser recognizer and cannot truly auto-detect
   the spoken language (browser limitation).
2. **A real API key is required** for actual transcripts. Without
   `SARVAM_API_KEY` (or the Google key), the provider returns demo text
   (`[demo:sarvam-stt] …`).
3. The mic is routed through a **muted gain node** — you will not hear yourself,
   and there is no feedback loop while listening.
4. Utterances finalize after **~1.5 s of silence** or a **15 s hard cap**.
5. On mic-permission / network / provider error, the code **auto-falls back** to
   browser SpeechRecognition so voice input still works where possible.
6. After applying, run `npm run build` (or `tsc --noEmit`) in `frontend/` to
   confirm a clean compile.

---

## 7) Known cosmetic item (optional, not fixed)

`backend/app/api/routes/voice.py` `/translate` reports
`provider = settings.voice_backend` instead of the actual translator class name
(`/tts` and `/stt` use `type(engine).__name__`). Harmless label inconsistency;
fix only if you want the response metadata to match.
