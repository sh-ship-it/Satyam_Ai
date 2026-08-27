import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import {
  ClipboardList,
  Trash2,
  Copy,
  Check,
  Mic,
  Send,
  Download,
  Sparkles,
  Plus,
  MessageSquare,
  FileDown,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { loadConversations, fmtTime, type StoredConversation } from "@/lib/conversationStore";
import { exportConversationPdf, exportConversationsPdf } from "@/lib/pdf/conversationPdf";
import { saveBlob } from "@/lib/download";

export const Route = createFileRoute("/transcripts")({
  head: () => ({
    meta: [
      { title: "Transcripts · Satyam" },
      { name: "description", content: "Saved voice transcripts and conversation history." },
    ],
  }),
  component: Transcripts,
});

type Transcript = { id: string; text: string; lang: string; createdAt: string };

const VOICE_KEY = "satyam-transcripts";

function loadVoiceTranscripts(): Transcript[] {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveVoiceTranscripts(list: Transcript[]) {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(list));
  } catch {}
}

const DEMO_TRANSCRIPTS: Omit<Transcript, "id">[] = [
  {
    text: "Tell me about the top crimes in Bengaluru City this year",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    text: "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ ತೋರಿಸಿ",
    lang: "kn-IN",
    createdAt: new Date(Date.now() - 900000).toISOString(),
  },
  {
    text: "Show network for this chain-snatching case",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    text: "Profile the offender in case 1007",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    text: "Show forecast hotspots for Mysuru City",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 5400000).toISOString(),
  },
];

function langLabel(lang: string) {
  return lang?.toLowerCase().startsWith("kn") ? "ಕನ್ನಡ" : "EN";
}

// ── Conversation tab ──────────────────────────────────────────────────────────
function ConversationsTab() {
  const t = useT();
  const [convs, setConvs] = useState<StoredConversation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setConvs(loadConversations());
    // refresh if console saves while this tab is open
    const id = setInterval(() => setConvs(loadConversations()), 5000);
    return () => clearInterval(id);
  }, []);

  const filtered = convs.filter(
    (c) =>
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.messages.some((m) => m.text.toLowerCase().includes(search.toLowerCase())),
  );

  if (convs.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-full text-center p-8">
        <MessageSquare className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-bold text-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Start a conversation in the Console screen — it will appear here for review and PDF
            export.
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-card/60">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 max-w-md rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => exportConversationsPdf(filtered)}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted transition disabled:opacity-50"
        >
          <FileDown className="h-3.5 w-3.5" /> Export all ({filtered.length})
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-3">
        {filtered.map((c) => (
          <div key={c.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/20">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{c.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {c.officer && <span className="mr-2">{c.officer}</span>}
                  {fmtTime(c.createdAt)} · {c.messages.length} messages
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => exportConversationPdf(c)}
                  className="flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 text-primary px-2.5 py-1.5 text-[10px] font-bold hover:bg-primary/20 transition"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </button>
                <button
                  onClick={() => setExpanded((prev) => (prev === c.id ? null : c.id))}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition"
                >
                  {expanded === c.id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {/* Message thread */}
            {expanded === c.id && (
              <div className="p-4 space-y-2 max-h-[400px] overflow-auto">
                {c.messages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-primary/10 ml-4" : "bg-muted mr-4"}`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-1 text-muted-foreground">
                      {m.role === "user" ? c.officer || "Officer" : "Satyam AI"}
                    </div>
                    <div className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Voice tab (existing logic, unchanged) ─────────────────────────────────────
function VoiceTranscriptsTab() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Transcript[]>(loadVoiceTranscripts);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    saveVoiceTranscripts(items);
  }, [items]);

  const handleDelete = (id: string) => setItems((arr) => arr.filter((x) => x.id !== id));
  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };
  const handleSendToConsole = (it: Transcript) => {
    try {
      sessionStorage.setItem(
        "satyam:pending-voice",
        JSON.stringify({ text: it.text, lang: it.lang, speak: true }),
      );
    } catch {}
    // /ask consumes satyam:pending-voice; the console's chat box is gone.
    navigate({ to: "/ask" });
  };
  const seedDemo = () => {
    setItems((prev) => [
      ...DEMO_TRANSCRIPTS.map((d, i) => ({ ...d, id: `demo_${Date.now()}_${i}` })),
      ...prev,
    ]);
  };
  const handleExport = () => {
    const content = items
      .map((it) => `[${new Date(it.createdAt).toLocaleString()}] (${it.lang})\n${it.text}\n`)
      .join("\n---\n\n");
    saveBlob(new Blob([content], { type: "text/plain" }), `satyam-transcripts-${Date.now()}.txt`);
  };

  const filtered = items.filter(
    (it) => !search || it.text.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {items.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border bg-card/60">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcripts…"
            className="flex-1 max-w-md rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none"
          />
          <button
            onClick={seedDemo}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted transition"
          >
            <Plus className="h-3.5 w-3.5" /> Add demo
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted transition"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            onClick={() => {
              if (window.confirm("Delete all?")) setItems([]);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-2.5 py-1.5 text-xs font-semibold hover:bg-destructive/20 transition"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto p-6">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-foreground bg-muted">
              <ClipboardList className="h-8 w-8 opacity-50" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-bold text-foreground">No saved transcripts yet</p>
              <p className="text-xs max-w-xs">
                Open the mic panel, speak a command, then tap <strong>Save</strong> to store it
                here.
              </p>
            </div>
            <button
              onClick={seedDemo}
              className="mt-2 flex items-center gap-1.5 rounded-lg border-2 border-foreground bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
            >
              <Sparkles className="h-3.5 w-3.5" /> Load demo transcripts
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No transcripts match "{search}"
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {filtered.map((it) => (
              <div
                key={it.id}
                className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 bg-muted/20">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Mic className="h-3 w-3 shrink-0" />
                    <span
                      className={`rounded-full px-2 py-0.5 font-bold text-[9px] uppercase ${it.lang?.toLowerCase().startsWith("kn") ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      {langLabel(it.lang)}
                    </span>
                    <span>·</span>
                    <span>{new Date(it.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopy(it.id, it.text)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted transition"
                    >
                      {copiedId === it.id ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleSendToConsole(it)}
                      className="flex items-center gap-1 rounded-lg border-2 border-foreground bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 transition"
                    >
                      <Send className="h-3 w-3" /> Send to console
                    </button>
                    <button
                      onClick={() => handleDelete(it.id)}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                      aria-label={t("Delete")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {it.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
function Transcripts() {
  const t = useT();
  const [tab, setTab] = useState<"voice" | "conversations">("conversations");

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0 flex-col bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {t("Transcripts")}
          </div>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2.5 text-foreground">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              {t("Transcripts & History")}
            </h2>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border bg-card">
          {[
            { key: "conversations", label: t("Conversations"), icon: MessageSquare },
            { key: "voice", label: t("Voice transcripts"), icon: Mic },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as typeof tab)}
              className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold border-b-2 transition ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "conversations" ? <ConversationsTab /> : <VoiceTranscriptsTab />}
        </div>
      </div>
    </Shell>
  );
}
