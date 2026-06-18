# Satyam — Voice Chat: Gemini Brain + Sarvam Voice + Copilot Mic Toggle (+ Chat-Mic Fix) 🎙️

> **Version 2** — supersedes v1 (`SATYAM_COPILOT_STT_TOGGLE.md`). Adds the **chat-box mic vs copilot separation bugfix** and consolidates everything we discussed about the new voice chat.

This document covers the **top-right voice copilot** only. The **chat-box mic** is a separate feature and is explicitly kept independent (see §5).

---

## 0. Architecture at a glance

| Concern | Engine | Notes |
|---|---|---|
| 🧠 Brain (LLM) | **Gemini** (`gemini-2.5-flash`) | Pinned per copilot turn so Settings can't downgrade it |
| 🔊 Speak replies (TTS) | **Sarvam Bulbul** | Pinned for copilot replies |
| 🎙️ Mic (STT) | **Browser** *(default)* or **Sarvam Saaras v3** | User-switchable in Settings (§3) |

- **Two separate mics exist:** the **top-right copilot** (conversational screen controller + data Q&A) and the **chat-box mic** (dictation into the chat input). They must never trigger each other (§5).
- Switching the copilot mic engine changes **only** how your microphone is transcribed. Brain (Gemini) and spoken reply (Sarvam) are unchanged in both modes.

---

## 1. Brain = Gemini, Voice translation = Sarvam (recap)

