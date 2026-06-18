# Satyam — Voice Copilot Mic: **Browser ↔ Sarvam** toggle 🎙️

Adds a dedicated Settings switch for the **top-right voice copilot's microphone (Speech-to-Text)** engine. It is **completely separate** from the chat voice (`voiceBackend`) and the **chat-box mic** — only the copilot effect reads this new setting, so nothing about the chat box changes.

**Default = Browser** (lowest latency, live word-by-word captions). Switch to **Sarvam** anytime for best Kannada accuracy.

## Does the browser do Kannada?
Yes — Chrome/Edge Web Speech recognizes Kannada via `rec.lang = "kn-IN"`, so the browser path transcribes Kannada too. Caveat: browser Kannada accuracy is **weaker** than Sarvam Saaras v3 (which is purpose-built for Indic languages). That's exactly why this toggle exists:

| | **Browser** (default) | **Sarvam** |
|---|---|---|
| Latency | ⭐ lowest (live captions as you speak) | ~1.5s utterance wait + upload |
| English | Great | Great |
| Kannada | OK | ⭐ Best |
| On-screen text | Word-by-word live | Status → final phrase |
| Works in | Chrome / Edge | Any browser that can record audio |

> Brain stays **Gemini** and the spoken reply stays **Sarvam Bulbul** in *both* modes — this toggle only changes how your **microphone** is transcribed.

---

## 1) `frontend/src/components/SettingsDialog.tsx`

**1a.** Add the field to `EngineSettings` (note: this is a brand-new key, kept separate from `voiceBackend` so the chat voice is never affected):

```ts
// FIND
  voiceBackend: "sarvam" | "google" | "webspeech";
  dbSource: "cloud" | "local";
};

// REPLACE WITH
  voiceBackend: "sarvam" | "google" | "webspeech";
  /** Copilot (top-right) microphone STT engine — independent of the chat voice. */
  copilotStt: "browser" | "sarvam";
  dbSource: "cloud" | "local";
};
```

**1b.** Add the default (Browser, per your choice):

```ts
// FIND
  sqlEngine: "gemini",
  voiceBackend: "sarvam",

// REPLACE WITH
  sqlEngine: "gemini",
  voiceBackend: "sarvam",
  copilotStt: "browser", // lowest-latency live captions; switch to Sarvam for best Kannada
```

> `loadEngineSettings()` already does `{ ...defaultEngineSettings, ...JSON.parse(raw) }`, so existing users who never touched Settings automatically get `copilotStt: "browser"`.

**1c.** Add the picker UI (a new two-way selector right above the Database source block):

```tsx
// FIND
                {/* Database source */}

// REPLACE WITH
                {/* Copilot mic — Speech-to-Text engine (independent of the chat voice/mic) */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">{t("Voice copilot mic (Speech-to-Text)")}</label>
                  <p className="text-xs text-muted-foreground">{t("Engine for the top-right voice copilot only. Does not affect the chat box mic or the chat voice.")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: "browser" as const, label: t("Browser"), hint: t("Lowest latency · live captions") },
                      { id: "sarvam" as const, label: "Sarvam API", hint: t("Best Kannada accuracy") },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateEngine("copilotStt", opt.id)}
                        className={
                          "rounded-[5px] border-2 border-foreground px-3 py-2 text-left text-xs font-bold transition hover:translate-x-[2px] hover:translate-y-[2px] " +
                          (engines.copilotStt === opt.id
                            ? "bg-primary text-primary-foreground nb-shadow-sm"
                            : "bg-secondary-background text-foreground")
                        }
                      >
                        <span className="flex items-center gap-1">
                          {engines.copilotStt === opt.id && <Check className="h-3 w-3" />}
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block font-normal text-[10px] opacity-70">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Database source */}
```

---

## 2) `frontend/src/components/Shell.tsx`

**2a.** Import `loadEngineSettings` (alongside the existing `SettingsDialog` import):

```ts
// FIND
import { SettingsDialog } from "./SettingsDialog";
// REPLACE WITH
import { SettingsDialog, loadEngineSettings } from "./SettingsDialog";
```

**2b.** Make the copilot STT effect **branch** on the setting. Replace the entire copilot STT `useEffect` — the one that begins:

```ts
  useEffect(() => {
    if (!listening || !micActive) return;
    setFinalTranscript("");
    ...
```

…and ends with:

```ts
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);
```

