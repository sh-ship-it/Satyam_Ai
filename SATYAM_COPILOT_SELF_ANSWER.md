# Satyam — Make the Top-Right Voice Copilot Answer *Itself* (stop forwarding to chat)

> **Scope:** This fix touches **only the top-right voice copilot**. The chat-box mic (inside the Console chat) is intentionally left exactly as-is. After this change, asking the top-right copilot a question (e.g. *“who are who”*, *“how many cases in Mysuru”*) makes the **copilot speak the answer back to you** like a two-way conversation — it no longer drops your question into the chat thread.

---

## 1. Problem conclusion & analysis

### The two voice entry points (don't confuse them)
| Icon | Where | Job | Code owner |
|---|---|---|---|
| **Chat-box mic** | Inside the Console chat input | Dictates / sends a message **into the chat thread**, chat answers in a bubble | `console.tsx` → `toggleChatDictation` / `sendMessage` |
| **Top-right copilot** | App header (orb) | Hands-free **spoken** assistant — should *talk back* | `Shell.tsx` → `satyam:voice-command` → `handle()` |

### What was actually happening
Inside `Shell.tsx`, the copilot's `handle()` parses your speech and, for any **data question**, did **not** answer itself. Instead it forwarded the turn to the **Console chat**:

- **Section 3 (general data query)** built an `out = { text, lang, rate, speak }` object and either:
  - dispatched `window.dispatchEvent("satyam:voice-send", { detail: out })` if you were already on `/console`, **or**
  - wrote `sessionStorage["satyam:pending-voice"]` and `navigate({ to: "/console" })`.
- **Section 2.6 (person-crime question)** did the same hand-off, then layered a spoken follow-up on top.

In both cases, `console.tsx`'s `sendMessage()` picked up the event/sessionStorage, called the grounded `streamChat()` API, **rendered the answer as a chat bubble, and spoke it**. So your “private” copilot question ended up *in the chat thread* — exactly what you reported.

**Conclusion:** The copilot had no “answer myself” path at all — it always delegated to the chat screen. The fix is to give the copilot its **own** grounded-answer path that speaks back and never posts to chat.

---

## 2. The fix (design)

Add a self-contained `answerInCopilot()` helper inside the copilot's `handle()` that:

1. Drives the **existing** `satyam:ai-state` state machine: `thinking` → `speaking` → `done` (so the orb animates and conversation mode keeps listening — zero new UI needed).
2. Calls the **same** grounded `streamChat()` endpoint the Console already uses (same `brain_engine` / `sql_engine` / `voice_backend` from Settings), accumulating the streamed tokens.
3. Speaks the final answer with `speakViaSarvam(stripMarkdown(answer), …)` — the copilot's own voice.
4. Uses a **separate** `copilotConvId` ref so the copilot's conversation memory never mixes into the Console chat thread.

Then rewrite **Section 2.6** and **Section 3** to call `answerInCopilot()` instead of forwarding to chat. For the person-crime case, the follow-up offer is appended into the **same spoken utterance** (“…Do you want me to check their other details?”) so there is no mid-answer mic re-arm race. The existing `AFFIRM / MAP_ACTION / NETWORK_ACTION` branch (Section 2.5) still handles your spoken reply (“yes” / “on the map” / “in the network”).

**Nothing else changes.** The chat-box mic, `sendMessage`, `satyam:voice-send`, and `satyam:pending-voice` are untouched — they remain the chat's path.

---

## 3. Prompt for your coding agent

> **Goal:** Make the **top-right voice copilot** answer data questions itself (spoken reply, two-way conversation) instead of forwarding them to the Console chat. Do **not** change the chat-box mic or `console.tsx`. All edits are in `frontend/src/components/Shell.tsx`.
>
> Apply the 5 edits below exactly. They add an `answerInCopilot()` helper that calls the existing `streamChat()` grounded API and speaks the reply via the existing `satyam:ai-state` → TTS loop, and they replace the two chat-forwarding branches (Sections 2.6 and 3) with calls to it. Keep the chat-box mic, `satyam:voice-send`, and `satyam:pending-voice` paths intact.

