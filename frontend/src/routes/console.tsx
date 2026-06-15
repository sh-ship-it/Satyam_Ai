import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { useState, useEffect, useRef } from "react";
import {
  Mic, Send, Sparkles, ShieldAlert, History, X,
  Map as MapIcon, Layers, Filter,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { streamChat, type ChatEvent, api, type StationRow } from "@/lib/api/client";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";

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

function getDefaultMessages(): ChatMessage[] {
  return []; // Start empty — no fabricated demo conversations
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

function generateTitle(text: string): string {
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
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const backendConvId = useRef<string | null>(null);

  // ── Results Canvas state ──────────────────────────────────────────────────
  const [canvasTab, setCanvasTab] = useState<"data" | "map">("data");
  const [mapMode, setMapMode] = useState<"heat" | "pins" | "grid">("heat");
  const [mapView, setMapView] = useState<"crime" | "offender">("crime");
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasErr, setCanvasErr] = useState<string | null>(null);

  // Open the Map tab if a voice "show map" intent navigated here
  useEffect(() => {
    try {
      if (sessionStorage.getItem("satyam:open-canvas") === "map") {
        sessionStorage.removeItem("satyam:open-canvas");
        setCanvasTab("map");
      }
    } catch {}
  }, []);

  // Live canvas data: hotspots + station breakdown from one filter set
  useEffect(() => {
    let cancelled = false;
    setCanvasLoading(true);
    setCanvasErr(null);
    const body: Record<string, unknown> = {
      mode: mapView === "offender" ? "by_offender" : "by_crime",
    };
    if (crimeType) body.crime_type = crimeType;
    if (district) body.district = district;
    (async () => {
      try {
        const [hot, brk] = await Promise.all([
          api.mapHotspots(body),
          api.stationBreakdown({ ...body, limit: 25 }),
        ]);
        if (cancelled) return;
        setHotspots((hot.points || []).map((p) => ({
          lat: p.lat, lng: p.lng, weight: p.weight, label: p.label ?? undefined,
        })));
        setStations(brk.rows || []);
      } catch {
        if (!cancelled) {
          setCanvasErr("Could not load live data — check you are signed in and the API is reachable.");
          setHotspots([]);
          setStations([]);
        }
      } finally {
        if (!cancelled) setCanvasLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mapView, crimeType, district]);

  const totalFirs = stations.reduce((s, r) => s + r.firs, 0);
  const totalCleared = stations.reduce((s, r) => s + r.cleared, 0);
  const clearedPct = totalFirs ? Math.round((totalCleared / totalFirs) * 100) : 0;
  const avgPerDay = totalFirs ? (totalFirs / 30).toFixed(1) : "—";

  // ── Bootstrap conversations ───────────────────────────────────────────────
  useEffect(() => {
    const saved = loadConversations();
    if (saved.length > 0) {
      setConversations(saved);
      setActiveId(saved[0].id);
      setMessages(saved[0].messages);
    } else {
      const defaultConv: Conversation = {
        id: generateId(),
        title: t("New conversation"),
        messages: getDefaultMessages(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations([defaultConv]);
      setActiveId(defaultConv.id);
      setMessages(defaultConv.messages);
      saveConversations([defaultConv]);
    }
  }, []);

  // Consume a voice command queued from another screen
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
        const shouldAutoTitle = firstUser && c.title === t("New conversation");
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
    setMessages([...baseMessages, { role: "ai", text: "", streaming: true }]);
    persistMessages(baseMessages);
    setInput("");
    setStreamingIdx(baseMessages.length);

    const reqLang: "en" | "kn" =
      (opts?.lang || "").toLowerCase().startsWith("kn") ? "kn" : "en";

    // Neutral fallback — no fabricated data
    const cannedFallback = () => {
      const aiText = t("I couldn't reach the backend just now. Please retry once the API is running.");
      const finalMessages: ChatMessage[] = [
        ...baseMessages,
        { role: "ai", text: aiText },
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

  function handleSend() { sendMessage(input); }

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
    if (diffDays === 1) return t("Yesterday");
    if (diffDays < 7) return t("Last week");
    return d.toLocaleDateString();
  }

  // Dataset-real example prompts (no Whitefield)
  const EXAMPLES = [
    t("Theft cases in Bengaluru City this year"),
    t("Top crime types in Mysuru City"),
    t("Network around a person in Dakshina Kannada"),
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
                            {formatWhen(c.createdAt)}
                          </div>
                        </div>
                        <span
                          onClick={(e) => handleDeleteConversation(e, c.id)}
                          className="ml-2 hidden group-hover:inline-flex text-muted-foreground hover:text-destructive"
                          title={t("Delete")}
                        >
                          <X className="h-3 w-3" />
                        </span>
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
              if (msg.role === "user") return <UserMsg key={i} text={msg.text} />;
              if (msg.text === t("Your role can't view named accused records. Showing aggregate counts instead.")) {
                return (
                  <div key={i} className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">{t("Answer restricted")}</div>
                        <p className="mt-0.5 text-xs text-foreground/80">{msg.text}</p>
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
                  action={undefined}
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
                  onClick={() => setInput(q)}
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
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
        <section className="flex flex-1 min-w-0 flex-col overflow-hidden bg-background">
          {/* Canvas header + tab switcher */}
          <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Results Canvas")}</div>
              <h3 className="text-sm font-semibold text-foreground">
                {(crimeType || district)
                  ? `${crimeType || t("All crimes")} · ${district || t("All districts")}`
                  : t("Crime overview · live")}
              </h3>
            </div>
            <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
              {([["data", t("Data")], ["map", t("Map")]] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setCanvasTab(v as "data" | "map")}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                    canvasTab === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "map"
                    ? <span className="inline-flex items-center gap-1"><MapIcon className="h-3.5 w-3.5" />{l}</span>
                    : l}
                </button>
              ))}
            </div>
          </div>

          {/* Shared filter bar */}
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-6 py-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={crimeType}
              onChange={(e) => setCrimeType(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs"
            >
              <option value="">{t("All crime types")}</option>
              {["Theft", "Burglary", "Assault", "Cyber Crime", "Narcotics", "Murder"].map((c) => (
                <option key={c} value={c}>{t(c)}</option>
              ))}
            </select>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs"
            >
              <option value="">{t("All districts")}</option>
              {["Bengaluru City", "Bengaluru Dist", "Mysuru City", "Mangaluru City", "Hubballi Dharwad City", "Belagavi City"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {canvasLoading && <span className="text-[11px] text-muted-foreground">{t("Loading…")}</span>}
            {canvasErr && <span className="text-[11px] text-destructive">{canvasErr}</span>}
          </div>

          {canvasTab === "data" ? (
            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-3 gap-4 p-6">
                <Stat label={t("Total FIRs")} value={String(totalFirs)} delta={`${stations.length} ${t("stations")}`} trend="flat" />
                <Stat label={t("Avg / day")} value={avgPerDay} delta="" trend="flat" />
                <Stat label={t("Cleared")} value={String(totalCleared)} delta={`${clearedPct}%`} trend="flat" />
              </div>
              <div className="px-6 pb-6">
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
                    <div className="font-medium text-foreground">{t("By Station")}</div>
                    <div className="text-muted-foreground">
                      {stations.length} {t("rows")}{canvasLoading ? " · " + t("loading…") : ""}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Station")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("FIRs")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Cleared")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Trend (30d)")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Top crime")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {stations.length === 0 && !canvasLoading && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                            {t("No data for this scope.")}
                          </td>
                        </tr>
                      )}
                      {stations.map((r) => (
                        <tr
                          key={r.station}
                          className="hover:bg-muted/30 cursor-pointer"
                          onClick={() => sendMessage(`${t("Show cases in")} ${r.station}`)}
                        >
                          <td className="px-4 py-2.5 font-medium text-foreground">{r.station}</td>
                          <td className="px-4 py-2.5 text-foreground">{r.firs}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.cleared}</td>
                          <td className="px-4 py-2.5"><Spark data={r.trend} /></td>
                          <td className="px-4 py-2.5">
                            {r.top_legal_code
                              ? <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">{r.top_legal_code}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {t("Live from Postgres (RLS-scoped). Click a station to drill into its FIRs.")}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 min-h-[420px]">
              {/* Layer + view controls */}
              <div className="absolute left-4 top-4 z-[400] flex items-center gap-2">
                <div className="flex rounded-md border border-border bg-card/95 p-0.5 shadow">
                  {(["crime", "offender"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setMapView(v)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                        mapView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v === "crime" ? t("By crime type") : t("By offender")}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow">
                  <Layers className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                  {(["heat", "pins", "grid"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setMapMode(l)}
                      className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition ${
                        mapMode === l ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(l)}
                    </button>
                  ))}
                </div>
              </div>

              <CrimeMap points={hotspots} mode={mapMode} />

              {/* Legend */}
              <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 font-medium text-foreground">{t("Intensity")}</div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(90deg,#3b82f6,#fbbf24,#f97316,#ef4444)" }} />
                  <span className="text-muted-foreground">{t("low → high")}</span>
                </div>
              </div>

              {/* Live top-hotspot card */}
              {stations[0] && (
                <div className="absolute right-6 top-6 z-[400] w-72 rounded-xl border border-border bg-card/95 backdrop-blur p-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Top hotspot")}</div>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">{t("live")}</span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{stations[0].station}</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Mini label={t("FIRs")} value={String(stations[0].firs)} />
                    <Mini label={t("Cleared")} value={String(stations[0].cleared)} />
                    <Mini label={t("Top IPC")} value={stations[0].top_legal_code ? "§ " + stations[0].top_legal_code : "—"} />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t("Trend")}</div>
                    <Spark data={stations[0].trend} />
                  </div>
                  <button
                    onClick={() => sendMessage(`${t("Summarize crime around")} ${stations[0].station}`)}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {t("Ask AI about this area")}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <CaseDrawer
        open={drawerCaseId != null}
        caseId={drawerCaseId ?? undefined}
        onClose={() => setDrawerCaseId(null)}
      />
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
        {delta && (
          <div className={`text-xs font-medium ${
            trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground"
          }`}>{delta}</div>
        )}
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-0.5 h-5">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
