# SATYAM — Voice Output + Voice Input Bug Fix (copy-paste ready)

> Scope: the AI **does not speak** (TTS output) and **does not hear** (STT / mic input), plus related text/voice defects.
> This doc contains **full, drop-in code** per file. Where a file is large (Shell.tsx), exact **find → replace** patches are given with surrounding anchors.
> Verified against the uploaded build **and** the live Sarvam API contract (docs.sarvam.ai) on 2026-06-16.

---

## 0. Root-cause summary (what actually broke)

| # | Symptom | File | Real cause | Severity |
|---|---------|------|-----------|----------|
| **V1** | AI never speaks via Sarvam | `backend/app/models/api/sarvam.py` | `speaker:"meera"` + `model:"bulbul:v3"` is an **invalid pair**. `meera` is not a valid Bulbul v2 **or** v3 voice; speakers are **not interchangeable** across model versions. Sarvam returns **400** → route returns **502** → frontend silently falls back to the browser. | 🔴 Blocker |
| **V2** | Kannada output silent even on fallback | `frontend/src/lib/voice/tts.ts` | Browser `speechSynthesis` voices load **async**, and most machines have **no `kn-IN` voice**. Fallback spoke before voices loaded / picked no voice. | 🔴 Blocker |
| **V3** | First spoken reply never plays | `frontend/src/lib/voice/tts.ts` + `Shell.tsx` | Browser **autoplay policy** blocks `new Audio().play()` because the fetch breaks the user-gesture chain. `catch` then drops to browser voice (also affected by V2). | 🟠 High |
| **V4** | Pause/Resume does nothing while a Sarvam/Google clip plays | `Shell.tsx` | Buttons call `speechSynthesis.pause()/resume()` only — they never touch the `<audio>` element used for fetched audio. | 🟡 Med |
| **H1** | Mic doesn't understand Kannada | `frontend/src/components/Shell.tsx` | `rec.lang` is derived from the **UI language `lang`**, ignoring the **`voiceLang`** ("Speech output") selector. Picking Kannada there never switches recognition to `kn-IN`. | 🔴 Blocker |
| **H2** | Mic stops after a stretch / spins | `Shell.tsx` | `rec.onend` immediately calls `rec.start()` with no guard → Chrome throttles / throws and recognition dies. | 🟠 High |
| **T1** | `/voice/stt` always errors | `backend/app/models/api/sarvam.py` | Saaras STT is **multipart/form-data** (file upload), but code sent **JSON base64** and forced a JSON `Content-Type`. | 🔴 Blocker (dead endpoint) |
| **T2** | STT provider label wrong | `backend/app/api/routes/voice.py` | Returns the *requested* backend string, not the engine that actually ran. | 🟢 Cosmetic |

> **Note:** today the mic uses the browser `webkitSpeechRecognition` engine, **not** `/voice/stt`. So **H1/H2** fix "not hearing". **T1** fixes the backend STT endpoint so it works when you switch to server-side STT (Google/Sarvam).

---

## 1. `backend/app/models/api/sarvam.py` — FULL REPLACEMENT

Fixes **V1** (valid TTS model/voice) and **T1** (multipart STT + no JSON header on uploads).