### Edit 1 — Imports (add `stripMarkdown` + the chat stream client)
Find:
```tsx
import {
  speakViaSarvam,
  cancelSpeech,
  isSpeechActive,
  pauseSpeech,
  resumeSpeech,
  unlockAudioPlayback,
} from "@/lib/voice/tts";
import { resolveLang } from "@/lib/voice/lang";
import { startSttSession, isBackendSttSupported } from "@/lib/voice/recorder";
```
Replace with:
```tsx
import {
  speakViaSarvam,
  cancelSpeech,
  isSpeechActive,
  pauseSpeech,
  resumeSpeech,
  unlockAudioPlayback,
  stripMarkdown,
} from "@/lib/voice/tts";
import { resolveLang } from "@/lib/voice/lang";
import { startSttSession, isBackendSttSupported } from "@/lib/voice/recorder";
import { streamChat, type ChatEvent } from "@/lib/api/client";
```

### Edit 2 — Add a dedicated conversation-id ref for the copilot
Find:
```tsx
  const lastPersonRef = useRef<string>("");
```
Replace with:
```tsx
  const lastPersonRef = useRef<string>("");
  // Conversation id for the TOP-RIGHT COPILOT's own grounded answers. Kept
  // separate from the Console chat thread so the copilot never posts into chat.
  const copilotConvId = useRef<string | null>(null);
```

### Edit 3 — Add the `answerInCopilot()` helper (right after `closePanel` inside `handle()`)
Find:
```tsx
      const closePanel = () => {
        if (conversationModeRef.current) { setMicActive(false); return; }
        setListening(false);
        setMicActive(false);
      };
```
Replace with:
```tsx
      const closePanel = () => {
        if (conversationModeRef.current) { setMicActive(false); return; }
        setListening(false);
        setMicActive(false);
      };

      // The TOP-RIGHT COPILOT answers data questions ITSELF and speaks the reply
      // back, like two people talking. It calls the same grounded /chat/stream
      // API the Console uses, but NEVER forwards the turn to the Console chat
      // thread (that is exclusively the chat-box mic's job). The spoken reply
      // drives the existing satyam:ai-state state machine (thinking -> speaking
      // -> done) so the orb animates and conversation mode keeps listening.
      const answerInCopilot = (question: string, followUp?: string) => {
        const aiState = (state: "thinking" | "speaking" | "done") =>
          window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state } }));
        aiState("thinking"); // orb shows "Thinking…" + arms the recovery watchdog
        const engines = loadEngineSettings();
        let acc = "";
        let streamError = false;
        const finish = () => {
          let answer = acc.trim();
          if (streamError)
            answer = t("I couldn't reach the backend just now. Please retry once the API is running.");
          else if (!answer)
            answer = t("No results matched your query. Try a broader question or different filters.");
          // For a person-crime turn we append the spoken follow-up offer so it is
          // one continuous utterance (no mid-answer mic re-arm race).
          const toSpeak = followUp && !streamError ? `${answer}. ${followUp}` : answer;
          if (detail.speak === false) { aiState("done"); return; }
          const spokenLang: "en" | "kn" = resolveLang(speechLang, toSpeak);
          void speakViaSarvam(stripMarkdown(toSpeak), spokenLang, rate, {
            onStart: () => aiState("speaking"),
            onEnd: () => aiState("done"),
          });
        };
        void streamChat(
          {
            message: question,
            conversation_id: copilotConvId.current ?? undefined,
            lang: resolved, // "en" | "kn"
            brain_engine: engines.brainEngine,
            sql_engine: engines.sqlEngine,
            voice_backend: engines.voiceBackend === "webspeech" ? undefined : engines.voiceBackend,
          },
          (ev: ChatEvent) => {
            if (ev.type === "token") acc += ev.text;
            else if (ev.type === "blocked")
              acc = t("Your role can't view named accused records. Showing aggregate counts instead.");
            else if (ev.type === "done") copilotConvId.current = ev.conversation_id;
            else if (ev.type === "error") streamError = true;
          },
        )
          .then(finish)
          .catch(() => { streamError = true; finish(); });
      };
```