The copilot pipeline pins **Gemini** as the brain and **Sarvam** for voice. The chat box passes no overrides, so typed/chat-box turns continue to follow the Settings panel — fully back-compatible. (Backend routes already accept `brain_engine` / `voice_backend` / `backend`; ensure `GEMINI_API_KEY` and `SARVAM_API_KEY` are set so it doesn't fall into demo mode.)

---

## 2. Browser vs Sarvam for the copilot mic

**Does the browser do Kannada?** Yes — Chrome/Edge Web Speech recognizes Kannada via `rec.lang = "kn-IN"`. Caveat: browser Kannada accuracy is **weaker** than Sarvam Saaras v3 (purpose-built for Indic languages). That's why the toggle exists.

| | **Browser** (default) | **Sarvam** |
|---|---|---|
| Latency | ⭐ lowest (live captions as you speak) | ~1.5s utterance wait + upload |
| English | Great | Great |
| Kannada | OK | ⭐ Best |
| On-screen text | Word-by-word live | Status → final phrase |
| Works in | Chrome / Edge | Any browser that can record audio |

---

## 3. Feature: Settings toggle — Browser ↔ Sarvam (copilot mic)

Adds a dedicated **"Voice copilot mic (Speech-to-Text)"** switch in Settings → Models. **Default = Browser.** It is a brand-new key (`copilotStt`), kept separate from the chat voice (`voiceBackend`) so the chat box is never affected.

### 3a. `frontend/src/components/SettingsDialog.tsx` — add the field

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

### 3b. Add the default (Browser)

```ts
// FIND
  sqlEngine: "gemini",
  voiceBackend: "sarvam",

// REPLACE WITH
  sqlEngine: "gemini",
  voiceBackend: "sarvam",
  copilotStt: "browser", // lowest-latency live captions; switch to Sarvam for best Kannada
```

> `loadEngineSettings()` already does `{ ...defaultEngineSettings, ...JSON.parse(raw) }`, so existing users auto-inherit `copilotStt: "browser"`.

### 3c. Add the picker UI (two-way selector, above the Database source block)

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

### 3d. `frontend/src/components/Shell.tsx` — import `loadEngineSettings`

```ts
// FIND
import { SettingsDialog } from "./SettingsDialog";
// REPLACE WITH
import { SettingsDialog, loadEngineSettings } from "./SettingsDialog";
```

### 3e. `frontend/src/components/Shell.tsx` — branch the copilot STT effect

Replace the entire copilot STT `useEffect` (it begins `if (!listening || !micActive) return;` and ends with the deps `}, [listening, micActive, lang, voiceLang, clearSilenceTimer]);`) **with this branching version** (Browser = live-caption Web Speech recognizer; Sarvam = utterance-based Saaras v3):

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

## 4. Why the chat box stays safe 🔒

- `copilotStt` is read in **exactly one place**: the copilot STT effect in `Shell.tsx`.
- The **chat-box mic** and **chat voice** continue to use `voiceBackend` exactly as before — untouched.
- Switching `copilotStt` only changes how the **top-right copilot** transcribes your mic.

---

## 5. BUGFIX — the chat-box mic was opening the copilot (permanent fix)

### Root cause
The **chat-box mic** and the **top-right copilot** shared the **same event**. The chat-box mic button in `routes/console.tsx` ran `window.dispatchEvent(new Event("satyam:open-voice"))`, and the copilot in `Shell.tsx` listens for `satyam:open-voice` and opens itself. So tapping the chat mic launched the copilot. The fix gives the chat-box mic its **own local dictation** (fills the chat input only) and removes the shared-event dispatch.

### Fix prompt (paste into your coding agent)

> In `frontend/src/routes/console.tsx`, the chat-box mic button is wired to the SAME event that opens the top-right voice copilot (`satyam:open-voice`), so it opens the copilot instead of doing chat dictation. Fix it so the chat-box mic is fully independent: it should dictate speech into the chat textarea only, and must NEVER dispatch `satyam:open-voice` or touch any copilot state/events. Do not modify `Shell.tsx` or the copilot.
>
> **Edit 1 — add chat-dictation state.** Find:
> ```tsx
>   const [input, setInput] = useState("");
> ```
> Replace with:
> ```tsx
>   const [input, setInput] = useState("");
>   const [chatDictating, setChatDictating] = useState(false);
>   const chatRecRef = useRef<any>(null);
> ```
>
> **Edit 2 — add a self-contained dictation handler.** Insert this function inside the component (e.g. just above `function speak(`):
> ```tsx
>   // Chat-box dictation — fills ONLY the chat input. It must never open the
>   // top-right voice copilot (no "satyam:open-voice") or touch copilot state.
>   function toggleChatDictation() {
>     if (chatRecRef.current) {
>       try { chatRecRef.current.stop(); } catch { /* noop */ }
>       return; // onend clears the ref + flag
>     }
>     const SR: any =
>       (typeof window !== "undefined" &&
>         ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
>     if (!SR) {
>       alert("This browser has no speech recognition. Use Chrome or Edge.");
>       return;
>     }
>     const rec = new SR();
>     rec.continuous = true;
>     rec.interimResults = true;
>     rec.lang = lang === "KN" ? "kn-IN" : "en-IN";
>
>     const prefix = input.trim() ? input.trim() + " " : "";
>     let finalText = "";
>
>     rec.onresult = (e: any) => {
>       let interim = "";
>       for (let i = e.resultIndex; i < e.results.length; i++) {
>         const r = e.results[i];
>         if (r.isFinal) finalText += r[0].transcript + " ";
>         else interim += r[0].transcript;
>       }
>       setInput((prefix + finalText + interim).replace(/\s+/g, " ").trimStart());
>     };
>     rec.onerror = () => { /* swallow; onend cleans up */ };
>     rec.onend = () => {
>       chatRecRef.current = null;
>       setChatDictating(false);
>       setInput((prefix + finalText).replace(/\s+/g, " ").trim());
>     };
>
>     chatRecRef.current = rec;
>     setChatDictating(true);
>     try { rec.start(); } catch { chatRecRef.current = null; setChatDictating(false); }
>   }
> ```
>
> **Edit 3 — rewire the chat-box mic button (remove the `satyam:open-voice` dispatch).** Find:
> ```tsx
>               <button
>                 type="button"
>                 onClick={() => window.dispatchEvent(new Event("satyam:open-voice"))}
>                 className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
>                 aria-label={t("Voice")}
>               >
>                 <Mic className="h-4 w-4" />
>               </button>
> ```
> Replace with:
> ```tsx
>               <button
>                 type="button"
>                 onClick={toggleChatDictation}
>                 className={"grid h-8 w-8 place-items-center rounded-md " + (chatDictating ? "bg-destructive text-destructive-foreground animate-pulse" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
>                 aria-label={chatDictating ? t("Stop dictation") : t("Dictate into chat")}
>                 title={chatDictating ? t("Stop dictation") : t("Dictate into chat")}
>               >
>                 <Mic className="h-4 w-4" />
>               </button>
> ```
>
> **Guardrails (must hold after the fix):**
> 1. `grep -rn "satyam:open-voice" frontend/src` returns ONLY the listener in `Shell.tsx` — zero dispatchers from `console.tsx`/the chat composer.
> 2. The top-right copilot is opened ONLY by its own header mic button in `Shell.tsx` (direct `setListening(true)/setMicActive(true)`).
> 3. The chat-box mic only reads/writes `input` (and `chatDictating`/`chatRecRef`); it touches no copilot state (`listening`, `micActive`, `conversationMode`) and dispatches no copilot events.
> 4. `npx tsc --noEmit` passes.
>
> **Manual check:** click the chat-box mic → it turns red/pulses and your words appear in the chat textarea; the copilot does NOT open. Click the top-right mic → only the copilot opens.

**Why it's permanent:** both icons used to funnel through one shared event. After the fix, the chat-box mic has its own recognizer writing to the chat input, and `satyam:open-voice` has no dispatcher left except the copilot's own trigger — so the chat mic can never open the copilot again. Guardrail #1 (the grep) is the regression test.

---

## 6. Combined verification prompt

> Verify the Satyam voice chat changes. Report PASS/FAIL per item with file + line.
>
> **Copilot mic toggle**
> 1. `SettingsDialog.tsx`: `EngineSettings` has `copilotStt: "browser" | "sarvam"` (separate from `voiceBackend`); default is `"browser"`; `loadEngineSettings()` still spreads defaults over parsed JSON.
> 2. `SettingsDialog.tsx`: a "Voice copilot mic (Speech-to-Text)" picker with two options calls `updateEngine("copilotStt", ...)`.
> 3. `Shell.tsx`: imports `loadEngineSettings`; the copilot STT effect reads `const sttEngine = loadEngineSettings().copilotStt;` and branches `if (sttEngine === "browser")` (Web Speech, `interimResults`) else Sarvam (`startSttSession({ ..., backend: "sarvam" })`); deps are `[listening, micActive, lang, voiceLang, clearSilenceTimer]`; exactly ONE copilot STT effect.
> 4. In both modes the brain is pinned Gemini and replies use `speakViaSarvam(..., "sarvam")`.
>
> **Chat-mic separation**
> 5. `grep -rn "satyam:open-voice" frontend/src` → only the `Shell.tsx` listener (no dispatchers).
> 6. `console.tsx` chat-box mic calls `toggleChatDictation`, writes only to `input`, and never touches copilot state/events.
> 7. `grep -rn "copilotStt" frontend/src` → only `SettingsDialog.tsx` + `Shell.tsx`.
> 8. `npx tsc --noEmit` passes.
>
> **Manual:** chat-box mic dictates into the textarea (copilot stays closed); top-right mic opens only the copilot; in Browser mode captions stream live, in Sarvam mode it shows "Hearing you…" → final text.

Handy greps:
```bash
grep -rn "satyam:open-voice" frontend/src   # expect: Shell.tsx listener ONLY
grep -rn "copilotStt" frontend/src          # expect: SettingsDialog.tsx + Shell.tsx ONLY
grep -rn "voiceBackend" frontend/src        # chat voice/mic path — unchanged
```

---

## 7. Verification status (static analysis)

- **§3 toggle (already applied & verified in the working tree):** `Shell.tsx` braces 282/282, brackets 99/99, backticks even; `SettingsDialog.tsx` braces 312/312, brackets 110/110; single copilot STT effect; splice paren-neutral (benign −3 identical before/after, lives in string/emoji literals).
- **§5 chat-mic fix:** delivered as a prompt for your agent to apply to `console.tsx`; run guardrail greps + `tsc` after applying.
- No compiler in the sandbox (offline) — run your build once everything is applied.
