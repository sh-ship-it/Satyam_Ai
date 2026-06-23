import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useRef, useState, useEffect } from "react";
import {
  Workflow, Sparkles, Save, FolderOpen, Trash2,
  Send, Loader2, X, Image, Download, Music,
  ChevronDown, Plus, ZoomIn, ZoomOut, Maximize2,
  AlertTriangle, StickyNote, Flag, MessageCircle,
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
import { layoutScene, hexToTlColor } from "@/lib/boardLayout";
import type { SceneNode, SceneEdge } from "@/lib/api/board";

export const Route = createFileRoute("/board")({
  head: () => ({ meta: [{ title: "Investigation Board · Satyam" }] }),
  component: BoardScreen,
});

// ── Color + geo helpers ───────────────────────────────────────────────────
// Hex → tldraw color token mapping now lives in boardLayout.ts (hexToTlColor)
// Keep a small local alias for the geo type
type TLColorType =
  | "red" | "blue" | "green" | "yellow" | "violet"
  | "light-red" | "orange" | "black" | "grey"
  | "light-blue" | "light-green" | "light-violet" | "white";

function tlColor(c?: string | null): TLColorType {
  return (hexToTlColor(c ?? "") || "blue") as TLColorType;
}

// ── geo shape name → tldraw geo type ─────────────────────────────────────
const GEO_MAP: Record<string, string> = {
  rectangle: "rectangle", ellipse: "ellipse", diamond: "diamond",
  hexagon: "hexagon", cloud: "cloud", star: "star", triangle: "triangle",
  rhombus: "rhombus", "arrow-right": "arrow-right", "arrow-down": "arrow-down",
  "x-box": "x-box", "check-box": "check-box",
};

// ── Apply AI SceneGraph → tldraw (async: runs dagre/elk layout first) ────
async function applySceneToEditor(
  editor: Editor,
  rawNodes: SceneNode[],
  rawEdges: SceneEdge[],
) {
  // Run production layout engine + colour harmony
  const { nodes, edges } = await layoutScene(rawNodes, rawEdges);

  const idMap: Record<string, TLShapeId> = {};

  for (const n of nodes) {
    const sid = createShapeId();
    idMap[n.id] = sid;
    const w = n.w ?? 220;
    const h = n.h ?? 100;
    const col = tlColor(n.color);
    // Map brain shape type → tldraw geo name
    const geo = (GEO_MAP[n.type] ?? "rectangle") as any;
    // Decide fill: solid for most, semi for notes/warnings
    const fill = (["note","warning","decision"].includes(n.entity_kind ?? "")
      ? "semi" : "solid") as any;

    editor.createShape({
      id: sid, type: "geo", x: n.x, y: n.y,
      props: {
        w, h, geo, color: col, fill,
        dash: "solid" as any, size: "m" as any,
        font: "sans" as any, align: "middle" as any,
        verticalAlign: "middle" as any,
        richText: toRichText(n.label ?? ""),
        url: "", growY: 0, scale: 1, labelColor: "black" as any,
      },
    });
  }

  for (const e of edges) {
    const srcId = idMap[e.source], tgtId = idMap[e.target];
    if (!srcId || !tgtId) continue;
    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId, type: "arrow",
      props: {
        color: tlColor(e.color) as any,
        dash: (e.style === "dashed" ? "dashed" : "solid") as any,
        size: "s" as any, arrowheadEnd: "arrow" as any,
        arrowheadStart: "none" as any,
        richText: toRichText(e.label ?? ""),
        start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
        bend: 0, kind: "arc" as any, labelColor: "black" as any,
        fill: "none" as any, font: "sans" as any,
        labelPosition: 0.5, scale: 1, elbowMidPoint: 0.5,
      },
    });
    editor.createBindings([
      { fromId: arrowId, toId: srcId, type: "arrow",
        props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
      { fromId: arrowId, toId: tgtId, type: "arrow",
        props: { terminal: "end",   normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    ]);
  }

  editor.zoomToFit({ animation: { duration: 500 } });
}

// ── Quick-insert shape palette (geo variants, errors, annotations) ────────
const GEO_SHAPES = [
  { geo: "rectangle",       label: "Rect",     icon: "▭" },
  { geo: "ellipse",         label: "Ellipse",  icon: "⬭" },
  { geo: "triangle",        label: "Triangle", icon: "△" },
  { geo: "diamond",         label: "Diamond",  icon: "◇" },
  { geo: "pentagon",        label: "Pentagon", icon: "⬠" },
  { geo: "hexagon",         label: "Hexagon",  icon: "⬡" },
  { geo: "star",            label: "Star",     icon: "★" },
  { geo: "rhombus",         label: "Rhombus",  icon: "◆" },
  { geo: "cloud",           label: "Cloud",    icon: "☁" },
  { geo: "arrow-right",     label: "Arrow→",   icon: "➡" },
  { geo: "arrow-down",      label: "Arrow↓",   icon: "⬇" },
  { geo: "x-box",           label: "X-box",    icon: "✖" },
  { geo: "check-box",       label: "Check",    icon: "☑" },
] as const;

// Error/annotation types — these create styled "alert" notes
const ERROR_SHAPES = [
  { kind: "error",   label: "Error",   color: "red"    as TLColorType, fill: "semi", icon: "✖" },
  { kind: "warning", label: "Warning", color: "yellow" as TLColorType, fill: "semi", icon: "⚠" },
  { kind: "info",    label: "Info",    color: "blue"   as TLColorType, fill: "semi", icon: "ℹ" },
  { kind: "note",    label: "Note",    color: "violet" as TLColorType, fill: "semi", icon: "✎" },
  { kind: "flag",    label: "Flag",    color: "orange" as TLColorType, fill: "solid", icon: "⚑" },
  { kind: "success", label: "OK",      color: "green"  as TLColorType, fill: "solid", icon: "✔" },
] as const;

const SHAPE_SIZES = [
  { key: "xs", label: "XS", w: 80,  h: 50  },
  { key: "s",  label: "S",  w: 160, h: 80  },
  { key: "m",  label: "M",  w: 240, h: 120 },
  { key: "l",  label: "L",  w: 360, h: 160 },
  { key: "xl", label: "XL", w: 480, h: 240 },
] as const;

// ── Shape/Error/Import quick palette ─────────────────────────────────────
function ShapePalette({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"shapes" | "errors" | "import">("shapes");
  const [selSize, setSelSize] = useState<typeof SHAPE_SIZES[number]["key"]>("m");
  const imgRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  function getViewCenter(): { x: number; y: number } {
    const vp = editor.getViewportPageBounds();
    return { x: vp.midX, y: vp.midY };
  }

  function insertGeo(geo: string) {
    const size = SHAPE_SIZES.find(s => s.key === selSize) ?? SHAPE_SIZES[2];
    const { x, y } = getViewCenter();
    const sid = createShapeId();
    editor.createShape({
      id: sid, type: "geo",
      x: x - size.w / 2, y: y - size.h / 2,
      props: {
        geo: geo as any, w: size.w, h: size.h,
        color: "blue" as any, fill: "solid" as any,
        dash: "solid" as any, size: "s" as any,
        font: "sans" as any, align: "middle" as any,
        verticalAlign: "middle" as any,
        richText: toRichText(""),
        url: "", growY: 0, scale: 1, labelColor: "black" as any,
      },
    });
    editor.select(sid);
  }

  function insertError(item: typeof ERROR_SHAPES[number]) {
    const size = SHAPE_SIZES.find(s => s.key === selSize) ?? SHAPE_SIZES[2];
    const { x, y } = getViewCenter();
    const sid = createShapeId();
    editor.createShape({
      id: sid, type: "geo",
      x: x - size.w / 2, y: y - size.h / 2,
      props: {
        geo: "rectangle" as any, w: size.w, h: size.h,
        color: item.color, fill: item.fill as any,
        dash: "solid" as any, size: "s" as any,
        font: "sans" as any, align: "middle" as any,
        verticalAlign: "middle" as any,
        richText: toRichText(`${item.icon} ${item.label}`),
        url: "", growY: 0, scale: 1, labelColor: "black" as any,
      },
    });
    editor.select(sid);
  }

  async function importImages(files: FileList | null) {
    if (!files) return;
    const { x, y } = getViewCenter();
    let offsetX = 0;
    for (const file of Array.from(files)) {
      await editor.putExternalContent({
        type: "files",
        files: [file],
        point: { x: x + offsetX, y },
        ignoreParent: false,
      });
      offsetX += 20;
    }
    toast.success(`Imported ${files.length} image${files.length > 1 ? "s" : ""}.`);
  }

  async function importAudio(files: FileList | null) {
    if (!files) return;
    const { x, y } = getViewCenter();
    let offsetX = 0;
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const sid = createShapeId();
      editor.createShape({
        id: sid, type: "geo",
        x: x + offsetX, y: y,
        props: {
          geo: "rectangle" as any, w: 260, h: 72,
          color: "violet" as any, fill: "semi" as any,
          dash: "solid" as any, size: "s" as any,
          font: "sans" as any, align: "middle" as any,
          verticalAlign: "middle" as any,
          richText: toRichText(`🎵 ${file.name}`),
          url, growY: 0, scale: 1, labelColor: "black" as any,
        },
      });
      offsetX += 280;
    }
    toast.success(`Added ${files.length} audio clip${files.length > 1 ? "s" : ""} as evidence cards.`);
  }

  return (
    <div className="absolute left-3 top-12 z-[500] pointer-events-auto select-none">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 rounded-[5px] border-2 px-2.5 py-1.5 text-[11px] font-bold shadow transition ${open ? "border-primary bg-primary text-primary-foreground" : "border-foreground bg-card hover:bg-muted"}`}
        title={t("Insert shapes / errors / media")}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("Insert")}
        <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-1 w-72 rounded-[8px] border-2 border-foreground bg-card shadow-2xl">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {(["shapes", "errors", "import"] as const).map(tab_ => (
              <button key={tab_}
                onClick={() => setTab(tab_)}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${tab === tab_ ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                {tab_ === "shapes" ? "Shapes" : tab_ === "errors" ? "Errors" : "Import"}
              </button>
            ))}
          </div>

          {/* Size selector — shared across tabs */}
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground mr-1">Size</span>
            {SHAPE_SIZES.map(s => (
              <button key={s.key} onClick={() => setSelSize(s.key)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition ${selSize === s.key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="p-2">
            {tab === "shapes" && (
              <div className="grid grid-cols-4 gap-1.5">
                {GEO_SHAPES.map(s => (
                  <button key={s.geo} onClick={() => { insertGeo(s.geo); setOpen(false); }}
                    className="flex flex-col items-center gap-0.5 rounded-[5px] border border-border py-2 text-center hover:bg-muted transition"
                    title={s.label}
                  >
                    <span className="text-lg leading-none">{s.icon}</span>
                    <span className="text-[9px] text-muted-foreground">{s.label}</span>
                  </button>
                ))}
              </div>
            )}

            {tab === "errors" && (
              <div className="grid grid-cols-3 gap-1.5">
                {ERROR_SHAPES.map(e => (
                  <button key={e.kind} onClick={() => { insertError(e); setOpen(false); }}
                    className="flex flex-col items-center gap-0.5 rounded-[5px] border border-border py-2 text-center hover:bg-muted transition"
                    title={e.label}
                  >
                    <span className="text-xl leading-none">{e.icon}</span>
                    <span className="text-[9px] text-muted-foreground">{e.label}</span>
                  </button>
                ))}
              </div>
            )}

            {tab === "import" && (
              <div className="space-y-2">
                <button onClick={() => imgRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-[5px] border-2 border-dashed border-border bg-muted/20 px-3 py-3 hover:border-primary hover:bg-primary/5 transition">
                  <Image className="h-4 w-4 text-primary shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Import PNG / JPG</div>
                    <div className="text-[10px] text-muted-foreground">Paste images onto canvas</div>
                  </div>
                </button>
                <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { importImages(e.target.files); e.target.value = ""; setOpen(false); }} />

                <button onClick={() => audioRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-[5px] border-2 border-dashed border-border bg-muted/20 px-3 py-3 hover:border-primary hover:bg-primary/5 transition">
                  <Music className="h-4 w-4 text-violet-500 shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Import Audio Clip</div>
                    <div className="text-[10px] text-muted-foreground">MP3, WAV, M4A → evidence card</div>
                  </div>
                </button>
                <input ref={audioRef} type="file" accept="audio/*" multiple className="hidden"
                  onChange={e => { importAudio(e.target.files); e.target.value = ""; setOpen(false); }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Zoom controls ─────────────────────────────────────────────────────────
function ZoomControls({ editor }: { editor: Editor }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const unsub = editor.store.listen(() => {
      setZoom(editor.getZoomLevel());
    });
    return unsub;
  }, [editor]);

  return (
    <div className="absolute bottom-16 left-3 z-[500] pointer-events-auto flex flex-col items-center gap-0.5">
      <button onClick={() => editor.zoomIn()}
        className="flex h-7 w-7 items-center justify-center rounded-[5px] border-2 border-foreground bg-card hover:bg-muted shadow transition">
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.resetZoom()}
        className="flex h-7 w-auto min-w-[2rem] items-center justify-center rounded-[5px] border-2 border-foreground bg-card px-1 text-[10px] font-bold hover:bg-muted shadow transition"
        title="Reset zoom">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => editor.zoomOut()}
        className="flex h-7 w-7 items-center justify-center rounded-[5px] border-2 border-foreground bg-card hover:bg-muted shadow transition">
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => editor.zoomToFit({ animation: { duration: 300 } })}
        className="flex h-7 w-7 items-center justify-center rounded-[5px] border-2 border-foreground bg-card hover:bg-muted shadow transition" title="Fit all">
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Top bar (no sidebar — load boards as inline dropdown) ─────────────────
function TopBar({
  boardTitle, setBoardTitle,
  onSave, saving, onNew, onExport,
  aiPrompt, setAiPrompt,
  aiImages, setAiImages,
  aiLoading, onGenerate,
  showAI, setShowAI,
  savedBoards, loadBoard, onOpenList,
  loadingList,
}: {
  boardTitle: string; setBoardTitle: (v: string) => void;
  onSave: () => void; saving: boolean;
  onNew: () => void; onExport: () => void;
  aiPrompt: string; setAiPrompt: (v: string) => void;
  aiImages: BoardImage[]; setAiImages: (imgs: BoardImage[]) => void;
  aiLoading: boolean; onGenerate: () => void;
  showAI: boolean; setShowAI: (v: boolean) => void;
  savedBoards: { board_id: number; title: string; orphaned?: boolean }[];
  loadBoard: (id: number) => void;
  onOpenList: () => void;
  loadingList: boolean;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  function attachImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) =>
        setAiImages([...aiImages, { name: file.name, data_url: e.target?.result as string }]);
      reader.readAsDataURL(file);
    });
  }

  return (
    <>
      <div className="absolute top-0 left-0 right-0 z-[500] flex items-center gap-1.5 border-b-2 border-foreground bg-card px-3 py-2 pointer-events-auto">
        <Workflow className="h-4 w-4 shrink-0 text-primary" />
        <input value={boardTitle} onChange={e => setBoardTitle(e.target.value)}
          className="w-36 rounded-[4px] border border-border bg-background px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-primary" />
        <span className="h-4 w-px bg-border mx-1" />
        <button onClick={onNew}
          className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
          + {t("New")}
        </button>
        <span className="flex-1" />

        {/* AI toggle */}
        <button onClick={() => setShowAI(!showAI)}
          className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px] font-bold transition ${showAI ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
          <Sparkles className="h-3.5 w-3.5" /> AI
        </button>

        <button onClick={onExport}
          className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
          <Download className="h-3.5 w-3.5" /> Export PNG
        </button>

        {/* Save button */}
        <button onClick={onSave} disabled={saving}
          className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground px-3 py-1 text-[11px] font-bold disabled:opacity-50 hover:bg-primary/90 transition">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t("Save")}
        </button>

        {/* Load saved — inline dropdown */}
        <div className="relative">
          <button
            onClick={() => { onOpenList(); setShowDropdown(v => !v); }}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition"
            title={t("Load saved canvas")}>
            <FolderOpen className="h-3.5 w-3.5" />
            {t("Open")}
            <ChevronDown className={`h-3 w-3 transition ${showDropdown ? "rotate-180" : ""}`} />
          </button>
          {showDropdown && (
            <>
              <div className="fixed inset-0 z-[600]" onClick={() => setShowDropdown(false)} />
              <div className="absolute right-0 top-full mt-1 z-[700] w-64 rounded-[8px] border-2 border-foreground bg-card shadow-2xl overflow-hidden">
                <div className="border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {t("Saved boards")}
                </div>
                {loadingList ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Loading…")}
                  </div>
                ) : savedBoards.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">{t("No saved boards yet.")}</div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {savedBoards.map(b => (
                      <button key={b.board_id}
                        onClick={() => { loadBoard(b.board_id); setShowDropdown(false); }}
                        className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs hover:bg-muted transition">
                        <Workflow className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate font-semibold flex-1">{b.title}</span>
                        {b.orphaned && (
                          <span className="shrink-0 rounded-[3px] bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-600">
                            Recover
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Clear */}
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
            <button onClick={() => setShowAI(false)} className="ml-auto">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
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
                <Image className="h-3 w-3" /> {t("Photo")}
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

// ── Inner component (editor context) ─────────────────────────────────────
function BoardInner({
  boardTitle, setBoardTitle, boardId, setBoardId, saving, setSaving,
  savedBoards, setSavedBoards,
}: {
  boardTitle: string; setBoardTitle: (v: string) => void;
  boardId: number | null; setBoardId: (id: number | null) => void;
  saving: boolean; setSaving: (v: boolean) => void;
  savedBoards: { board_id: number; title: string; orphaned?: boolean }[];
  setSavedBoards: (list: { board_id: number; title: string; orphaned?: boolean }[]) => void;
}) {
  const editor = useEditor();
  const t = useT();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiImages, setAiImages] = useState<BoardImage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAI, setShowAI] = useState(true);
  const [loadingList, setLoadingList] = useState(false);

  // Voice Screen Agent: execute structured actions for /board.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/board") return;
      const actions = Array.isArray(d.actions) ? d.actions : [];
      for (const a of actions) {
        if (a.screen !== "/board") continue;
        const p = a.params || {};
        if (a.action === "generate_scene" && p.prompt) {
          setShowAI(true);
          setAiPrompt(String(p.prompt));
          setTimeout(() => handleGenerate(), 100);
        } else if (a.action === "save") handleSave();
        else if (a.action === "new") handleNew();
        else if (a.action === "export") handleExport();
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Hands-free board control: the Shell dispatches "satyam:hands-board"
  // while the officer is on /board and uses camera gestures. We translate
  // those gestures into pan (horizontal camera moves) and zoom (in/out
  // around the viewport centre) on the SAME tldraw editor instance.
  useEffect(() => {
    const onHands = (e: Event) => {
      if (!editor) return;
      const d = (e as CustomEvent).detail as
        | { action: "pan"; dir: "left" | "right" }
        | { action: "zoom"; delta: 1 | -1 }
        | undefined;
      if (!d) return;
      try {
        if (d.action === "pan") {
          // Pan horizontally by a quarter of the viewport width. Camera x
          // is in page space, so divide the screen step by the zoom level.
          const cam = editor.getCamera();
          const bounds = editor.getViewportScreenBounds();
          const step = (bounds.w * 0.25) / cam.z;
          editor.setCamera(
            { x: cam.x + (d.dir === "right" ? -step : step), y: cam.y, z: cam.z },
            { animation: { duration: 200 } },
          );
        } else if (d.action === "zoom") {
          if (d.delta > 0) editor.zoomIn();
          else editor.zoomOut();
        }
      } catch (err) {
        console.error("[board] hands-free control failed:", err);
      }
    };
    window.addEventListener("satyam:hands-board", onHands);
    return () => window.removeEventListener("satyam:hands-board", onHands);
  }, [editor]);

  // Force light color mode on the editor so draw strokes use dark colours
  // on the white canvas. tldraw resolves stroke colours via
  // editor.getColorMode() → editor.user preferences, NOT just the
  // colorScheme prop. If the user's OS/localStorage says "dark", strokes
  // render white-on-white. We pin it to 'light' for the board.
  useEffect(() => {
    try {
      editor.user.updateUserPreferences({ colorScheme: "light" });
    } catch { /* API may differ across patch versions */ }
    editor.updateInstanceState({ isReadonly: false });
  }, [editor]);

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
      // Always refresh list so the just-saved board appears in Open dropdown
      const list = await boardApi.list();
      setSavedBoards(list as { board_id: number; title: string; orphaned?: boolean }[]);
    } catch (err) {
      console.error("[board] save failed:", err);
      toast.error("Could not save board.");
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenList() {
    setLoadingList(true);
    try {
      const list = await boardApi.list();
      setSavedBoards(list as { board_id: number; title: string; orphaned?: boolean }[]);
    } catch (err) {
      console.error("[board] list failed:", err);
      toast.error("Could not load boards — check you are signed in.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadBoard(id: number) {
    try {
      // Auto-claim orphaned boards when the user loads them
      const item = savedBoards.find(b => b.board_id === id);
      if (item?.orphaned) {
        await boardApi.claim(id).catch(() => {/* non-fatal */});
      }
      const b = await boardApi.load(id);
      const snap = (b.state_json as any).snapshot;
      if (snap) editor.loadSnapshot(snap);
      setBoardId(b.board_id);
      setBoardTitle(b.title);
      editor.zoomToFit({ animation: { duration: 400 } });
      // Refresh list so orphaned flag disappears
      const list = await boardApi.list();
      setSavedBoards(list);
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
    } catch { toast.error("Export failed."); }
  }

  async function handleGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const { boardEngine, brainEngine } = loadEngineSettings();
      // Pass the current canvas snapshot so the brain can merge incrementally
      const existingSnapshot = editor.getSnapshot() as unknown as Record<string, unknown>;
      const scene = await boardApi.generate({
        prompt: aiPrompt,
        images: aiImages,
        brain_engine: boardEngine || brainEngine || "gemini",
        existing_snapshot: existingSnapshot,
      });
      if (scene.nodes.length === 0) {
        toast.info("AI returned an empty scene. Try a more specific prompt.");
      } else {
        await applySceneToEditor(editor, scene.nodes as any, scene.edges as any);
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
      <TopBar
        boardTitle={boardTitle} setBoardTitle={setBoardTitle}
        onSave={handleSave} saving={saving}
        onNew={handleNew} onExport={handleExport}
        aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
        aiImages={aiImages} setAiImages={setAiImages}
        aiLoading={aiLoading} onGenerate={handleGenerate}
        showAI={showAI} setShowAI={setShowAI}
        savedBoards={savedBoards} loadBoard={loadBoard}
        onOpenList={handleOpenList} loadingList={loadingList}
      />
      <ShapePalette editor={editor} />
      <ZoomControls editor={editor} />
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────
function BoardScreen() {
  const [boardTitle, setBoardTitle] = useState("Untitled board");
  const [boardId, setBoardId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // savedBoards lives HERE (not in BoardInner) so it survives any tldraw remount
  const [savedBoards, setSavedBoards] = useState<{ board_id: number; title: string; orphaned?: boolean }[]>([]);

  // Pre-load the list once so Open dropdown is always populated
  useEffect(() => {
    boardApi.list()
      .then(list => setSavedBoards(list as { board_id: number; title: string; orphaned?: boolean }[]))
      .catch(() => {});
  }, []);

  return (
    <Shell>
      <div
        className="relative h-[calc(100vh-3.5rem)] min-h-0"
        data-color-scheme="light"
        style={{
          /* Force tldraw's entire light-theme palette on this subtree.
           * Our Tailwind dark mode sets color-scheme:dark on <html> which
           * causes tldraw's JS to apply .tl-theme__dark → white strokes on
           * white canvas. These overrides guarantee the light palette wins. */
          ["--tl-color-background" as string]: "hsl(210, 20%, 98%)",
          ["--tl-color-grid" as string]: "hsl(0, 0%, 43%)",
          ["--tl-color-text" as string]: "hsl(0, 0%, 0%)",
          ["--tl-color-text-0" as string]: "hsl(0, 0%, 11%)",
          ["--tl-color-text-1" as string]: "hsl(0, 0%, 18%)",
          ["--tl-color-low" as string]: "hsl(204, 16%, 94%)",
          ["--tl-color-panel" as string]: "hsl(0, 0%, 99%)",
          ["--tl-color-panel-contrast" as string]: "hsl(0, 0%, 100%)",
          ["--tl-color-divider" as string]: "hsl(0, 0%, 91%)",
          /* Neutralise our app's --bg so it can't bleed */
          ["--bg" as string]: "hsl(210, 20%, 98%)",
          isolation: "isolate",
          colorScheme: "light",
        }}
      >
        <Tldraw
          persistenceKey="satyam-investigation-board"
          colorScheme="light"
          options={{ maxPages: 1 }}
          cameraOptions={{ zoomSteps: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] }}
        >
          <BoardInner
            boardTitle={boardTitle} setBoardTitle={setBoardTitle}
            boardId={boardId} setBoardId={setBoardId}
            saving={saving} setSaving={setSaving}
            savedBoards={savedBoards} setSavedBoards={setSavedBoards}
          />
        </Tldraw>
      </div>
    </Shell>
  );
}