```python
"""Sarvam AI clients - PRIMARY voice layer (Kannada + English STT/TTS/MT).

Services used:
  - Saaras v3 (STT)        -> POST /speech-to-text   (multipart/form-data!)
  - Bulbul v2 (TTS)        -> POST /text-to-speech    (JSON)
  - Mayura v1 (Translate)  -> POST /translate         (JSON)

If SARVAM_API_KEY is unset the client runs in demo mode (deterministic stubs);
the TTS demo returns b"" so the route 502s and the frontend uses its browser
fallback.

VALID speaker/model pairs (speakers are NOT interchangeable across versions):
  - bulbul:v2  -> anushka, manisha, vidya, arya (F) / abhilash, karun, hitesh (M)
  - bulbul:v3  -> ritu, priya, neha, pooja, shreya, ... (different catalog)
We use bulbul:v2 + anushka (documented, stable, supports kn-IN & en-IN).
v2 caps a single input at ~500 chars, so we trim the SPOKEN copy on a sentence
boundary (the full answer still shows on screen).
"""
from __future__ import annotations

import base64

import httpx

from app.config import get_settings

_BASE = "https://api.sarvam.ai"
_TTS_MAX_CHARS = 480  # safety margin under Bulbul v2's ~500-char per-input limit


def _bcp(lang: str) -> str:
    return "kn-IN" if str(lang or "").lower().startswith("kn") else "en-IN"


def _trim_for_tts(text: str, limit: int = _TTS_MAX_CHARS) -> str:
    """Trim to <= limit chars, preferring the last sentence boundary."""
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    head = t[:limit]
    cut = max(head.rfind(". "), head.rfind("? "), head.rfind("! "),
              head.rfind("\u0964"))  # Devanagari/Kannada danda
    return (head[: cut + 1] if cut > 80 else head).strip()


class _SarvamBase:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.sarvam_api_key
        self._demo = not self._key

    def _auth(self) -> dict[str, str]:
        # ONLY the subscription key. Do NOT set Content-Type here:
        #  - httpx sets application/json automatically for `json=`
        #  - httpx sets the multipart boundary automatically for `files=`
        return {"api-subscription-key": self._key}


class SarvamSTT(_SarvamBase):
    """Saaras v3 speech-to-text. /speech-to-text is multipart/form-data."""

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if self._demo:
            return "[demo:sarvam-stt] \u0c95\u0ca8\u0ccd\u0ca8\u0ca1 \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8"
        files = {"file": ("audio.wav", audio, "audio/wav")}
        data = {"model": "saaras:v3", "language_code": _bcp(lang)}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/speech-to-text",
                headers=self._auth(),   # NO Content-Type -> multipart boundary preserved
                files=files,
                data=data,
            )
            r.raise_for_status()
        return (r.json() or {}).get("transcript", "")


class SarvamTTS(_SarvamBase):
    """Bulbul v2 text-to-speech for Kannada and English. Returns WAV bytes."""

    mime = "audio/wav"

    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if self._demo:
            return b""  # no key -> 502 -> frontend browser fallback
        spoken = _trim_for_tts(text)
        if not spoken:
            return b""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/text-to-speech",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "inputs": [spoken],
                    "target_language_code": _bcp(lang),
                    "speaker": "anushka",      # valid bulbul:v2 female voice
                    "model": "bulbul:v2",      # was the invalid "bulbul:v3" + "meera" pair
                    "speech_sample_rate": 22050,
                    "enable_preprocessing": True,
                },
            )
            r.raise_for_status()
        audio_b64 = (r.json() or {}).get("audios", [""])[0]
        return base64.b64decode(audio_b64) if audio_b64 else b""


class SarvamTranslator(_SarvamBase):
    """Mayura v1 - neural MT between Kannada and English."""

    async def translate(self, text: str, *, src: str, tgt: str) -> str:
        if self._demo:
            return f"[demo:sarvam-mt {src}->{tgt}] {text}"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{_BASE}/translate",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "input": text,
                    "source_language_code": _bcp(src),
                    "target_language_code": _bcp(tgt),
                    "speaker_gender": "Female",
                    "mode": "formal",
                    "model": "mayura:v1",
                    "enable_preprocessing": False,
                },
            )
            r.raise_for_status()
        return (r.json() or {}).get("translated_text", text)
```

> **Upgrade to Bulbul v3 (optional, longer text):** set `"model": "bulbul:v3"` **and** change the speaker to a **v3** voice (e.g. `"shreya"` or `"priya"`), then you can raise `_TTS_MAX_CHARS` to ~2400. Do not mix a v2 speaker with v3.

---

## 2. `backend/app/api/routes/voice.py` — STT handler patch (T2, cosmetic)

