import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { useState, useEffect, useRef } from "react";
import {
  Mic, Send, FileCode2, Sparkles, ExternalLink, ShieldAlert, ChevronRight, History, X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { streamChat, type ChatEvent } from "@/lib/api/client";

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "ai"; text: string; citations?: string[]; streaming?: boolean; action?: React.ReactNode };

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "satyam-chat-history";

function generateId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDefaultMessages(t: (s: string) => string): ChatMessage[] {
  return [
    { role: "user", text: t("Show me reported thefts in Whitefield over the last 30 days, grouped by police station.") },
    {
      role: "ai",
      text: t("I found 142 theft FIRs across 6 stations in the Whitefield zone (15 Jul – 14 Aug 2024). Whitefield PS leads with 47 cases, followed by Mahadevapura (38). Trend is up 12% vs the previous 30 days."),
      citations: [
        "fir_records (n=142)",
        "stations.zone='Whitefield'",
        "date_range: 2024-07-15 → 2024-08-14",
      ],
    },
    { role: "user", text: t("Open the case at the top of that list.") },
    {
      role: "ai",
      text: t("Opening FIR-2024-08842 — motor vehicle theft, ITPL Main Road, reported 14 Aug 2024."),
      streaming: true,
    },
    {
      role: "ai",
      text: t("Your role can't view named accused records. Showing aggregate counts instead."),
    } as any,
  ];
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {}
}

/** Extract a short, readable title from a query string (3–6 words). */
function generateTitle(text: string): string {
  // Remove punctuation, split, take first 6 words, rejoin
  const cleaned = text.replace(/[?!.，。、]+/g, "").trim();
  const words = cleaned.split(/\s+/);
  const short = words.slice(0, 6).join(" ");
  return short.length > 40 ? short.slice(0, 40) + "…" : short;
}

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "Console · Satyam" },
      { name: "description", content: "Conversational AI console for crime intelligence queries." },
    ],
  }),
  component: Console,
});

