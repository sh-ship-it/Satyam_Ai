import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useRef, useState } from "react";
import {
  Workflow, Sparkles, Save, FolderOpen, Trash2,
  Send, Loader2, X, Image, Download,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { boardApi, type BoardImage } from "@/lib/api/board";
import { loadEngineSettings } from "@/components/SettingsDialog";
import { toast } from "sonner";
import {
  Tldraw,
  createShapeId,
  toRichText,
  useEditor,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";

type TLColorType = "red" | "blue" | "green" | "yellow" | "violet" | "light-red" | "orange" | "black" | "grey" | "light-blue" | "light-green" | "light-violet" | "white";

export const Route = createFileRoute("/board")({
  head: () => ({ meta: [{ title: "Investigation Board · Satyam" }] }),
  component: BoardScreen,
});

// ── helpers ───────────────────────────────────────────────────────────────

// Map any hex/name → nearest valid tldraw color token
const TL_COLORS: Record<string, TLColorType> = {
  "#ef4444": "red",  "red": "red",
  "#3b82f6": "blue", "blue": "blue",
  "#22c55e": "green","green": "green",
  "#f59e0b": "yellow","yellow": "yellow",
  "#a855f7": "violet","violet": "violet",
  "#ff5ce0": "light-red",
  "#f97316": "orange","orange": "orange",
};
function tlColor(c?: string | null): TLColorType {
  if (!c) return "blue";
  return TL_COLORS[c.toLowerCase()] ?? "blue";
}

// ── Map AI SceneGraph → tldraw shapes ────────────────────────────────────
function applySceneToEditor(
  editor: Editor,
  nodes: { id: string; type: string; x: number; y: number; w?: number; h?: number; label?: string; color?: string }[],
  edges: { source: string; target: string; label?: string; color?: string; style?: string }[],
) {
  const idMap: Record<string, TLShapeId> = {};

  for (const n of nodes) {
    const sid = createShapeId();
    idMap[n.id] = sid;
    const w = n.w ?? 220, h = n.h ?? 80;
    const col = tlColor(n.color);
    const geoStyle = n.type === "note" ? "rectangle" : "rectangle";
    const fillStyle = n.type === "note" ? "semi" : "solid";

    editor.createShape({
      id: sid, type: "geo",
      x: n.x, y: n.y,
      props: {
        w, h,
        geo: geoStyle as any,
        color: col,
        fill: fillStyle as any,
        dash: "solid" as any,
        size: "s" as any,
        font: "sans" as any,
        align: "middle" as any,
        verticalAlign: "middle" as any,
        richText: toRichText(n.label ?? ""),
        url: "",
        growY: 0,
        scale: 1,
        labelColor: "black" as any,
      },
    });
  }

  for (const e of edges) {
    const srcId = idMap[e.source];
    const tgtId = idMap[e.target];
    if (!srcId || !tgtId) continue;

    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId,
      type: "arrow",
      props: {
        color: tlColor(e.color) as any,
        dash: (e.style === "dashed" ? "dashed" : "solid") as any,
        size: "s" as any,
        arrowheadEnd: "arrow" as any,
        arrowheadStart: "none" as any,
        richText: toRichText(e.label ?? ""),
        start: { x: 0, y: 0 },
        end:   { x: 100, y: 0 },
        bend: 0,
        kind: "arc" as any,
        labelColor: "black" as any,
        fill: "none" as any,
        font: "sans" as any,
        labelPosition: 0.5,
        scale: 1,
        elbowMidPoint: 0.5,
      },
    });

    // Bind the arrow to source and target shapes
    editor.createBindings([
      {
        fromId: arrowId, toId: srcId,
        type: "arrow",
        props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
      },
      {
        fromId: arrowId, toId: tgtId,
        type: "arrow",
        props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
      },
    ]);
  }

  editor.zoomToFit({ animation: { duration: 400 } });
}