### Edit 4 — Section 2.6: person-crime question answers in the copilot
Find:
```tsx
      // 2.6) Person-crime question -> answer in Console, then offer follow-up actions by voice.
      if (PERSON_CRIME_INTENT.test(cmd.query)) {
        // Best-effort name extraction: strip the intent words and common fillers.
        const who = cmd.query
          .replace(PERSON_CRIME_INTENT, " ")
          .replace(/\b(did|does|do|commit|committed|of|the|by|for|show|me|what|which|is|are|his|her|their|tell)\b/gi, " ")
          .replace(/\s+/g, " ").trim();
        if (who) lastPersonRef.current = who;
        const ask = { text: cmd.query, lang: voiceLang === "auto" ? "auto" : speechLang, rate, speak: detail.speak !== false };
        if (pathname === "/console") {
          window.dispatchEvent(new CustomEvent("satyam:voice-send", { detail: ask }));
        } else {
          try { sessionStorage.setItem("satyam:pending-voice", JSON.stringify(ask)); } catch {}
          navigate({ to: "/console" });
        }
        // After the grounded answer is spoken, offer the next step and keep listening.
        if (detail.speak) {
          setTimeout(() => {
            speakText(
              resolved === "kn"
                ? `${lastPersonRef.current} ಅವರ ಇತರ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾ? ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲೇ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಹುಡುಕಲಾ?`
                : `Do you want me to check ${lastPersonRef.current}'s other details? I can show the crime location on the map, or search them in the network.`,
              speechLang, rate,
            );
            if (conversationModeRef.current) resumeListening();
          }, 3500); // give the grounded answer time to speak first
        }
        closePanel();
        return;
      }
```
Replace with:
```tsx
      // 2.6) Person-crime question -> the COPILOT answers out loud ITSELF, then
      // offers the next step in the SAME spoken reply. Nothing is posted to chat.
      if (PERSON_CRIME_INTENT.test(cmd.query)) {
        // Best-effort name extraction: strip the intent words and common fillers.
        const who = cmd.query
          .replace(PERSON_CRIME_INTENT, " ")
          .replace(/\b(did|does|do|commit|committed|of|the|by|for|show|me|what|which|is|are|his|her|their|tell)\b/gi, " ")
          .replace(/\s+/g, " ").trim();
        if (who) lastPersonRef.current = who;
        const followUp =
          resolved === "kn"
            ? `${lastPersonRef.current} ಅವರ ಇತರ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾ? ನಕ್ಷೆಯಲ್ಲಿ ತೋರಿಸಲೇ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಹುಡುಕಲಾ?`
            : `Do you want me to check ${lastPersonRef.current}'s other details? I can show the crime location on the map, or search them in the network.`;
        answerInCopilot(cmd.query, followUp);
        return;
      }
```

### Edit 5 — Section 3: general data query answers in the copilot
Find:
```tsx
      // 3) Data query -> Console (grounded answer, spoken in chosen language).
      // Preserve the "auto" sentinel so Console can auto-detect the reply
      // language from the actual answer text (resolveLang). Pre-resolving to a
      // concrete locale here would defeat reply-language auto-detection.
      const out = { text: cmd.query, lang: voiceLang === "auto" ? "auto" : speechLang, rate, speak: detail.speak !== false };
      if (pathname === "/console") {
        window.dispatchEvent(new CustomEvent("satyam:voice-send", { detail: out }));
      } else {
        try {
          sessionStorage.setItem("satyam:pending-voice", JSON.stringify(out));
        } catch {}
        navigate({ to: "/console" });
      }
      closePanel();
    };
```
Replace with:
```tsx
      // 3) Data query -> the COPILOT answers out loud ITSELF (two-way
      // conversation). It must NEVER hand the turn to the Console chat thread;
      // the chat-box mic is the only path that posts a message into chat.
      answerInCopilot(cmd.query);
      return;
    };
