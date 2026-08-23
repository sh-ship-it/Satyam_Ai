import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { useState, useEffect, useRef } from "react";
import {
  Mic,
  Send,
  Sparkles,
  ShieldAlert,
  History,
  X,
  Map as MapIcon,
  Layers,
  Filter,
  Volume2,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { SimilarCaseSearch } from "@/components/SimilarCaseSearch";
import { streamChat, type ChatEvent, api, type StationRow, getAuthToken, API_BASE } from "@/lib/api/client";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { intelligence } from "@/lib/api/intelligence";
import { speakViaSarvam, isServerVoiceEnabled } from "@/lib/voice/tts";
import { detectLang, resolveLang } from "@/lib/voice/lang";
import { loadEngineSettings } from "@/components/SettingsDialog";
import { Markdown } from "@/components/Markdown";
import {
  generateId,
  generateTitle,
  loadConversations,
  saveConversations,
  type ChatMessage,
  type Conversation,
} from "@/lib/chatStore";

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
  const { lang } = useI18n();
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // ── Chat panel width (drag-to-resize) ────────────────────────────────────
  const [chatWidth, setChatWidth] = useState(420);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(420);

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = chatWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const next = Math.min(Math.max(dragStartWidthRef.current + delta, 260), window.innerWidth * 0.6);
      setChatWidth(next);
    }
    function onMouseUp() {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }  const [input, setInput] = useState("");
  const [chatDictating, setChatDictating] = useState(false);
  const chatRecRef = useRef<any>(null);
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const backendConvId = useRef<string | null>(null);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);

  // Track when Sarvam/Google TTS is speaking so we can show a visual indicator.
  useEffect(() => {
    const onState = (e: Event) => {
      const state = (e as CustomEvent).detail?.state;
      if (state === "speaking") setIsTtsSpeaking(true);
      else if (state === "done") setIsTtsSpeaking(false);
    };
    window.addEventListener("satyam:ai-state", onState);
    return () => window.removeEventListener("satyam:ai-state", onState);
  }, []);

  // ── Results Canvas state ──────────────────────────────────────────────────
  const [canvasTab, setCanvasTab] = useState<"data" | "map">("data");
  const [mapMode, setMapMode] = useState<"heat" | "pins" | "grid">("heat");
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [grandTotal, setGrandTotal] = useState<number>(0); // real DB-wide case count
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasErr, setCanvasErr] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<Hotspot[] | null>(null);

  // Live filter options — crime types & districts pulled from the DB (RLS-scoped),
  // never hardcoded, so the dropdowns always reflect the actual dataset.
  const [crimeOptions, setCrimeOptions] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!getAuthToken()) {
          try {
            await api.login("demo", "");
          } catch {
            /* backend down — handled below */
          }
        }
        const token = getAuthToken();
        const r = await fetch(`${API_BASE}/settings/db-source/data-values`, {
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        setCrimeOptions(Array.isArray(d.crime_types) ? d.crime_types : []);
        setDistrictOptions(Array.isArray(d.districts) ? d.districts : []);
      } catch {
        /* leave options empty — the "All …" option still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      mode: "by_crime",
    };
    if (crimeType) body.crime_type = crimeType;
    if (district) body.district = district;
    (async () => {
      // Auto-login with the demo account if no token is stored yet.
      // This ensures the canvas loads even when the user navigated directly to
      // /console without going through the login page.
      if (!getAuthToken()) {
        try {
          await api.login("demo", "");
        } catch {
          /* backend unreachable — requests will fail below with a clear message */
        }
      }
      try {
        const [hot, brk] = await Promise.all([
          api.mapHotspots(body),
          api.stationBreakdown({ ...body, limit: 25 }),
        ]);
        if (cancelled) return;
        setHotspots(
          (hot.points || []).map((p) => ({
            lat: p.lat,
            lng: p.lng,
            weight: p.weight,
            label: p.label ?? undefined,
          })),
        );
        setStations(brk.rows || []);
        // Use the real DB-wide count, not the sum of the top-N rows
        setGrandTotal(brk.grand_total ?? brk.rows?.reduce((s: number, r: StationRow) => s + r.firs, 0) ?? 0);
      } catch (err: any) {
        if (!cancelled) {
          const status: number | undefined = err?.status;
          const msg =
            status === 401
              ? "Session expired — please sign out and sign in again."
              : status === 403
                ? "Your rank does not have permission to view analytics. Sign in with a higher rank (SP or above)."
                : status != null
                  ? `API error ${status} — check the backend is running.`
                  : "Could not reach the API — make sure the backend is running on http://localhost:8000.";
          setCanvasErr(msg);
          setHotspots([]);
          setStations([]);
          setGrandTotal(0);
        }
      } finally {
        if (!cancelled) setCanvasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [crimeType, district]);

  // Use grand_total from the backend (real DB-wide count) for the headline stat.
  // Fall back to summing rows only when grand_total isn't available (old backend).
  const totalFirs = grandTotal || stations.reduce((s, r) => s + r.firs, 0);
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
        messages: [],
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
          () =>
            sendMessage(d.text.trim(), { speak: d.speak !== false, lang: d.lang, rate: d.rate }),
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

  // AI: focus the map on a person's crime locations.
  useEffect(() => {
    const onMapFocus = async (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const who = d.person || d.place || "";
      if (!who) return;
      setCanvasTab("map"); // make sure the map panel is showing
      setMapMode("pins");
      try {
        const locs = await intelligence.personLocations(who);
        setMapFocus(locs.length ? locs : null);
      } catch (err) {
        console.error("[map-focus] failed:", err);
        setMapFocus(null);
      }
    };
    window.addEventListener("satyam:map-focus", onMapFocus);
    return () => window.removeEventListener("satyam:map-focus", onMapFocus);
  }, []);

  // Voice Screen Agent: execute structured actions for /console.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/console") return;
      const actions = Array.isArray(d.actions) ? d.actions : [];
      for (const a of actions) {
        if (a.screen !== "/console") continue;
        const p = a.params || {};
        if (a.action === "ask" && p.text) {
          sendMessage(String(p.text), { speak: !!d.speak, lang: d.lang });
        } else if (a.action === "new_chat") {
          handleNewChat();
        } else if (a.action === "set_map_mode" && p.mode) {
          setCanvasTab("map");
          setMapMode(p.mode as "heat" | "pins" | "grid");
        } else if (a.action === "show_on_map" && p.person) {
          window.dispatchEvent(
            new CustomEvent("satyam:map-focus", { detail: { person: String(p.person) } }),
          );
        }
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hands-free map control ─────────────────────────────────────────────────
  // The Console map is rendered by <CrimeMap/>, which encapsulates a raw Leaflet
  // `L.Map` (created with `L.map(...)`) and never exposes it as a prop or ref.
  // Since we may only edit this file, we capture the live map instance with
  // Leaflet's public `L.Map.addInitHook` — it runs for every Map construction
  // (including CrimeMap's) with `this` bound to the new map. We stash the latest
  // instance on a window global + ref so the gesture handler below can drive it.
  // The hook is installed once and clears itself when a map is unloaded.
  const mapRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      const w = window as any;
      if (!w.__satyamMapInitHook) {
        w.__satyamMapInitHook = true;
        L.Map.addInitHook(function (this: any) {
          w.__satyamLeafletMap = this;
          this.on("unload", () => {
            if (w.__satyamLeafletMap === this) w.__satyamLeafletMap = null;
          });
        });
      }
      // Adopt a map that may have been created before this hook installed.
      if (w.__satyamLeafletMap) mapRef.current = w.__satyamLeafletMap;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hands-free gesture control: the Shell dispatches "satyam:hands-map" while the
  // officer is on /console. detail is one of:
  //   { action: "pan",  dir: "left" | "right" } → pan ~25% of the viewport width
  //   { action: "zoom", delta: 1 | -1 }         → zoom in (+1) / out (-1) one level
  useEffect(() => {
    const onHandsMap = (e: Event) => {
      const map = (window as any).__satyamLeafletMap ?? mapRef.current;
      if (!map) return; // map not ready yet — no-op
      mapRef.current = map;
      const d = (e as CustomEvent).detail || {};
      try {
        if (d.action === "pan") {
          const size = map.getSize();
          const dx = d.dir === "right" ? size.x * 0.25 : -size.x * 0.25;
          map.panBy([dx, 0], { animate: true });
        } else if (d.action === "zoom") {
          const delta = Number(d.delta) || 0;
          if (delta) map.setZoom(map.getZoom() + delta);
        }
      } catch (err) {
        console.error("[hands-map] failed:", err);
      }
    };
    window.addEventListener("satyam:hands-map", onHandsMap);
    return () => window.removeEventListener("satyam:hands-map", onHandsMap);
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
    const emit = (state: "speaking" | "done") =>
      window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state } }));
    // Voice turns always speak. Typed turns speak only when a server TTS provider
    // (Sarvam or Google) is active in Settings — browser Web Speech is opt-in only.
    const shouldSpeak = opts?.speak || isServerVoiceEnabled();
    if (!shouldSpeak) return;

    // Language priority:
    // 1. If a voice turn explicitly passed a BCP-47 locale (e.g. "kn-IN"), use it.
    // 2. Otherwise use the UI language toggle (EN / KN) set by the user.
    //    This ensures "I set English → AI speaks English" always holds,
    //    regardless of what characters appear in the response text.
    let resolvedLang: "en" | "kn";
    const explicitLang = (opts?.lang || "").toLowerCase();
    if (explicitLang && explicitLang !== "auto") {
      resolvedLang = explicitLang.startsWith("kn") ? "kn" : "en";
    } else {
      // Respect the UI toggle as the source of truth.
      resolvedLang = lang === "KN" ? "kn" : "en";
    }

    console.debug(
      "[console] speak lang=", resolvedLang,
      "uiLang=", lang,
      "provider=", loadEngineSettings().voiceBackend,
    );
    void speakViaSarvam(text, resolvedLang, opts?.rate ?? 1, {
      onStart: () => emit("speaking"),
      onEnd: () => emit("done"),
    });
  }

  async function sendMessage(
    text: string,
    opts?: { speak?: boolean; lang?: string; rate?: number },
  ) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const isVoiceTurn = !!opts?.speak;
    const speechLang = (opts?.lang || "").toLowerCase().startsWith("kn") ? "kn-IN" : "en-IN";
    if (isVoiceTurn) {
      window.dispatchEvent(new CustomEvent("satyam:ai-state", { detail: { state: "thinking" } }));
    }

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    const baseMessages = [...messages, userMsg];
    setMessages([...baseMessages, { role: "ai", text: "", streaming: true }]);
    persistMessages(baseMessages);
    setInput("");
    setStreamingIdx(baseMessages.length);

    // TASK 2A: auto-detect chat request language from the user's text,
    // falling back to the UI language toggle if detection gives nothing.
    const reqLang: "en" | "kn" = (opts?.lang || "").toLowerCase().startsWith("kn")
      ? "kn"
      : detectLang(trimmed) === "kn"
        ? "kn"
        : lang === "KN"
          ? "kn"
          : "en";

    // TASK 3: forward per-session engine settings from the Settings panel.
    const engines = loadEngineSettings();

    // Neutral fallback — no fabricated data
    const cannedFallback = () => {
      const aiText = t(
        "I couldn't reach the backend just now. Please retry once the API is running.",
      );
      const finalMessages: ChatMessage[] = [...baseMessages, { role: "ai", text: aiText }];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      speak(aiText, opts);
    };

    let acc = "";
    const citations: string[] = [];
    let blocked = false;
    let streamError = false;
    let spokenSummary = ""; // [SPEAK] block from the backend — used for TTS

    try {
      await streamChat(
        {
          message: trimmed,
          conversation_id: backendConvId.current ?? undefined,
          lang: reqLang,
          // TASK 3: forward per-session engine overrides from Settings panel.
          brain_engine: engines.brainEngine,
          sql_engine: engines.sqlEngine,
          voice_backend: engines.voiceBackend === "webspeech" ? undefined : engines.voiceBackend,
        },
        (ev: ChatEvent) => {
          if (ev.type === "token") acc += ev.text;
          else if (ev.type === "speak") spokenSummary = ev.text ?? "";
          else if (ev.type === "citation") citations.push(ev.label || ev.ref);
          else if (ev.type === "blocked") {
            blocked = true;
            acc = t(
              "Your role can't view named accused records. Showing aggregate counts instead.",
            );
          } else if (ev.type === "done") backendConvId.current = ev.conversation_id;
          else if (ev.type === "error") streamError = true;
          setMessages([
            ...baseMessages,
            {
              role: "ai",
              text: acc,
              citations: citations.length ? [...citations] : undefined,
              streaming: true,
            },
          ]);
        },
      );
    } catch {
      cannedFallback();
      return;
    }

    if (streamError) {
      cannedFallback();
      return;
    }
    if (blocked) {
      // 'acc' already holds the restricted-access notice set in the blocked handler.
      const finalMessages: ChatMessage[] = [...baseMessages, { role: "ai", text: acc }];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      return;
    }
    if (!acc.trim()) {
      const empty = t(
        "No results matched your query. Try a broader question or different filters.",
      );
      const finalMessages: ChatMessage[] = [...baseMessages, { role: "ai", text: empty }];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      speak(empty, opts);
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
    // If the backend sent a [SPEAK] smart summary, always speak it (force speak:true
    // so it plays on both voice and typed turns, regardless of provider setting).
    // If no summary, fall back to old behaviour: respect opts (voice turns) or
    // server-provider check (typed turns).
    if (spokenSummary) {
      speak(spokenSummary, { speak: true, lang: opts?.lang, rate: opts?.rate });
    } else {
      speak(finalAi.text, opts);
    }
  }

  // Chat-box dictation — fills ONLY the chat input. It must never open the
  // top-right voice copilot (no "satyam:open-voice") or touch copilot state.
  function toggleChatDictation() {
    if (chatRecRef.current) {
      try {
        chatRecRef.current.stop();
      } catch {
        /* noop */
      }
      return; // onend clears the ref + flag
    }
    const SR: any =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      alert("This browser has no speech recognition. Use Chrome or Edge.");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang === "KN" ? "kn-IN" : "en-IN";

    const prefix = input.trim() ? input.trim() + " " : "";
    let finalText = "";

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setInput((prefix + finalText + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = () => {
      /* swallow; onend cleans up */
    };
    rec.onend = () => {
      chatRecRef.current = null;
      setChatDictating(false);
      setInput((prefix + finalText).replace(/\s+/g, " ").trim());
    };

    chatRecRef.current = rec;
    setChatDictating(true);
    try {
      rec.start();
    } catch {
      chatRecRef.current = null;
      setChatDictating(false);
    }
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
    if (diffDays === 0)
      return t("Today") + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return t("Yesterday");
    if (diffDays < 7) return t("Last week");
    return d.toLocaleDateString();
  }

  // Dataset-real example prompts
  const EXAMPLES = [
    t("Theft cases in Bengaluru City this year"),
    t("Top crime types in Mysuru City"),
    t("Network around a person in Dakshina Kannada"),
    "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ",
  ];

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0">
        {/* Conversation rail — drag the right-edge divider to resize width */}
        <section
          className="flex flex-col border-border bg-card overflow-hidden shrink-0"
          style={{ width: chatWidth }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("Conversation")}
              </div>
              <h2 className="text-sm font-semibold text-foreground truncate max-w-[220px]">
                {activeConv?.title || t("New conversation")}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {isTtsSpeaking && (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success animate-pulse">
                  <Volume2 className="h-2.5 w-2.5" />
                  {t("Speaking…")}
                </span>
              )}
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <History className="h-3.5 w-3.5" />
                {t("History")}
              </button>
              <button onClick={handleNewChat} className="text-xs text-primary hover:underline">
                {t("+ New")}
              </button>
            </div>
          </div>

          {historyOpen && (
            <div className="border-b border-border bg-muted/40 px-4 py-3 max-h-[280px] overflow-auto">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t("Chat history")}
                </div>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {conversations.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">
                  {t("No conversations yet.")}
                </div>
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
              if (
                msg.text ===
                t("Your role can't view named accused records. Showing aggregate counts instead.")
              ) {
                return (
                  <div key={i} className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {t("Answer restricted")}
                        </div>
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
                onClick={toggleChatDictation}
                className={
                  "grid h-8 w-8 place-items-center rounded-md " +
                  (chatDictating
                    ? "bg-destructive text-destructive-foreground animate-pulse"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
                aria-label={chatDictating ? t("Stop dictation") : t("Dictate into chat")}
                title={chatDictating ? t("Stop dictation") : t("Dictate into chat")}
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

        {/* Drag divider */}
        <div
          onMouseDown={onDividerMouseDown}
          className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 active:bg-primary transition-colors relative group"
          title="Drag to resize"
        >
          {/* Visual grip dots */}
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="h-1 w-1 rounded-full bg-current" />
            <span className="h-1 w-1 rounded-full bg-current" />
            <span className="h-1 w-1 rounded-full bg-current" />
          </div>
        </div>

        {/* Results Canvas */}
        <section className="flex flex-1 min-w-0 flex-col overflow-hidden bg-background">
          {/* Canvas header + tab switcher */}
          <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("Results Canvas")}
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {crimeType || district
                  ? `${crimeType || t("All crimes")} · ${district || t("All districts")}`
                  : t("Crime overview · live")}
              </h3>
            </div>
            <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
              {(
                [
                  ["data", t("Data")],
                  ["map", t("Map")],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setCanvasTab(v as "data" | "map")}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                    canvasTab === v
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "map" ? (
                    <span className="inline-flex items-center gap-1">
                      <MapIcon className="h-3.5 w-3.5" />
                      {l}
                    </span>
                  ) : (
                    l
                  )}
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
              {crimeOptions.map((c) => (
                <option key={c} value={c}>
                  {tData("crime_type", c, lang)}
                </option>
              ))}
            </select>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs"
            >
              <option value="">{t("All districts")}</option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>
                  {tData("district", d, lang)}
                </option>
              ))}
            </select>
            {canvasLoading && (
              <span className="text-[11px] text-muted-foreground">{t("Loading…")}</span>
            )}
            {canvasErr && <span className="text-[11px] text-destructive">{canvasErr}</span>}
          </div>

          {canvasTab === "data" ? (
            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-3 gap-4 p-6">
                <Stat
                  label={t("Total FIRs")}
                  value={totalFirs.toLocaleString()}
                  delta={`${t("top")} ${stations.length} ${t("stations")}`}
                  trend="flat"
                />
                <Stat label={t("Avg / day")} value={avgPerDay} delta="" trend="flat" />
                <Stat
                  label={t("Cleared")}
                  value={String(totalCleared)}
                  delta={`${clearedPct}%`}
                  trend="flat"
                />
              </div>
              <div className="px-6 pb-6">
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
                    <div className="font-medium text-foreground">{t("By Station")}</div>
                    <div className="text-muted-foreground">
                      {stations.length} {t("rows")}
                      {canvasLoading ? " · " + t("loading…") : ""}
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
                          <td className="px-4 py-2.5 font-medium text-foreground">{tData("station", r.station, lang)}</td>
                          <td className="px-4 py-2.5 text-foreground">{r.firs}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.cleared}</td>
                          <td className="px-4 py-2.5">
                            <Spark data={r.trend} />
                          </td>
                          <td className="px-4 py-2.5">
                            {r.top_legal_code ? (
                              <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                                {tData("crime_type", r.top_legal_code, lang)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
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
                <div className="mt-4">
                  <SimilarCaseSearch onOpenCase={(id) => setDrawerCaseId(id)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* ── Back bar — rendered in normal flow ABOVE the map, never covered by Leaflet ── */}
              <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 shrink-0">
                <button
                  onClick={() => {
                    setCanvasTab("data");
                    setMapFocus(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-bold text-foreground hover:bg-card transition"
                >
                  ← {t("Back")}
                </button>
                <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
                  <Layers className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                  {(["heat", "pins", "grid"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setMapMode(l)}
                      className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition ${
                        mapMode === l
                          ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(l)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Map fills the remaining space */}
              <div className="relative flex-1 min-h-[380px]">
              <CrimeMap
                points={hotspots}
                mode={mapMode}
                focus={mapFocus}
              />

              {/* Legend */}
              <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 font-medium text-foreground">{t("Intensity")}</div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-32 rounded-full"
                    style={{ background: "linear-gradient(90deg,#3b82f6,#fbbf24,#f97316,#ef4444)" }}
                  />
                  <span className="text-muted-foreground">{t("low → high")}</span>
                </div>
              </div>
              {/* Live top-hotspot card — sits over the inner map div */}
              {stations[0] && (
                <div className="absolute right-6 top-6 z-[400] w-72 rounded-xl border border-border bg-card/95 backdrop-blur p-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("Top hotspot")}
                    </div>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                      {t("live")}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{tData("station", stations[0].station, lang)}</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Mini label={t("FIRs")} value={String(stations[0].firs)} />
                    <Mini label={t("Cleared")} value={String(stations[0].cleared)} />
                    <Mini
                      label={t("Top IPC")}
                      value={stations[0].top_legal_code ? "§ " + stations[0].top_legal_code : "—"}
                    />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {t("Trend")}
                    </div>
                    <Spark data={stations[0].trend} />
                  </div>
                  <button
                    onClick={() =>
                      sendMessage(`${t("Summarize crime around")} ${stations[0].station}`)
                    }
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {t("Ask AI about this area")}
                  </button>
                </div>
              )}
              </div>
            </div>
          )}
        </section>
      </div>
      <CaseDrawer
        open={drawerCaseId != null}
        caseId={drawerCaseId ?? undefined}
        onClose={() => setDrawerCaseId(null)}
        onShowOnMap={(lat, lng, label) => {
          // Switch the results canvas to map and drop a pin at the case location.
          // Also close the drawer so the map is fully visible.
          setDrawerCaseId(null);
          setCanvasTab("map");
          setMapMode("pins");
          setMapFocus([{ lat, lng, weight: 3, label }]);
        }}
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
  text,
  citations,
  streaming,
  action,
}: {
  text: string;
  citations?: string[];
  streaming?: boolean;
  action?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-background text-[10px] font-bold">
        FQ
      </div>
      <div className="flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground">
          <Markdown>{text || ""}</Markdown>
          {streaming && (
            <span className="ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary" />
          )}
        </div>
        {citations && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {citations.map((c) => (
              <span
                key={c}
                className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
              >
                ↳ {c}
              </span>
            ))}
          </div>
        )}
        {citations && (
          <button className="mt-1 text-[11px] text-primary hover:underline">
            {t("View SQL / sources →")}
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-foreground tabular-nums">{value}</div>
        {delta && (
          <div
            className={`text-xs font-medium ${
              trend === "up"
                ? "text-success"
                : trend === "down"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {delta}
          </div>
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