// ── Floating toolbar overlay ──────────────────────────────────────────────
function BoardToolbar({
  boardTitle, setBoardTitle,
  onSave, saving, onOpen, onNew, onExport,
  aiPrompt, setAiPrompt,
  aiImages, setAiImages,
  aiLoading, onGenerate,
}: {
  boardTitle: string; setBoardTitle: (v: string) => void;
  onSave: () => void; saving: boolean;
  onOpen: () => void; onNew: () => void; onExport: () => void;
  aiPrompt: string; setAiPrompt: (v: string) => void;
  aiImages: BoardImage[]; setAiImages: (imgs: BoardImage[]) => void;
  aiLoading: boolean; onGenerate: () => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showAI, setShowAI] = useState(true);

  function attachImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setAiImages([...aiImages, { name: file.name, data_url: e.target?.result as string }]);
      reader.readAsDataURL(file);
    });
  }

  return (
    <>
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-[500] flex items-center gap-1.5 border-b-2 border-foreground bg-card px-3 py-2 pointer-events-auto">
        <Workflow className="h-4 w-4 shrink-0 text-primary" />
        <input value={boardTitle} onChange={e => setBoardTitle(e.target.value)}
          className="w-36 rounded-[4px] border border-border bg-background px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-primary" />
        <span className="h-4 w-px bg-border mx-1" />
        <button onClick={onNew} className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
          + {t("New")}
        </button>
        <span className="flex-1" />
        <button onClick={() => setShowAI(v => !v)}
          className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px] font-bold transition ${showAI ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
          <Sparkles className="h-3.5 w-3.5" /> AI
        </button>
        <button onClick={onExport}
          className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
          <Download className="h-3.5 w-3.5" /> Export PNG
        </button>
        <button onClick={onOpen}
          className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
          <FolderOpen className="h-3.5 w-3.5" /> Open
        </button>
        <button onClick={onSave} disabled={saving}
          className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground px-3 py-1 text-[11px] font-bold disabled:opacity-50 hover:bg-primary/90 transition">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
        <button onClick={() => { if (confirm("Clear board?")) onNew(); }}
          className="rounded-[5px] border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10 transition">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* AI chatbox */}
      {showAI && (
        <div className="absolute bottom-16 right-4 z-[500] w-80 rounded-[8px] border-2 border-foreground bg-card shadow-2xl pointer-events-auto">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-extrabold">{t("AI Scene Generator")}</span>
            <button onClick={() => setShowAI(false)} className="ml-auto"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
          </div>
          <div className="p-2 space-y-2">
            {aiImages.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {aiImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img.data_url} alt="" className="h-10 w-10 rounded object-cover border border-border" />
                    <button onClick={() => setAiImages(aiImages.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-white rounded-full h-4 w-4 flex items-center justify-center text-[9px]">×</button>
                  </div>
                ))}
              </div>
            )}
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onGenerate(); }}
              placeholder={t("Describe suspects, evidence, crime scene… (Ctrl+Enter)")}
              rows={3}
              className="w-full resize-none rounded-[5px] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
            />
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted transition">
                <Image className="h-3 w-3" /> Photo
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => attachImages(e.target.files)} />
              <button onClick={onGenerate} disabled={aiLoading || !aiPrompt.trim()}
                className="flex flex-1 items-center justify-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition">
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {aiLoading ? t("Generating…") : t("Generate")}
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground">{t("AI builds the scene — use tldraw tools to edit anything.")}</p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Inner component (has access to editor context) ────────────────────────
function BoardInner({
  boardTitle, setBoardTitle, boardId, setBoardId, saving, setSaving,
}: {
  boardTitle: string; setBoardTitle: (v: string) => void;
  boardId: number | null; setBoardId: (id: number | null) => void;
  saving: boolean; setSaving: (v: boolean) => void;
}) {
  const editor = useEditor();
  const t = useT();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiImages, setAiImages] = useState<BoardImage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [savedBoards, setSavedBoards] = useState<{ board_id: number; title: string }[]>([]);
  const [showBoards, setShowBoards] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const snapshot = editor.getSnapshot();
      const res = await boardApi.save({
        board_id: boardId, title: boardTitle,
        state_json: { snapshot } as unknown as Record<string, unknown>,
      });
      setBoardId(res.board_id);
      toast.success(`"${boardTitle}" saved.`);
    } catch { toast.error("Could not save board."); }
    finally { setSaving(false); }
  }

  async function handleOpen() {
    try {
      const list = await boardApi.list();
      setSavedBoards(list as { board_id: number; title: string }[]);
      setShowBoards(true);
    } catch { toast.error("Could not load boards."); }
  }

  async function loadBoard(id: number) {
    try {
      const b = await boardApi.load(id);
      const snap = (b.state_json as any).snapshot;
      if (snap) editor.loadSnapshot(snap);
      setBoardId(b.board_id);
      setBoardTitle(b.title);
      setShowBoards(false);
      editor.zoomToFit({ animation: { duration: 400 } });
    } catch { toast.error("Could not open board."); }
  }

  function handleNew() {
    editor.selectAll();
    editor.deleteShapes(editor.getSelectedShapeIds());
    setBoardId(null);
    setBoardTitle("Untitled board");
  }

  async function handleExport() {
    try {
      const ids = [...editor.getCurrentPageShapeIds()];
      if (ids.length === 0) { toast.info("Nothing to export — add some shapes first."); return; }
      const { blob } = await editor.toImage(ids, { format: "png" as any, pixelRatio: 2, background: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${boardTitle || "board"}.png`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error("Export failed."); }
  }

  async function handleGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const { boardEngine, brainEngine } = loadEngineSettings();
      const scene = await boardApi.generate({
        prompt: aiPrompt, images: aiImages,
        brain_engine: boardEngine || brainEngine || "gemini",
      });
      if (scene.nodes.length === 0) {
        toast.info("AI returned an empty scene. Try a more specific prompt.");
      } else {
        applySceneToEditor(editor, scene.nodes as any, scene.edges as any);
        toast.success(`Added ${scene.nodes.length} shapes, ${scene.edges.length} connections.`);
        setAiPrompt(""); setAiImages([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const isRate = msg.includes("429") || msg.toLowerCase().includes("rate");
      toast.error(isRate
        ? "Rate limit hit — switch to Groq in Settings → Models → Board AI, then try again."
        : `AI generation failed: ${msg}`);
    } finally { setAiLoading(false); }
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      <BoardToolbar
        boardTitle={boardTitle} setBoardTitle={setBoardTitle}
        onSave={handleSave} saving={saving}
        onOpen={handleOpen} onNew={handleNew} onExport={handleExport}
        aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
        aiImages={aiImages} setAiImages={setAiImages}
        aiLoading={aiLoading} onGenerate={handleGenerate}
      />

      {/* Saved boards panel */}
      {showBoards && (
        <div className="absolute right-0 top-10 h-[calc(100%-2.5rem)] w-64 border-l-2 border-foreground bg-card shadow-xl z-[500] flex flex-col pointer-events-auto">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-extrabold">{t("Saved Boards")}</span>
            <button onClick={() => setShowBoards(false)}><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-auto">
            {savedBoards.length === 0 && <div className="p-4 text-xs text-muted-foreground">{t("No saved boards yet.")}</div>}
            {savedBoards.map(b => (
              <button key={b.board_id} onClick={() => loadBoard(b.board_id)}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs hover:bg-muted transition">
                <Workflow className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate font-semibold">{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────
function BoardScreen() {
  const [boardTitle, setBoardTitle] = useState("Untitled board");
  const [boardId, setBoardId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Shell>
      {/*
        tldraw needs its own bg — our CSS var (--bg) bleeds in and turns the
        canvas black. We set an explicit white background here so tldraw's
        light theme works correctly, completely isolated from our app theme.
      */}
      <div
        className="relative h-[calc(100vh-3.5rem)] min-h-0"
        style={{
          background: "#ffffff",
          isolation: "isolate",
          // Override any CSS vars our app sets so they don't leak into tldraw
          ["--bg" as string]: "#ffffff",
          ["--bg2" as string]: "#f4f4f4",
          ["--text" as string]: "#0a0a0a",
        }}
      >
        <Tldraw
          persistenceKey={`satyam-board-${boardId ?? "new"}`}
          colorScheme="light"
          options={{ maxPages: 1 }}
        >
          <BoardInner
            boardTitle={boardTitle} setBoardTitle={setBoardTitle}
            boardId={boardId} setBoardId={setBoardId}
            saving={saving} setSaving={setSaving}
          />
        </Tldraw>
      </div>
    </Shell>
  );
}
