import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  Database,
  Layers,
  MessageSquarePlus,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { BorderGlow } from "@/components/BorderGlow";
import { Globe } from "@/components/Globe";
import { Markdown } from "@/components/Markdown";
import { useI18n, useT } from "@/lib/i18n";
import { streamChat, type ChatEvent } from "@/lib/api/client";
import { loadEngineSettings } from "@/components/SettingsDialog";
import { cancelSpeech, isServerVoiceEnabled, speakViaSarvam } from "@/lib/voice/tts";
import { isBackendSttSupported, startSttSession, type SttSession } from "@/lib/voice/recorder";
import {
  generateId,
  generateTitle,
  loadConversations,
  saveConversations,
  type ChatLane,
  type ChatMessage,
  type Conversation,
} from "@/lib/chatStore";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask Satyam · Satyam" },
      {
        name: "description",
        content: "Dedicated conversational workspace for grounded crime-intelligence questions.",
      },
    ],
  }),
  component: Ask,
});

/**
 * Starter prompts — each one exercises a different grounded lane of the pipeline.
 *
 * The year is explicit rather than "this year" on purpose: `cases.fir_year` runs
 * 2021-2025, so a relative year resolves to a range with no rows and the empty
 * state opens on "Zero FIRs were recorded". Bump it when the seed gains a year.
 */
const SUGGESTIONS: { icon: typeof Database; text: string }[] = [
  { icon: Database, text: "How many FIRs were filed in Bengaluru City in 2025?" },
  { icon: Layers, text: "Show me theft hotspots across Karnataka" },
  { icon: Search, text: "Find cases similar to a chain snatching on a two-wheeler" },
  { icon: Database, text: "Which districts have the lowest clearance rate?" },
];

/** Per-screen voice preferences. Kept out of Settings so the chat owns its own. */
const LANG_KEY = "satyam.ask.lang";
const SPEAK_KEY = "satyam.ask.speak";