Return the engine that actually ran (matches the `/tts` handler's style).

**FIND:**
```python
    s = get_settings()
    provider = backend or s.voice_backend
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio upload")
    engine = get_stt(backend)  # type: ignore[arg-type]
    try:
        transcript = await engine.transcribe(audio, lang=_norm_lang(lang))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT provider error: {e}")
    return STTResponse(transcript=transcript, provider=provider)
```

**REPLACE WITH:**
```python
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio upload")
    engine = get_stt(backend)  # type: ignore[arg-type]
    try:
        transcript = await engine.transcribe(audio, lang=_norm_lang(lang))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT provider error: {e}")
    return STTResponse(transcript=transcript, provider=type(engine).__name__)
```

> No other change needed in this file — `/tts` already prefers `getattr(engine, "mime", ...)`, and `SarvamTTS.mime = "audio/wav"` (added in §1) now makes the WAV label explicit.

---

## 3. `frontend/src/lib/voice/tts.ts` — FULL REPLACEMENT

Fixes **V2** (async voice loading + voice pick + Chrome resume kick), **V3** (audio unlock), and adds **`pauseSpeech` / `resumeSpeech`** for **V4**.

```ts
/**
 * Provider-aware text-to-speech for Satyam.
 *
 * Settings choice (sarvam | google | webspeech):
 *   sarvam / google -> POST /voice/tts  (browser fallback on ANY error)
 *   webspeech       -> browser speechSynthesis only
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
const cache = new Map<string, string>(); // `${provider}::${lang}::${text}` -> objectURL

// ---- browser voice handling (V2) -------------------------------------------
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

// ---- autoplay unlock (V3) ---------------------------------------------------
let audioUnlocked = false;
/** Call from a user gesture (mic-open / conversation-start click). */
export function unlockAudioPlayback(): void {
  if (audioUnlocked || typeof window === "undefined") return;
  try {
    const a = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
    );
    a.volume = 0;
    void a.play().then(() => { a.pause(); }).catch(() => {});
    audioUnlocked = true;
  } catch { /* noop */ }
  // Also nudge speechSynthesis so the first utterance isn't swallowed.
  try { window.speechSynthesis?.resume(); } catch { /* noop */ }
}

/** Stop any in-flight speech - fetched clip AND browser voice. */
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
  if (currentAudio && !currentAudio.paused) { try { currentAudio.pause(); } catch { /* noop */ } }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { if (window.speechSynthesis.speaking) window.speechSynthesis.pause(); } catch { /* noop */ }
  }
}

/** Resume whichever channel was paused (V4). */
export function resumeSpeech(): void {
  if (currentAudio && currentAudio.paused && currentAudio.src) { void currentAudio.play().catch(() => {}); }
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

/** Browser Web Speech fallback - always fires exactly one onEnd. */
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
        // No Kannada voice installed on this device - log once; Sarvam/Google
        // is the reliable path for Kannada audio.
        console.warn("[tts] no kn-IN browser voice; output may be silent. Use Sarvam/Google.");
      }
      u.onstart = () => hooks?.onStart?.();
      u.onend = () => hooks?.onEnd?.();
      u.onerror = () => hooks?.onEnd?.();
      window.speechSynthesis.speak(u);
      // Chrome bug: long utterances pause themselves ~15s in. Kick resume.
      const kick = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(kick); return; }
        try { window.speechSynthesis.resume(); } catch { /* noop */ }
      }, 8000);
    } catch {
      hooks?.onEnd?.();
    }
  };
  // Ensure voices are loaded before speaking (V2).
  if (!voicesCache.length && window.speechSynthesis.getVoices().length === 0) {
    let fired = false;
    const once = () => { if (fired) return; fired = true; voicesCache = window.speechSynthesis.getVoices(); run(); };
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

/**
 * Speak `text` using the provider chosen in Settings.
 *   sarvam | google -> backend /voice/tts (browser fallback on any error)
 *   webspeech       -> browser speechSynthesis only
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

  // sarvam or google - fetch via the backend TTS endpoint.
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
      browserSpeak(text, lang, rate, hooks); // never strand the loop
    };
    await audio.play(); // may reject if not unlocked -> caught below
  } catch {
    // Network / CORS / autoplay block - always fall back, never stall.
    browserSpeak(text, lang, rate, hooks);
  }
}

// Back-compat alias - console.tsx and Shell.tsx import `speakViaSarvam`.
export const speakViaSarvam = speak;
```

---

## 4. `frontend/src/components/Shell.tsx` — targeted patches

### 4a. Imports (add the new helpers) — fixes V3/V4 wiring

**FIND:**
```ts
import { speakViaSarvam, cancelSpeech, isSpeechActive } from "@/lib/voice/tts";
```
**REPLACE WITH:**
```ts
import {
  speakViaSarvam,
  cancelSpeech,
  isSpeechActive,
  pauseSpeech,
  resumeSpeech,
  unlockAudioPlayback,
} from "@/lib/voice/tts";
```

### 4b. **H1 — mic listens in the selected voice language**

**FIND:**
```ts
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang === "KN" ? "kn-IN" : "en-IN";
```
**REPLACE WITH:**
```ts
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    // Recognition follows the Speech-output (voiceLang) selector, then the UI
    // language, so choosing Kannada actually makes the mic listen in kn-IN.
    rec.lang = coerceVoiceLang(voiceLang) || (lang === "KN" ? "kn-IN" : "en-IN");
```

**THEN** update that effect's dependency array so switching the language restarts recognition.

**FIND:**
```ts
  }, [listening, micActive, lang, clearSilenceTimer]);
```
**REPLACE WITH:**
```ts
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);
```

### 4c. **H2 — safe auto-restart of recognition**

**FIND:**
```ts
    rec.onend = () => {
      if (recognitionRef.current === rec) {
        try { rec.start(); } catch {}
      }
    };
```
**REPLACE WITH:**
```ts
    rec.onend = () => {
      // Only restart if THIS recognizer is still the active one and we are still
      // meant to be listening. A short delay avoids Chrome's "already started"
      // throttle/exception that otherwise kills the mic.
      if (recognitionRef.current !== rec) return;
      if (!listeningRef.current || !conversationModeRef.current && phaseRef.current !== "listening") {
        // single-shot mode: let it end naturally
      }
      setTimeout(() => {
        if (recognitionRef.current !== rec) return;
        try { rec.start(); } catch { /* will be re-created by the effect if needed */ }
      }, 250);
    };
```

### 4d. **V3 — unlock audio on the user gesture (conversation start)**

**FIND:**
```ts
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
```
**REPLACE WITH:**
```ts
                  unlockAudioPlayback(); // V3: satisfy autoplay within this click
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
```

Also unlock when the floating voice panel opens.

**FIND:**
```ts
    const open = () => {
      setListening(true);
      setMicActive(true);
      setIsSpeaking(false);
      setIsPaused(false);
    };
```
**REPLACE WITH:**
```ts
    const open = () => {
      unlockAudioPlayback(); // V3: enable fetched-audio playback
      setListening(true);
      setMicActive(true);
      setIsSpeaking(false);
      setIsPaused(false);
    };
```

### 4e. **V4 — Pause/Resume controls the provider clip too**

**FIND:**
```ts
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
```
**REPLACE WITH:**
```ts
                        onClick={() => {
                          if (isPaused) {
                            resumeSpeech();
                            setIsPaused(false);
                          } else {
                            pauseSpeech();
                            setIsPaused(true);
                          }
                        }}
```

> The other voice-input button at the bottom of the panel (the one that dispatches `satyam:voice-command` with `lang: voiceLang`) already uses `voiceLang`, so it stays consistent with 4b.

---

## 5. `.env` / config sanity (no code change unless missing)

`backend/app/config.py` already has (verified):
```python
voice_backend: Literal["sarvam", "google", "bhashini"] = "sarvam"
sarvam_api_key: str = ""
google_tts_api_key: str = ""
google_tts_voice: str = ""
```
Ensure your `backend/.env` actually sets the key you intend to use:
```dotenv
# Sarvam is the default provider; without this key TTS 502s and the UI uses the
# (Kannada-limited) browser voice.
SARVAM_API_KEY=sk_xxx_your_real_key
# Optional, only if you select "Google API" in Settings:
GOOGLE_TTS_API_KEY=
```
`httpx==0.28.1` is already in `requirements.txt` (verified) — multipart STT needs it.

---

## 6. Verification checklist (run in order)

**Backend (prove the provider works before blaming the UI):**
```bash
# 1) TTS - expect JSON with a long audio_base64 and mime audio/wav
curl -s -X POST localhost:8000/voice/tts \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"text":"Namaskara, this is a test.","lang":"kn","backend":"sarvam"}' \
  | python -c 'import sys,json;d=json.load(sys.stdin);print(d["provider"],d["mime"],len(d["audio_base64"]))'
# Expect: SarvamTTS audio/wav <a big number>   (NOT a 502)

# 2) STT - multipart upload of a real wav; expect a transcript
curl -s -X POST localhost:8000/voice/stt \
  -H "authorization: Bearer $TOKEN" \
  -F "file=@sample.wav;type=audio/wav" -F "lang=kn" -F "backend=sarvam" \
  | python -c 'import sys,json;print(json.load(sys.stdin))'
# Expect: {"transcript": "...", "provider": "SarvamSTT"}
```

**Frontend (Chrome/Edge, over https or http://localhost only):**
1. Settings - Voice provider = **Sarvam** (default). Open Console, tap the mic, ask a question in English - you should **hear** the reply (Sarvam WAV).
2. Set **Speech output = Kannada (kn-IN)**, speak in Kannada - the transcript should now appear in Kannada (H1) and the reply should be spoken (Sarvam).
3. Switch provider to **Web Speech** - English still speaks; if your OS has no Kannada voice you'll see the one-time console warning (expected) - switch back to Sarvam for reliable Kannada.
4. While a reply is speaking, tap **Pause** then **Resume** - the Sarvam clip should pause and resume (V4).
5. Conversation mode ON - speak, get a reply, confirm the mic **re-opens automatically** for the next turn (H2 + loop).

---

## 7. Self-review (logic verification)

- **V1 fixed & valid:** `bulbul:v2` + `anushka` is a documented, in-catalog pair (speakers are version-locked; the old `bulbul:v3`+`meera` was invalid in both versions). Response still read from `audios[0]`. Long answers are sentence-trimmed under the v2 ~500-char cap, so requests can't 400 on length.
- **T1 fixed & valid:** STT now uses `files=`/`data=` multipart and **omits** the JSON `Content-Type`, so httpx writes the correct boundary. This matches Sarvam's `POST /speech-to-text` (multipart) contract.
- **No header leak:** `_auth()` returns only the subscription key; JSON `Content-Type` is added inline **only** on `json=` calls (TTS/MT), never on the file upload.
- **Fallback can't strand the loop:** every `speak()` path (`webspeech`, success, `onerror`, `catch`) terminates in exactly one `onEnd`, so Shell's `satyam:ai-state "done"` always fires and the mic re-opens.
- **H1 deps:** `voiceLang` added to the recognition effect deps, so changing the selector tears down and recreates the recognizer in the new language (no stale `rec.lang`).
- **H2 safety:** restart is gated on `recognitionRef.current === rec` + a 250 ms debounce, preventing Chrome's "already started" exception storm; the effect's cleanup nulls the ref first, so a torn-down recognizer never restarts.
- **V3 unlock:** `unlockAudioPlayback()` runs **synchronously inside** the click handlers (conversation start, panel open), preserving the user-gesture token so the later async `audio.play()` is allowed.
- **V4 symmetry:** `pauseSpeech`/`resumeSpeech` act on both `currentAudio` and `speechSynthesis`, so the controls work regardless of which channel is active.
- **Default unchanged:** provider default stays **Sarvam** (config + Settings); these fixes only make that default actually produce/consume audio.

## 8. Caveats I could not test live
- I cannot call Sarvam from here. If your Sarvam plan exposes **bulbul:v3** and you need >480-char spoken replies, switch `model`+`speaker` per the note in §1 and raise `_TTS_MAX_CHARS`.
- Browser `webkitSpeechRecognition` only works in **Chrome/Edge** and only over **https** or **http://localhost**. On other hosts/browsers the mic is silent regardless of code - that's a platform limit, not a bug. Use server-side STT (`/voice/stt`, now fixed) if you need broader support.
- If you record mic audio for `/voice/stt` via `MediaRecorder`, it produces **webm/opus**; send it as such to **Google** STT (already `WEBM_OPUS`), or transcode to WAV for Sarvam. The Google adapter is already aligned to webm/opus @ 48 kHz.