**with this branching version** (Browser path = original Web Speech recognizer with live captions; Sarvam path = utterance-based Saaras v3):

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

    // Secure-context guard (shared): mic is blocked on plain http://<LAN-IP>.
    if (typeof window !== "undefined" && !window.isSecureContext &&
        location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
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
      window.dispatchEvent(new CustomEvent("satyam:voice-command", {
        detail: { text, lang: turnLang, rate: speechRateRef.current, speak: true },
      }));
    };

    // === OPTION A - BROWSER (Web Speech API) =================================
    // Lowest latency, live word-by-word captions. Kannada via rec.lang="kn-IN"
    // (Chrome / Edge only; Kannada accuracy is weaker than Sarvam).
    if (sttEngine === "browser") {
      const SR: any =
        (typeof window !== "undefined" &&
          ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
      if (!SR) {
        setSpeechError("This browser has no speech recognition. Use Chrome/Edge, or switch the copilot mic to Sarvam in Settings.");
        return;
      }
      console.debug("[voice] SpeechRecognition start", { voiceLang, uiLang: lang });

      const rec = new SR();
      rec.continuous = true; // keep listening until explicit stop
      rec.interimResults = true;
      // Concrete language hint; "auto" falls back to the UI language.
      rec.lang =
        voiceLang === "auto"
          ? (lang === "KN" ? "kn-IN" : "en-IN")
          : (coerceVoiceLang(voiceLang) || "en-IN");

      const armSilence = () => {
        if (turnSubmittedRef.current) return;
        clearSilenceTimer();
        // Auto-submit ~1.5s after speech stops.
        silenceTimerRef.current = setTimeout(() => {
          const text = `${liveFinalRef.current} ${liveInterimRef.current}`.trim();
          if (text) dispatchTurn(text);
        }, 1500);
      };

      rec.onstart = () => { setSpeechError(null); setCaptureStatus(null); };
      rec.onaudiostart = () => { setCaptureStatus(null); };
      rec.onspeechstart = () => { setInterimTranscript("\u2026"); };
      rec.onresult = (e: any) => {
        let interim = "", finals = "";
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
          try { rec.start(); } catch { /* effect re-creates on next render */ }
        }, 200);
      };

      recognitionRef.current = rec;
      sttSessionRef.current = {
        stop: () => {
          const text = `${liveFinalRef.current} ${liveInterimRef.current}`.trim();
          if (text && !turnSubmittedRef.current) dispatchTurn(text);
          try { rec.stop(); } catch { /* noop */ }
        },
        cancel: () => {
          recognitionRef.current = null;
          try { rec.onend = null; rec.stop(); } catch { /* noop */ }
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
        try { rec.onend = null; rec.stop(); } catch { /* noop */ }
        sttSessionRef.current = null;
      };
    }

    // === OPTION B - SARVAM (Saaras v3) ======================================
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
      backend: "sarvam", // pin Sarvam Saaras v3 as the voice-translation engine
      silenceMs: 1500, // auto-end the utterance ~1.5s after speech stops
      maxMs: 15000,
      callbacks: {
        onStatus: (s: string) => { if (!cancelled) setCaptureStatus(s); },
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
        onError: (msg: string) => { if (!cancelled) setSpeechError(msg); },
      },
    })
      .then((s) => {
        if (cancelled) { try { s.cancel(); } catch { /* noop */ } return; }
        session = s;
        recognitionRef.current = s; // keep the ref live for cleanup / orb-tap stop
        sttSessionRef.current = {
          stop: () => { try { s.stop(); } catch { /* noop */ } },
          cancel: () => { try { s.cancel(); } catch { /* noop */ } },
        };
      })
      .catch(() => {
        if (!cancelled) setSpeechError("Could not start the microphone. Reload and try again.");
      });

    return () => {
      cancelled = true;
      recognitionRef.current = null;
      clearSilenceTimer();
      try { session?.cancel(); } catch { /* noop */ }
      sttSessionRef.current = null;
    };
  }, [listening, micActive, lang, voiceLang, clearSilenceTimer]);
```

---

## Why the chat box is safe 🔒

- `copilotStt` is a **brand-new key** read in exactly one place: the **copilot STT effect** in `Shell.tsx`.
- The **chat-box mic** and **chat voice** continue to use `voiceBackend` (Sarvam/Google/Web Speech) exactly as before — untouched.
- Switching `copilotStt` only changes how the **top-right copilot** transcribes your mic. Brain (Gemini) + spoken reply (Sarvam Bulbul) are unchanged in both modes.

## Behaviour notes
- **Browser mode:** live captions appear as you talk; auto-submits ~1.5s after you stop, or tap the orb to send.
- **Sarvam mode:** shows “Hearing you…” → “Transcribing…” → final text; same auto-submit timing.
- Changing the setting takes effect on the **next time you open/re-arm the mic** (no reload needed).

## Verification (static analysis)
- `Shell.tsx`: braces **282/282**, brackets **99/99**, backticks **26 (even)** — balanced. Paren counter shows a benign −3 that is **identical before/after** the splice (lives in regex/emoji string literals); the inserted effect is itself paren-balanced. Confirmed a **single** copilot STT effect remains.
- `SettingsDialog.tsx`: braces **312/312**, brackets **110/110** — balanced.
- No compiler in the sandbox (offline) — run `tsc`/your build once applied.
