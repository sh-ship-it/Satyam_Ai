import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import { ClipboardList, Trash2, Copy, Check, Mic } from "lucide-react";
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
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveTranscripts(list: Transcript[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function Transcripts() {
  const t = useT();
  const [items, setItems] = useState<Transcript[]>(loadTranscripts);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0 flex-col bg-background">
        <div className="border-b border-border bg-card px-6 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Voice transcripts")}</div>
          <h2 className="text-sm font-semibold text-foreground">{t("Saved transcripts")} · {items.length}</h2>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <ClipboardList className="h-10 w-10 opacity-30" />
              <p className="text-sm">{t("No saved transcripts yet. Use the mic and tap Save to store one.")}</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {items.map((it) => (
                <div
                  key={it.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Mic className="h-3 w-3" />
                      <span>{it.lang}</span>
                      <span>·</span>
                      <span>{new Date(it.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopy(it.id, it.text)}
                        className="flex items-center gap-1 rounded-md border border-border bg-secondary-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition"
                      >
                        {copiedId === it.id ? (
                          <>
                            <Check className="h-3 w-3" /> {t("Copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> {t("Copy")}
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(it.id)}
                        className="rounded-md border border-border bg-secondary-background p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                        aria-label={t("Delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{it.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