/** Human label for the pipeline lanes the backend reports as `tool` events. */
const LANE_LABEL: Record<string, string> = {
  router: "Intent",
  text_to_sql: "Text-to-SQL",
  rag: "Narrative search",
  "analytics.hotspots": "Hotspots",
  "analytics.network": "Link analysis",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Ask() {
  const t = useT();
  const { lang } = useI18n();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Voice: one explicit language drives the answer, the speech and the mic ──
  // Seeded from the global EN/KN toggle, then overridden by this screen's own
  // choice. Auto-detection from the typed script is deliberately NOT applied:
  // the officer picked a language, so a Kannada name typed into an English
  // session must not silently flip the whole answer.
  const [chatLang, setChatLang] = useState<"en" | "kn">(lang === "KN" ? "kn" : "en");
  const [speakOut, setSpeakOut] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const backendConvId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sttRef = useRef<SttSession | null>(null);
  const speakOutRef = useRef(false);
  const chatLangRef = useRef<"en" | "kn">("en");
  const engineLabel = loadEngineSettings().brainEngine;

  // Refs shadow the two voice settings so the streaming callback reads the value
  // that is current when the answer lands, not the one captured at send time.
  useEffect(() => {
    speakOutRef.current = speakOut;
  }, [speakOut]);
  useEffect(() => {
    chatLangRef.current = chatLang;
  }, [chatLang]);

  // Hydrate the persisted voice prefs after mount — localStorage is unavailable
  // during SSR, so reading it in a useState initialiser would break the render.
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang === "en" || savedLang === "kn") setChatLang(savedLang);
      const savedSpeak = localStorage.getItem(SPEAK_KEY);
      setSpeakOut(savedSpeak == null ? isServerVoiceEnabled() : savedSpeak === "1");
    } catch {
      setSpeakOut(isServerVoiceEnabled());
    }
  }, []);

  // Drop the mic and silence any clip when the screen unmounts.
  useEffect(
    () => () => {
      try {
        sttRef.current?.cancel();
      } catch {
        /* already closed */
      }
      cancelSpeech();
    },
    [],
  );

  // ── Bootstrap: always open on a fresh conversation ────────────────────────
  // Past conversations stay in the sidebar to reopen by hand, but opening the
  // screen never resumes one. Blank shells left by earlier visits are dropped
  // first, otherwise every open would stack another empty row into history.
  useEffect(() => {
    const saved = loadConversations().filter((c) => c.messages.length > 0);
    const conv: Conversation = {
      id: generateId(),
      title: t("New conversation"),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = [conv, ...saved];
    setConversations(next);
    setActiveId(conv.id);
    setMessages([]);
    backendConvId.current = null;
    saveConversations(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-grow the composer up to a ceiling, then let it scroll.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  // Stick to the bottom only when the reader is already there, so a scroll-back
  // through a long answer is not yanked away by the next token.
  //
  // A conversation *switch* is the exception and has to be detected separately.
  // The "already at the bottom" test is measured against the container's live
  // scrollTop, which on switch is still the position inherited from the previous
  // thread — usually 0. Against the newly-rendered, much taller transcript that
  // reads as "scrolled far from the bottom", so the nudge was skipped and
  // reopening a chat from history landed on its oldest message. There is no
  // scroll position worth preserving across a switch: the reader wants the newest
  // message, so jump unconditionally.
  const scrolledConvRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrolledConvRef.current !== activeId) {
      scrolledConvRef.current = activeId;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 160) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  const persist = useCallback(
    (next: ChatMessage[], convId?: string | null) => {
      const targetId = convId ?? activeId;
      if (!targetId) return;
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== targetId) return c;
          const firstUser = next.find((m) => m.role === "user");
          const autoTitle = firstUser && c.title === t("New conversation");
          return {
            ...c,
            messages: next,
            updatedAt: new Date().toISOString(),
            title: autoTitle ? generateTitle(firstUser.text) : c.title,
          };
        });
        saveConversations(updated);
        return updated;
      });
    },
    [activeId, t],
  );

  /**
   * Read an answer aloud in the language selected in the composer.
   *
   * `force` is for voice turns, which always speak. Typed turns speak only when
   * the in-chat speaker is on — the global Settings provider is consulted for
   * WHICH engine to use, never for WHETHER to speak.
   */
  function speak(text: string, force = false) {
    if (!force && !speakOutRef.current) return;
    if (!text.trim()) return;
    const emit = (state: "speaking" | "done") =>
      window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state } }));
    void speakViaSarvam(text, chatLangRef.current, 1, {
      onStart: () => {
        setSpeaking(true);
        emit("speaking");
      },
      onEnd: () => {
        setSpeaking(false);
        emit("done");
      },
    });
  }

  function stopSpeaking() {
    cancelSpeech();
    setSpeaking(false);
    window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state: "done" } }));
  }

  function toggleSpeakOut() {
    setSpeakOut((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      if (!next) stopSpeaking();
      return next;
    });
  }

  function pickLang(next: "en" | "kn") {
    if (next === chatLang) return;
    setChatLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* best-effort */
    }
    // A clip already playing is in the old language — drop it rather than let it
    // finish and contradict the newly selected one.
    stopSpeaking();
  }

  /**
   * Dictate into the composer using the SAME backend STT the voice copilot uses
   * (Sarvam Saaras via `POST /voice/stt`), not the browser's SpeechRecognition.
   * That matters here: browser recognition is unreliable for `kn-IN` on desktop,
   * and this screen is explicitly bilingual.
   *
   * The transcript fills the composer instead of sending straight away — a
   * misheard station or person name changes the query, so the officer reviews it.
   */
  async function toggleMic() {
    if (sttRef.current) {
      try {
        sttRef.current.stop(); // transcribe what was captured so far
      } catch {
        /* session already finished */
      }
      return;
    }
    if (!isBackendSttSupported()) {
      setMicError(t("This browser cannot capture audio. Use Chrome or Edge."));
      return;
    }
    setMicError(null);
    setMicStatus(t("Starting…"));
    setListening(true);
    const finish = () => {
      sttRef.current = null;
      setListening(false);
      setMicStatus(null);
    };
    try {
      sttRef.current = await startSttSession({
        lang: chatLang,
        callbacks: {
          onStatus: (s) => setMicStatus(s),
          onSpeechStart: () => setMicStatus(t("Listening…")),
          onResult: (transcript) => {
            finish();
            const heard = (transcript || "").trim();
            if (!heard) {
              setMicError(t("Nothing was transcribed. Try again, a little closer to the mic."));
              return;
            }
            setInput((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard));
            taRef.current?.focus();
          },
          onError: (message) => {
            finish();
            setMicError(message);
          },
        },
      });
    } catch (err) {
      finish();
      setMicError((err as Error)?.message || t("Could not start the microphone."));
    }
  }

  const send = useCallback(
    async (raw: string, opts?: { speak?: boolean; lang?: string }) => {
      const text = raw.trim();
      if (!text || streaming) return;

      const base: ChatMessage[] = [...messages, { role: "user", text }];
      setMessages([...base, { role: "ai", text: "", streaming: true }]);
      persist(base);
      setInput("");
      setStreaming(true);

      // The composer's selector is the source of truth. A hand-off from another
      // screen may carry its own locale, and that wins for that one turn.
      const reqLang: "en" | "kn" = opts?.lang
        ? opts.lang.toLowerCase().startsWith("kn")
          ? "kn"
          : "en"
        : chatLang;
      const engines = loadEngineSettings();

      let acc = "";
      let spoken = "";
      let blocked = false;
      let failed = false;
      const citations: string[] = [];
      const lanes: ChatLane[] = [];

      const paint = () =>
        setMessages([
          ...base,
          {
            role: "ai",
            text: acc,
            citations: citations.length ? [...citations] : undefined,
            lanes: lanes.length ? [...lanes] : undefined,
            streaming: true,
          },
        ]);

      const settle = (finalText: string, spokenText?: string) => {
        const final: ChatMessage[] = [
          ...base,
          {
            role: "ai",
            text: finalText,
            citations: citations.length ? [...citations] : undefined,
            lanes: lanes.length ? [...lanes] : undefined,
          },
        ];
        setMessages(final);
        persist(final);
        setStreaming(false);
        abortRef.current = null;
        // Only a voice-initiated turn forces speech. The presence of a backend
        // [SPEAK] block must NOT override an officer who switched voice off.
        if (spokenText) speak(spokenText, !!opts?.speak);
      };

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        await streamChat(
          {
            message: text,
            conversation_id: backendConvId.current ?? undefined,
            lang: reqLang,
            brain_engine: engines.brainEngine,
            sql_engine: engines.sqlEngine,
            voice_backend: engines.voiceBackend === "webspeech" ? undefined : engines.voiceBackend,
          },
          (ev: ChatEvent) => {
            if (ev.type === "token") acc += ev.text;
            else if (ev.type === "speak") spoken = ev.text ?? "";
            else if (ev.type === "citation") citations.push(ev.label || ev.ref);
            else if (ev.type === "tool") {
              // Only the "end" event carries the lane's result (SQL, hit counts).
              if (ev.status === "end") lanes.push({ name: ev.name, detail: ev.detail });
            } else if (ev.type === "blocked") {
              blocked = true;
              acc = t(
                "Your role can't view named accused records. Showing aggregate counts instead.",
              );
            } else if (ev.type === "done") backendConvId.current = ev.conversation_id;
            else if (ev.type === "error") failed = true;
            paint();
          },
          ctrl.signal,
        );
      } catch (err) {
        // A user-pressed Stop is not an error — keep whatever streamed so far.
        if ((err as { name?: string })?.name === "AbortError") {
          settle(acc.trim() || t("Stopped."));
          return;
        }
        settle(t("I couldn't reach the backend just now. Please retry once the API is running."));
        return;
      }

      if (failed) {
        settle(t("I couldn't reach the backend just now. Please retry once the API is running."));
        return;
      }
      if (blocked) {
        settle(acc);
        return;
      }
      if (!acc.trim()) {
        const empty = t(
          "No results matched your query. Try a broader question or different filters.",
        );
        settle(empty, empty);
        return;
      }
      settle(acc, spoken || acc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, streaming, chatLang, persist, t],
  );

  // A question handed off from another screen (Transcripts, Forecast, voice nav).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("satyam:pending-voice");
      if (!raw) return;
      sessionStorage.removeItem("satyam:pending-voice");
      const d = JSON.parse(raw);
      if (d && typeof d.text === "string" && d.text.trim()) {
        setTimeout(() => void send(d.text.trim(), { speak: d.speak !== false, lang: d.lang }), 90);
      }
    } catch {
      /* nothing queued */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    abortRef.current?.abort();
  }

  function newChat() {
    if (streaming) stop();
    const conv: Conversation = {
      id: generateId(),
      title: t("New conversation"),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setConversations((prev) => {
      const next = [conv, ...prev];
      saveConversations(next);
      return next;
    });
    setActiveId(conv.id);
    setMessages([]);
    backendConvId.current = null;
  }

  function openConv(id: string) {
    if (streaming) stop();
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveId(id);
    setMessages(conv.messages);
    backendConvId.current = null;
  }

  function deleteConv(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConversations(next);
      if (id === activeId) {
        setActiveId(next[0]?.id ?? null);
        setMessages(next[0]?.messages ?? []);
        backendConvId.current = null;
      }
      return next;
    });
  }

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? t("New conversation");
  const isEmpty = messages.length === 0;

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 bg-background">
        {/* ── History sidebar ──────────────────────────────────────────────── */}
        {sidebarOpen && (
          <aside className="flex w-[260px] shrink-0 flex-col border-r-2 border-foreground bg-secondary-background">
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-extrabold">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("Ask Satyam")}
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                title={t("Hide history")}
                aria-label={t("Hide history")}
                className="rounded-[5px] p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="px-3">
              <button
                onClick={newChat}
                className="nb-press flex w-full items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary px-3 py-2 text-xs font-bold text-primary-foreground nb-shadow-sm"
              >
                <MessageSquarePlus className="h-4 w-4" />
                {t("New chat")}
              </button>
            </div>

            <div className="mt-4 px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("Recents")}
            </div>
            <div className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
              {conversations.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t("No conversations yet.")}
                </p>
              )}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-[5px] px-2 py-1.5 transition ${
                    c.id === activeId ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                >
                  <button
                    onClick={() => openConv(c.id)}
                    className="min-w-0 flex-1 text-left"
                    title={c.title}
                  >
                    <div className="truncate text-xs font-semibold text-foreground">{c.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {relativeTime(c.updatedAt)}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteConv(c.id)}
                    title={t("Delete conversation")}
                    aria-label={t("Delete conversation")}
                    className="shrink-0 rounded-[5px] p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* ── Conversation column ──────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                title={t("Show history")}
                aria-label={t("Show history")}
                className="rounded-[5px] p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 truncate text-xs font-semibold text-foreground">
              {activeTitle}
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <span className="rounded-[5px] border border-border px-1.5 py-0.5">
                {engineLabel}
              </span>
              <span className="rounded-[5px] border border-border px-1.5 py-0.5">
                {chatLang === "kn" ? "kn-IN" : "en-IN"}
              </span>
              {speakOut && (
                <span className="flex items-center gap-1 rounded-[5px] border border-border px-1.5 py-0.5">
                  <Volume2 className="h-3 w-3" />
                  {speaking ? t("speaking") : t("voice on")}
                </span>
              )}
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden">
            {/*
              Decorative globe. It sits outside the scroll container on purpose:
              placed inside, it would scroll away with the transcript, and the
              brief here is that it stays put while the conversation runs.

              `pointer-events-none` is what makes that safe — the transcript is
              layered on top, and an interactive canvas underneath would swallow
              text selection and wheel gestures aimed at the messages.

              It dims once there are messages: a watermark that reads nicely
              behind an empty state is noise behind body copy someone is
              actually reading.
            */}
            <div
              // Dark mode needs a much lower opacity than light. The globe draws
              // light dots, so on a dark page it is high-contrast against the
              // background *and* against the text sitting over it — at the light
              // value it washed the headline out completely.
              className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${
                isEmpty
                  ? "opacity-[0.34] dark:opacity-[0.13]"
                  : "opacity-[0.10] dark:opacity-[0.05]"
              }`}
            >
              {/*
                Sized off the pane's height rather than a fixed pixel width, so
                it scales with the window; `aspect-square` turns that height back
                into the width.

                It is deliberately larger than the pane (130%) and the radial
                mask fades it to nothing before it reaches the pane edge. That
                combination is what lets it be big without reading as a cut-off
                arc: the sphere's silhouette never meets the hard clip, it has
                already faded out by then.
              */}
              <Globe className="h-[130%] w-auto [mask-image:radial-gradient(circle_at_50%_50%,#000_30%,transparent_58%)]" />
            </div>

            <div ref={scrollRef} className="relative h-full overflow-y-auto">
              {isEmpty ? (
                <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-6">
                  <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground nb-shadow-sm">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
                    {t("What can I look up for you?")}
                  </h1>
                  <p className="mt-2 text-center text-sm text-muted-foreground">
                    {t(
                      "Ask in English or Kannada. Every answer is drawn from records your rank is cleared to see.",
                    )}
                  </p>
                  <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map(({ icon: Icon, text }) => (
                      <button
                        key={text}
                        onClick={() => void send(t(text))}
                        className="nb-press flex items-start gap-2.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-2.5 text-left text-xs font-semibold text-foreground nb-shadow-sm"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{t(text)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl space-y-7 px-6 py-8">
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <UserTurn key={i} text={m.text} />
                    ) : (
                      <AiTurn
                        key={i}
                        text={m.text}
                        citations={m.citations}
                        lanes={m.lanes}
                        streaming={m.streaming}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Composer ───────────────────────────────────────────────────── */}
          <div className="shrink-0 px-6 pb-5">
            <div className="mx-auto w-full max-w-3xl">
              <BorderGlow className="rounded-[10px] border-2 border-foreground bg-secondary-background nb-shadow-sm">
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  rows={1}
                  placeholder={
                    chatLang === "kn"
                      ? "ಎಫ್‌ಐಆರ್, ಹಾಟ್‌ಸ್ಪಾಟ್ ಅಥವಾ ಸಂಪರ್ಕಗಳ ಬಗ್ಗೆ ಕೇಳಿ…"
                      : t("Ask about FIRs, hotspots, narratives or links…")
                  }
                  aria-label={t("Message Satyam")}
                  className="max-h-[220px] w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                  {/* Answer + speech + dictation language. One control, three effects. */}
                  <div
                    role="group"
                    aria-label={t("Answer language")}
                    className="flex overflow-hidden rounded-[5px] border-2 border-foreground"
                  >
                    {(
                      [
                        ["en", "EN"],
                        ["kn", "ಕನ್ನಡ"],
                      ] as const
                    ).map(([code, label]) => (
                      <button
                        key={code}
                        onClick={() => pickLang(code)}
                        aria-pressed={chatLang === code}
                        title={
                          code === "kn"
                            ? t("Answer and speak in Kannada")
                            : t("Answer and speak in English")
                        }
                        className={`px-2 py-1 text-[11px] font-bold transition ${
                          chatLang === code
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Read answers aloud. Independent of the global Settings provider,
                      which only decides WHICH engine speaks. */}
                  <button
                    onClick={toggleSpeakOut}
                    aria-pressed={speakOut}
                    title={speakOut ? t("Voice replies on") : t("Voice replies off")}
                    aria-label={speakOut ? t("Turn voice replies off") : t("Turn voice replies on")}
                    className={`nb-press grid h-7 w-7 place-items-center rounded-[5px] border-2 border-foreground transition ${
                      speakOut
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary-background text-muted-foreground"
                    }`}
                  >
                    {speakOut ? (
                      <Volume2 className="h-3.5 w-3.5" />
                    ) : (
                      <VolumeX className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {speaking && (
                    <button
                      onClick={stopSpeaking}
                      title={t("Stop speaking")}
                      aria-label={t("Stop speaking")}
                      className="flex items-center gap-1 rounded-[5px] border border-border px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Square className="h-3 w-3" />
                      {t("Stop")}
                    </button>
                  )}

                  <span className="ml-auto" />

                  {/* Dictation — fills the composer, never auto-sends. */}
                  <button
                    onClick={() => void toggleMic()}
                    aria-pressed={listening}
                    title={listening ? t("Stop dictation") : t("Dictate a question")}
                    aria-label={listening ? t("Stop dictation") : t("Dictate a question")}
                    className={`nb-press grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground transition ${
                      listening
                        ? "animate-pulse bg-destructive text-destructive-foreground"
                        : "bg-secondary-background text-foreground"
                    }`}
                  >
                    <Mic className="h-4 w-4" />
                  </button>

                  {streaming ? (
                    <button
                      onClick={stop}
                      title={t("Stop generating")}
                      aria-label={t("Stop generating")}
                      className="nb-press grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-destructive text-destructive-foreground nb-shadow-sm"
                    >
                      <Square className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void send(input)}
                      disabled={!input.trim()}
                      title={t("Send")}
                      aria-label={t("Send")}
                      className="nb-press grid h-8 w-8 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground nb-shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </BorderGlow>
              {(micStatus || micError) && (
                <p
                  role="status"
                  aria-live="polite"
                  className={`mt-2 text-center text-[11px] ${
                    micError ? "font-semibold text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {micError ?? micStatus}
                </p>
              )}
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                {t("Enter to send · Shift+Enter for a new line")} ·{" "}
                {t(
                  "Answers are grounded in RLS-scoped records and logged to the audit chain. Verify before acting.",
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[10px] border border-border bg-muted px-4 py-2.5 text-[15px] leading-6 text-foreground">
        {text}
      </div>
    </div>
  );
}

function AiTurn({
  text,
  citations,
  lanes,
  streaming,
}: {
  text: string;
  citations?: string[];
  lanes?: ChatLane[];
  streaming?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-full border-2 border-foreground bg-primary text-[9px] font-extrabold text-primary-foreground">
          SY
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Satyam
        </span>
      </div>

      {/* Same bubble treatment as UserTurn (border + bg-muted), so both sides of the
          conversation read as matching surfaces. ml-8 keeps the alignment the old
          pl-8 gave, under the SY avatar. */}
      <div className="ml-8 max-w-[85%] rounded-[10px] border border-border bg-muted px-4 py-2.5 text-[15px] leading-7 text-foreground">
        <Markdown>{text}</Markdown>
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-primary align-middle" />
        )}
      </div>

      {!!lanes?.length && (
        <div className="mt-3 pl-8">
          <details className="rounded-[5px] border border-border bg-card/60">
            <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("How this was answered")} · {lanes.length}
            </summary>
            <div className="space-y-1.5 border-t border-border px-2.5 py-2">
              {lanes.map((l, i) => (
                <div key={`${l.name}-${i}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-foreground">
                    {LANE_LABEL[l.name] ?? l.name}
                  </div>
                  {l.detail && (
                    <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
                      {l.detail}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {!!citations?.length && (
        <div className="mt-2 flex flex-wrap gap-1 pl-8">
          {citations.map((c) => (
            <span
              key={c}
              className="rounded-[5px] border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
            >
              ↳ {c}
            </span>
          ))}
        </div>
      )}

      {!streaming && !!text && (
        <div className="mt-2 pl-8">
          <button
            onClick={copy}
            title={t("Copy answer")}
            aria-label={t("Copy answer")}
            className="flex items-center gap-1 rounded-[5px] px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
      )}
    </div>
  );
}