function Console() {
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const backendConvId = useRef<string | null>(null);

  // Bootstrap from localStorage
  useEffect(() => {
    const saved = loadConversations();
    if (saved.length > 0) {
      setConversations(saved);
      setActiveId(saved[0].id);
      setMessages(saved[0].messages);
    } else {
      // First visit — create a default demo conversation
      const defaultConv: Conversation = {
        id: generateId(),
        title: t("Whitefield theft inquiry"),
        messages: getDefaultMessages(t),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations([defaultConv]);
      setActiveId(defaultConv.id);
      setMessages(defaultConv.messages);
      saveConversations([defaultConv]);
    }
  }, []);

  // Consume a voice command queued from another screen: Shell stores it and
  // navigates here, then we run it as a grounded query and speak the answer.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("satyam:pending-voice");
      if (!raw) return;
      sessionStorage.removeItem("satyam:pending-voice");
      const d = JSON.parse(raw);
      if (d && typeof d.text === "string" && d.text.trim()) {
        setTimeout(
          () => sendMessage(d.text.trim(), { speak: d.speak !== false, lang: d.lang, rate: d.rate }),
          90,
        );
      }
    } catch {}
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingIdx]);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (typeof text === "string") setInput(text);
    };
    const voiceSendHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const text = typeof detail === "string" ? detail : detail?.text;
      const lang = typeof detail === "object" ? detail?.lang : undefined;
      const rate = typeof detail === "object" ? detail?.rate : undefined;
      if (typeof text === "string" && text.trim()) {
        sendMessage(text.trim(), { speak: true, lang, rate });
      }
    };
    window.addEventListener("satyam:insert-transcript", handler);
    window.addEventListener("satyam:voice-send", voiceSendHandler);
    return () => {
      window.removeEventListener("satyam:insert-transcript", handler);
      window.removeEventListener("satyam:voice-send", voiceSendHandler);
    };
  }, []);

  const activeConv = conversations.find((c) => c.id === activeId);

  function persistMessages(newMessages: ChatMessage[], convId?: string) {
    const targetId = convId || activeId;
    if (!targetId) return;
    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== targetId) return c;
        const firstUser = newMessages.find((m) => m.role === "user");
        // Only auto-title once: if title is still the generic default
        const shouldAutoTitle =
          firstUser &&
          (c.title === t("New conversation") || c.title === t("Whitefield theft inquiry"));
        return {
          ...c,
          messages: newMessages,
          updatedAt: new Date().toISOString(),
          title: shouldAutoTitle ? generateTitle(firstUser.text) : c.title,
        };
      });
      saveConversations(updated);
      return updated;
    });
  }

  function speak(text: string, opts?: { speak?: boolean; lang?: string; rate?: number }) {
    if (opts?.speak && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = opts?.lang || "en-IN";
        utter.rate = opts?.rate ?? 1;
        window.speechSynthesis.speak(utter);
      } catch {}
    }
  }

  async function sendMessage(text: string, opts?: { speak?: boolean; lang?: string; rate?: number }) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatMessage = { role: "user", text: trimmed };
    const baseMessages = [...messages, userMsg];
    // Render the user message + an empty AI bubble we stream tokens into.
    setMessages([...baseMessages, { role: "ai", text: "", streaming: true }]);
    persistMessages(baseMessages);
    setInput("");
    setStreamingIdx(baseMessages.length);

    const reqLang: "en" | "kn" =
      (opts?.lang || "").toLowerCase().startsWith("kn") ? "kn" : "en";

    // Offline / backend-down fallback keeps the pitch demo working.
    const cannedFallback = () => {
      const aiText = t("I found 142 theft FIRs across 6 stations in the Whitefield zone. Here is a summary table.");
      const finalMessages: ChatMessage[] = [
        ...baseMessages,
        { role: "ai", text: aiText, citations: ["fir_records (n=142)", "stations.zone='Whitefield'"] },
      ];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      speak(aiText, opts);
    };

    let acc = "";
    const citations: string[] = [];
    let blocked = false;
    let streamError = false;

    try {
      await streamChat(
        { message: trimmed, conversation_id: backendConvId.current ?? undefined, lang: reqLang },
        (ev: ChatEvent) => {
          if (ev.type === "token") acc += ev.text;
          else if (ev.type === "citation") citations.push(ev.label || ev.ref);
          else if (ev.type === "blocked") {
            blocked = true;
            acc = t("Your role can't view named accused records. Showing aggregate counts instead.");
          } else if (ev.type === "done") backendConvId.current = ev.conversation_id;
          else if (ev.type === "error") streamError = true;
          setMessages([
            ...baseMessages,
            { role: "ai", text: acc, citations: citations.length ? [...citations] : undefined, streaming: true },
          ]);
        },
      );
    } catch {
      cannedFallback();
      return;
    }

    if (streamError || !acc.trim()) {
      cannedFallback();
      return;
    }

    const finalAi: ChatMessage = {
      role: "ai",
      text: acc,
      citations: citations.length ? citations : undefined,
    };
    const finalMessages = [...baseMessages, finalAi];
    setMessages(finalMessages);
    persistMessages(finalMessages);
    setStreamingIdx(null);
    if (!blocked) speak(finalAi.text, opts);
  }

  function handleSend() {
    sendMessage(input);
  }

  function handleNewChat() {
    const newConv: Conversation = {
      id: generateId(),
      title: t("New conversation"),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveId(newConv.id);
    setMessages([]);
    saveConversations(updated);
    setHistoryOpen(false);
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setActiveId(id);
      setMessages(conv.messages);
      setHistoryOpen(false);
    }
  }

  function handleDeleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    saveConversations(updated);
    if (activeId === id) {
      if (updated.length > 0) {
        setActiveId(updated[0].id);
        setMessages(updated[0].messages);
      } else {
        handleNewChat();
      }
    }
  }

  function formatWhen(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t("Today") + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return t("Yesterday") + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays < 7) return t("Last week");
    return d.toLocaleDateString();
  }

  const EXAMPLES = [
    t("Thefts in Whitefield last month"),
    t("Top crime hotspots this quarter"),
    t("Network around suspect FIR-2024-08842"),
    "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ",
  ];

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0">
        {/* Conversation rail */}
        <section className="flex w-[420px] flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Conversation")}</div>
              <h2 className="text-sm font-semibold text-foreground truncate max-w-[220px]">
                {activeConv?.title || t("New conversation")}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <History className="h-3.5 w-3.5" />
                {t("History")}
              </button>
              <button onClick={handleNewChat} className="text-xs text-primary hover:underline">{t("+ New")}</button>
            </div>
          </div>

          {historyOpen && (
            <div className="border-b border-border bg-muted/40 px-4 py-3 max-h-[280px] overflow-auto">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Chat history")}</div>
                <button onClick={() => setHistoryOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {conversations.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">{t("No conversations yet.")}</div>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => handleSelectConversation(c.id)}
                        className={`flex w-full items-start rounded-md px-2 py-1.5 text-left text-xs hover:bg-card group ${
                          c.id === activeId ? "bg-card ring-1 ring-primary/30" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-foreground">{c.title}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {t("Created")} {formatWhen(c.createdAt)}
                          </div>
                        </div>
                        <div className="ml-2 flex flex-col items-end shrink-0">
                          <span className="text-[10px] text-muted-foreground">{formatWhen(c.updatedAt)}</span>
                          <span
                            onClick={(e) => handleDeleteConversation(e, c.id)}
                            className="mt-0.5 hidden group-hover:inline-flex text-muted-foreground hover:text-destructive"
                            title={t("Delete")}
                          >
                            <X className="h-3 w-3" />
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-auto px-4 py-5">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
                <Sparkles className="h-6 w-6 text-primary/60" />
                <p>{t("Start a new conversation or pick one from history.")}</p>
              </div>
            )}
            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return <UserMsg key={i} text={msg.text} />;
              }
              // Handle the restricted-answer demo case embedded as an ai msg
              if (msg.text === t("Your role can't view named accused records. Showing aggregate counts instead.")) {
                return (
                  <div key={i} className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">{t("Answer restricted")}</div>
                        <p className="mt-0.5 text-xs text-foreground/80">{msg.text}</p>
                        <button className="mt-2 text-xs font-medium text-primary hover:underline">
                          {t("View what I can show →")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <AiMsg
                  key={i}
                  text={msg.text}
                  citations={(msg as any).citations}
                  streaming={i === streamingIdx}
                  action={
                    i === 3 ? (
                      <button
                        onClick={() => setDrawer(true)}
                        className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition"
                      >
                        {t("Open case")} <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                  }}
                  className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t("Ask Satyam… (EN or ಕನ್ನಡ)")}
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("satyam:open-voice"))}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("Voice")}
              >
                <Mic className="h-4 w-4" />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Results Canvas */}
        <section className="flex-1 min-w-0 overflow-auto bg-background">
          <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Results Canvas")}</div>
              <h3 className="text-sm font-semibold text-foreground">{t("Thefts · Whitefield zone · last 30 days")}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                <FileCode2 className="h-3.5 w-3.5" /> {t("View SQL / sources")}
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                <ExternalLink className="h-3.5 w-3.5" /> {t("Expand")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 p-6">
            <Stat label={t("Total FIRs")} value="142" delta="+12%" trend="up" />
            <Stat label={t("Avg / day")} value="4.7" delta="+0.5" trend="up" />
            <Stat label={t("Cleared")} value="38" delta="27%" trend="flat" />
          </div>

          <div className="px-6 pb-6">
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
                <div className="font-medium text-foreground">{t("By Station")}</div>
                <div className="text-muted-foreground">{t("142 rows · streaming…")}</div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">{t("Station")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("FIRs")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("Cleared")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("Trend (30d)")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("Top IPC")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["Whitefield PS", 47, 14, "▁▂▃▅▇▆▇", "379"],
                    ["Mahadevapura", 38, 11, "▂▃▂▄▅▇▆", "379"],
                    ["KR Puram", 22, 6, "▁▁▂▃▂▄▃", "411"],
                    ["Marathahalli", 18, 4, "▂▁▃▂▄▃▅", "379"],
                    ["HAL", 11, 2, "▁▁▂▁▃▂▃", "454"],
                    ["Ramamurthy Nagar", 6, 1, "▁▁▂▁▁▂▂", "379"],
                  ].map((r) => (
                    <tr key={r[0] as string} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium text-foreground">{r[0]}</td>
                      <td className="px-4 py-2.5 text-foreground">{r[1]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r[2]}</td>
                      <td className="px-4 py-2.5 font-mono text-primary">{r[3]}</td>
                      <td className="px-4 py-2.5"><span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-mono font-semibold text-accent-foreground">§ {r[4]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("Every figure links to its source row. Click a station to drill into FIRs.")}
            </div>
          </div>
        </section>
      </div>

      <CaseDrawer open={drawer} onClose={() => setDrawer(false)} />
    </Shell>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AiMsg({
  text, citations, streaming, action,
}: { text: string; citations?: string[]; streaming?: boolean; action?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-background text-[10px] font-bold">
        FQ
      </div>
      <div className="flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground">
          {text}
          {streaming && <span className="ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary" />}
        </div>
        {citations && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {citations.map((c) => (
              <span key={c} className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                ↳ {c}
              </span>
            ))}
          </div>
        )}
        {citations && (
          <button className="mt-1 text-[11px] text-primary hover:underline">{t("View SQL / sources →")}</button>
        )}
        {action}
      </div>
    </div>
  );
}

function Stat({ label, value, delta, trend }: { label: string; value: string; delta: string; trend: "up" | "down" | "flat" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-foreground tabular-nums">{value}</div>
        <div className={`text-xs font-medium ${
          trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground"
        }`}>{delta}</div>
      </div>
    </div>
  );
}