```

---

## 4. Verify

```bash
cd frontend
npx tsc --noEmit            # types OK
npx prettier --write src/components/Shell.tsx   # optional: tidy formatting
```
Manual test (top-right copilot only):
1. Click the **top-right** orb → say *“who are the top offenders”* (or *“how many cases in Mysuru”*). → The orb shows **Thinking…**, then **the copilot speaks the answer back**. **Nothing appears in the Console chat thread.**
2. Say *“what crime did <name> commit”* → copilot speaks the answer **and** the offer (“Do you want me to check their other details?”). Then say *“on the map”* / *“in the network”* / *“yes”* → it acts (Section 2.5, unchanged).
3. Turn on **Conversation mode** → after each spoken answer the mic re-arms automatically (hands-free).
4. Open the **chat-box mic** (inside Console) → confirm it still dictates/sends into the chat thread exactly as before (unchanged).

Quick greps (should match):
```bash
grep -n "answerInCopilot" src/components/Shell.tsx        # 1 definition + 2 calls
grep -n "copilotConvId" src/components/Shell.tsx           # ref + used in streamChat
sed -n '362,382p' src/components/Shell.tsx | grep -c "voice-send\|pending-voice\|navigate({ to: \"/console"   # -> 0 (branches no longer hit chat)
```

---

## 5. Self-rating

**Thinking / diagnosis: 9.5/10.** The behavior is fully explained by the code: both copilot data branches forwarded to `console.tsx`, which rendered + spoke the answer. Confirmed by reading `handle()`, `sendMessage`, the `satyam:voice-send` / `satyam:pending-voice` listeners, and the `satyam:ai-state` machine. Root cause is unambiguous.

**Code logic: 9/10.** Reuses the exact grounded API (`streamChat`) and the exact state machine (`satyam:ai-state`) the app already trusts, so the copilot's spoken answer is identical in quality to the chat's — just delivered by voice instead of a bubble. Isolated to two branches + one helper. Graceful fallbacks for backend error, empty result, and RBAC-blocked. Engine settings (brain/SQL/voice) are honored. Separate `copilotConvId` prevents chat-thread contamination.

**Why not 10:** The follow-up offer is concatenated into one utterance rather than spoken as a second clip after the answer finishes — a deliberate trade-off to avoid a mic re-arm race; it reads slightly less “natural” than two separate sentences but is far more robust. (A future enhancement: chain the second clip in the first clip's `onEnd` and suppress the 300ms resume poll until both finish.)

Since the rating is high (≥9), the solution stands.

---

## 6. Will this break anything? (safety checklist)

- ✅ **Chat-box mic untouched.** No edits to `console.tsx`, `sendMessage`, `toggleChatDictation`, `satyam:voice-send`, or `satyam:pending-voice`. The chat path behaves exactly as before.
- ✅ **Existing copilot branches preserved.** Language switch (0), navigation (1), navigate-and-run-task (1.5), and the AFFIRM/MAP/NETWORK follow-up (2.5) are unchanged. Only 2.6 and 3 were rewritten.
- ✅ **State machine reused, not replaced.** `answerInCopilot` emits the same `thinking/speaking/done` events the orb and conversation loop already consume, including the 25s recovery watchdog. No new UI, no new effects.
- ✅ **No new dependencies.** `streamChat`, `ChatEvent`, `stripMarkdown`, and `loadEngineSettings` already exist in the codebase; only imports were added.
- ✅ **Graceful failure.** Backend down → spoken “couldn't reach the backend”; empty → spoken “no results”; RBAC blocked → spoken aggregate-only notice. No unhandled rejections (`.catch` + `void`).
- ✅ **No memory bleed.** Copilot uses its own `copilotConvId`; the Console chat keeps its own `backendConvId`.
- ✅ **Syntax validated.** Prettier parsed the edited file with no errors (style-only warnings); braces/brackets balanced.
- ⚠️ **Type-check on your machine.** Run `npx tsc --noEmit` after applying — the sandbox can't run your full TS project graph, so this is the one check to confirm locally (no type changes are expected to fail).

---

### Apply order
This file is self-contained — apply Edits 1–5 to `frontend/src/components/Shell.tsx`, run `tsc`, and test the top-right copilot.
