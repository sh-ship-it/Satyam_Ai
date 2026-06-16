import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import {
  ClipboardList, Trash2, Copy, Check, Mic, Send,
  Download, Sparkles, Plus,
} from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/transcripts")({
  head: () => ({
    meta: [
      { title: "Transcripts · Satyam" },
      { name: "description", content: "Saved voice transcripts." },
    ],
  }),
  component: Transcripts,
});

type Transcript = { id: string; text: string; lang: string; createdAt: string };

const STORAGE_KEY = "satyam-transcripts";

function loadTranscripts(): Transcript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTranscripts(list: Transcript[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

/** Demo transcripts for the datathon presentation — loaded if the list is empty. */
const DEMO_TRANSCRIPTS: Omit<Transcript, "id">[] = [
  {
    text: "Tell me about the top crimes in Bengaluru City this year",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    text: "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ ತೋರಿಸಿ",
    lang: "kn-IN",
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    text: "Show network for this chain-snatching case",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    text: "Profile the offender in case 1007",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    text: "Show forecast hotspots for Mysuru City",
    lang: "en-IN",
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
];

function Transcripts() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Transcript[]>(loadTranscripts);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    saveTranscripts(items);
  }, [items]);

  const handleDelete = (id: string) => {
    setItems((arr) => arr.filter((x) => x.id !== id));
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  /** Re-send a saved transcript to the Console as a voice command. */
  const handleSendToConsole = (it: Transcript) => {
    try {
      sessionStorage.setItem(
        "satyam:pending-voice",
        JSON.stringify({ text: it.text, lang: it.lang, speak: true }),
      );
    } catch {}
    navigate({ to: "/console" });
  };

  /** Seed demo transcripts for datathon presentation. */
  const seedDemo = () => {
    const seeded: Transcript[] = DEMO_TRANSCRIPTS.map((d, i) => ({
      ...d,
      id: `demo_${Date.now()}_${i}`,
    }));
    setItems((prev) => {
      const merged = [...seeded, ...prev];
      return merged;
    });
  };

  /** Export all transcripts as a .txt file. */
  const handleExport = () => {
    const content = items
      .map((it) =>
        `[${new Date(it.createdAt).toLocaleString()}] (${it.lang})\n${it.text}\n`,
      )
      .join("\n---\n\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `satyam-transcripts-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = items.filter((it) =>
    !search || it.text.toLowerCase().includes(search.toLowerCase()),
  );

  const langLabel = (lang: string) =>
    lang?.toLowerCase().startsWith("kn") ? "ಕನ್ನಡ" : "EN";

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0 flex-col bg-background">

        {/* Header */}
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-0.5">
                {t("Voice transcripts")}
              </div>
              <h2 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                {t("Saved transcripts")}
                <span className="text-sm font-normal opacity-60">· {items.length}</span>
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {items.length === 0 && (
                <button
                  onClick={seedDemo}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-primary/20 px-3 py-1.5 text-xs font-bold hover:bg-primary/30 transition"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Load demo transcripts
                </button>
              )}
              {items.length > 0 && (
                <>
                  <button
                    onClick={seedDemo}
                    className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-secondary-background/20 px-2.5 py-1.5 text-xs font-bold hover:bg-primary/20 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add demo
                  </button>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-secondary-background/20 px-2.5 py-1.5 text-xs font-bold hover:bg-primary/20 transition"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>
                  <button
                    onClick={() => { if (window.confirm("Delete all transcripts?")) setItems([]); }}
                    className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-destructive/20 px-2.5 py-1.5 text-xs font-bold hover:bg-destructive/30 transition text-destructive-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear all
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search bar */}
        {items.length > 0 && (
          <div className="border-b border-border bg-card/60 px-6 py-2.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcripts…"
              className="w-full max-w-md rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {items.length === 0 ? (
            /* ── Empty state ─────────────────────────────────────── */
            <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
              <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-foreground bg-muted nb-shadow-sm">
                <ClipboardList className="h-8 w-8 opacity-50" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-bold text-foreground">No saved transcripts yet</p>
                <p className="text-xs max-w-xs">
                  Open the mic panel, speak a command, then tap{" "}
                  <strong>Save</strong> to store it here. Saved transcripts can
                  be re-sent to the Console with one tap.
                </p>
              </div>
              {/* How-to steps */}
              <div className="mt-2 flex flex-col gap-2 w-full max-w-sm">
                {[
                  { n: 1, text: "Click the mic icon in the top-right header" },
                  { n: 2, text: "Speak your query in English or ಕನ್ನಡ" },
                  { n: 3, text: 'Tap "Save" to store the transcript here' },
                  { n: 4, text: 'Tap "Send to console" to re-run it later' },
                ].map((s) => (
                  <div key={s.n} className="flex items-start gap-3 rounded-[5px] border border-border bg-card px-3 py-2.5">
                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-foreground bg-primary text-[10px] font-extrabold text-primary-foreground">
                      {s.n}
                    </div>
                    <span className="text-xs text-foreground/80">{s.text}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={seedDemo}
                className="mt-2 flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-xs font-bold text-primary-foreground nb-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] transition"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Load demo transcripts
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No transcripts match "{search}"
            </div>
          ) : (
            /* ── Transcript list ─────────────────────────────────── */
            <div className="mx-auto max-w-3xl space-y-3">
              {filtered.map((it) => (
                <div
                  key={it.id}
                  className="rounded-[5px] border-2 border-foreground bg-card nb-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] transition-transform"
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Mic className="h-3 w-3 shrink-0" />
                      <span className={`rounded-[3px] px-1.5 py-0.5 font-bold text-[9px] uppercase ${
                        it.lang?.toLowerCase().startsWith("kn")
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {langLabel(it.lang)}
                      </span>
                      <span>·</span>
                      <span>{new Date(it.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopy(it.id, it.text)}
                        title="Copy text"
                        className="flex items-center gap-1 rounded-[3px] border border-border bg-secondary-background px-2 py-1 text-[10px] font-bold hover:bg-muted transition"
                      >
                        {copiedId === it.id ? (
                          <><Check className="h-3 w-3 text-success" /> Copied</>
                        ) : (
                          <><Copy className="h-3 w-3" /> Copy</>
                        )}
                      </button>
                      <button
                        onClick={() => handleSendToConsole(it)}
                        title="Send to Console"
                        className="flex items-center gap-1 rounded-[3px] border-2 border-foreground bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 transition nb-shadow-sm"
                      >
                        <Send className="h-3 w-3" /> Send to console
                      </button>
                      <button
                        onClick={() => handleDelete(it.id)}
                        title="Delete"
                        className="rounded-[3px] border border-border bg-secondary-background p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                        aria-label={t("Delete")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {/* Transcript text */}
                  <p className="px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {it.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
