import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import React, {
  useCallback, useEffect, useRef, useState, useReducer,
} from "react";
import {
  ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges,
  Background, Controls, MiniMap,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  type NodeTypes, Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Workflow, Sparkles, Save, FolderOpen, Trash2, Plus,
  Link2, Image, StickyNote, Send, Loader2, X,
  Pencil, Undo2, Redo2,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { boardApi, type SceneGraph, type BoardImage } from "@/lib/api/board";
import { toast } from "sonner";

export const Route = createFileRoute("/board")({
  head: () => ({ meta: [{ title: "Investigation Board · Satyam" }] }),
  component: BoardScreen,
});

// ── Custom node types ─────────────────────────────────────────────────────

function PhotoNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-[6px] border-2 border-foreground bg-card shadow-md overflow-hidden"
      style={{ width: 160, minHeight: 120 }}>
      {data.src ? (
        <img src={data.src as string} alt={data.label as string}
          className="w-full h-28 object-cover" />
      ) : (
        <div className="w-full h-28 flex items-center justify-center bg-muted">
          <Image className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      <div className="px-2 py-1 text-[10px] font-bold truncate bg-foreground text-background">
        {(data.label as string) || "Photo"}
      </div>
    </div>
  );
}

function NoteNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-[6px] border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 shadow p-3"
      style={{ width: 180, minHeight: 80 }}>
      <div className="text-xs font-semibold text-foreground whitespace-pre-wrap">
        {(data.label as string) || "Note"}
      </div>
    </div>
  );
}

function EntityNode({ data }: { data: Record<string, unknown> }) {
  const color = (data.color as string) ?? "#3b82f6";
  return (
    <div className="rounded-[6px] border-2 bg-card shadow-md px-3 py-2"
      style={{ borderColor: color, minWidth: 120 }}>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
        {(data.entity_kind as string) || "entity"}
      </div>
      <div className="text-xs font-semibold text-foreground mt-0.5 truncate">
        {(data.label as string) || "—"}
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  photo:  PhotoNode,
  note:   NoteNode,
  entity: EntityNode,
};

// ── Helpers ───────────────────────────────────────────────────────────────

let _nodeCounter = 0;
function uid(prefix = "n") { return `${prefix}-${++_nodeCounter}-${Date.now()}`; }

function sceneToFlow(scene: SceneGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = scene.nodes.map((n) => ({
    id: n.id,
    type: n.type === "image" || n.type === "photo" ? "photo"
        : n.type === "note" ? "note"
        : "entity",
    position: { x: n.x, y: n.y },
    data: { label: n.label, color: n.color, entity_kind: n.entity_kind },
    style: { width: n.w },
  }));
  const edges: Edge[] = scene.edges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: e.color ?? "#ef4444", strokeWidth: 2,
             strokeDasharray: e.style === "dashed" ? "6 3" : undefined },
    animated: false,
    type: "default",
    markerEnd: { type: "arrowclosed" as const, color: e.color ?? "#ef4444" },
    data: { kind: e.kind },
  }));
  return { nodes, edges };
}

// ── Undo/Redo history ─────────────────────────────────────────────────────
type BoardState = { nodes: Node[]; edges: Edge[] };
type HistoryAction =
  | { type: "SET"; nodes: Node[]; edges: Edge[] }
  | { type: "UNDO" }
  | { type: "REDO" };

type HistoryStore = {
  past:    BoardState[];
  present: BoardState;
  future:  BoardState[];
};

function historyReducer(store: HistoryStore, action: HistoryAction): HistoryStore {
  switch (action.type) {
    case "SET": {
      // only push to history if state actually changed
      const same =
        JSON.stringify(store.present.nodes) === JSON.stringify(action.nodes) &&
        JSON.stringify(store.present.edges) === JSON.stringify(action.edges);
      if (same) return store;
      return {
        past:    [...store.past.slice(-49), store.present],
        present: { nodes: action.nodes, edges: action.edges },
        future:  [],
      };
    }
    case "UNDO": {
      if (store.past.length === 0) return store;
      const prev = store.past[store.past.length - 1];
      return {
        past:    store.past.slice(0, -1),
        present: prev,
        future:  [store.present, ...store.future.slice(0, 49)],
      };
    }
    case "REDO": {
      if (store.future.length === 0) return store;
      const next = store.future[0];
      return {
        past:    [...store.past.slice(-49), store.present],
        present: next,
        future:  store.future.slice(1),
      };
    }
  }
}

// ── Pencil draw types ─────────────────────────────────────────────────────
type DrawPath = { id: string; points: [number, number][]; color: string; width: number };

const PENCIL_COLORS = [
  { color: "#ef4444", label: "Red" },
  { color: "#3b82f6", label: "Blue" },
  { color: "#22c55e", label: "Green" },
  { color: "#f59e0b", label: "Orange" },
  { color: "#a855f7", label: "Purple" },
  { color: "#000000", label: "Black" },
  { color: "#ffffff", label: "White" },
];

// ── Main screen ───────────────────────────────────────────────────────────

function BoardScreen() {
  const t = useT();

  // ── History-backed node/edge state ────────────────────────────────────
  const [history, dispatch] = useReducer(historyReducer, {
    past: [], present: { nodes: [], edges: [] }, future: [],
  });
  const { nodes, edges } = history.present;

  const setNodes = useCallback((updater: Node[] | ((prev: Node[]) => Node[])) => {
    const next = typeof updater === "function" ? updater(history.present.nodes) : updater;
    dispatch({ type: "SET", nodes: next, edges: history.present.edges });
  }, [history.present]);

  const setEdges = useCallback((updater: Edge[] | ((prev: Edge[]) => Edge[])) => {
    const next = typeof updater === "function" ? updater(history.present.edges) : updater;
    dispatch({ type: "SET", nodes: history.present.nodes, edges: next });
  }, [history.present]);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ── Pencil drawing state ──────────────────────────────────────────────
  const [drawPaths, setDrawPaths] = useState<DrawPath[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [pencilColor, setPencilColor] = useState("#ef4444");
  const [pencilWidth, setPencilWidth] = useState(3);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const drawingRef = useRef(false);
  const currentPathRef = useRef<[number, number][]>([]);
  const svgLayerRef = useRef<SVGSVGElement>(null);
  const rfWrapperRef = useRef<HTMLDivElement>(null);

  function getCanvasPoint(e: React.MouseEvent): [number, number] {
    const rect = rfWrapperRef.current?.getBoundingClientRect();
    if (!rect) return [e.clientX, e.clientY];
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDrawStart(e: React.MouseEvent) {
    if (!drawMode) return;
    e.stopPropagation();
    drawingRef.current = true;
    currentPathRef.current = [getCanvasPoint(e)];
  }
  function onDrawMove(e: React.MouseEvent) {
    if (!drawMode || !drawingRef.current) return;
    e.stopPropagation();
    currentPathRef.current = [...currentPathRef.current, getCanvasPoint(e)];
    // live preview via SVG overlay ref
    const overlay = svgLayerRef.current?.querySelector("#live-path");
    if (overlay) overlay.setAttribute("d", pointsToPath(currentPathRef.current));
  }
  function onDrawEnd(e: React.MouseEvent) {
    if (!drawMode || !drawingRef.current) return;
    e.stopPropagation();
    drawingRef.current = false;
    if (currentPathRef.current.length > 1) {
      setDrawPaths(prev => [...prev, {
        id: uid("draw"),
        points: currentPathRef.current,
        color: pencilColor,
        width: pencilWidth,
      }]);
    }
    currentPathRef.current = [];
  }
  function clearDrawings() { setDrawPaths([]); }

  function pointsToPath(pts: [number, number][]): string {
    if (pts.length < 2) return "";
    return pts.reduce((acc, [x, y], i) =>
      i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`, "");
  }

  // ── Board CRUD ────────────────────────────────────────────────────────
  const [boardId, setBoardId]       = useState<number | null>(null);
  const [boardTitle, setBoardTitle] = useState("Untitled board");
  const [savedBoards, setSavedBoards] = useState<{ board_id: number; title: string }[]>([]);
  const [showBoards, setShowBoards] = useState(false);
  const [saving, setSaving]         = useState(false);

  // AI chatbox state
  const [aiPrompt, setAiPrompt]     = useState("");
  const [aiImages, setAiImages]     = useState<BoardImage[]>([]);
  const [aiLoading, setAiLoading]   = useState(false);
  const [linkMode, setLinkMode]     = useState(false);
  const [linkSrc, setLinkSrc]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);

  // React Flow callbacks
  const onNodesChange = useCallback((c: NodeChange[]) => {
    const next = applyNodeChanges(c, history.present.nodes);
    dispatch({ type: "SET", nodes: next, edges: history.present.edges });
  }, [history.present]);

  const onEdgesChange = useCallback((c: EdgeChange[]) => {
    const next = applyEdgeChanges(c, history.present.edges);
    dispatch({ type: "SET", nodes: history.present.nodes, edges: next });
  }, [history.present]);

  const onConnect = useCallback((c: Connection) => {
    const next = addEdge({
      ...c,
      style: { stroke: "#ef4444", strokeWidth: 2 },
      markerEnd: { type: "arrowclosed" as const, color: "#ef4444" },
      label: "",
    }, history.present.edges);
    dispatch({ type: "SET", nodes: history.present.nodes, edges: next });
  }, [history.present]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (!linkMode) return;
    if (!linkSrc) { setLinkSrc(node.id); return; }
    if (linkSrc === node.id) { setLinkSrc(null); return; }
    const label = prompt("Link label (e.g. 'Co-accused', 'Family'):", "") ?? "";
    const next = [...history.present.edges, {
      id: uid("link"), source: linkSrc, target: node.id,
      label, style: { stroke: "#ef4444", strokeWidth: 2 },
      markerEnd: { type: "arrowclosed" as const, color: "#ef4444" },
    }];
    dispatch({ type: "SET", nodes: history.present.nodes, edges: next });
    setLinkSrc(null);
    setLinkMode(false);
  }, [linkMode, linkSrc, history.present]);

  async function saveBoard() {
    setSaving(true);
    try {
      const res = await boardApi.save({
        board_id: boardId, title: boardTitle,
        state_json: { nodes, edges, drawPaths } as unknown as Record<string, unknown>,
      });
      setBoardId(res.board_id);
      toast.success(`Board "${boardTitle}" saved.`);
    } catch { toast.error("Could not save board."); }
    finally { setSaving(false); }
  }

  async function loadBoardsList() {
    try {
      const list = await boardApi.list();
      setSavedBoards(list as { board_id: number; title: string }[]);
      setShowBoards(true);
    } catch { toast.error("Could not load boards."); }
  }

  async function openBoard(id: number) {
    try {
      const b = await boardApi.load(id);
      const s = b.state_json as Record<string, unknown>;
      dispatch({ type: "SET", nodes: (s.nodes as Node[]) ?? [], edges: (s.edges as Edge[]) ?? [] });
      setDrawPaths((s.drawPaths as DrawPath[]) ?? []);
      setBoardId(b.board_id);
      setBoardTitle(b.title);
      setShowBoards(false);
    } catch { toast.error("Could not open board."); }
  }

  function newBoard() {
    dispatch({ type: "SET", nodes: [], edges: [] });
    setDrawPaths([]);
    setBoardId(null);
    setBoardTitle("Untitled board");
  }

  function addNote() {
    const text = prompt("Sticky note text:", "Note") ?? "Note";
    const next = [...nodes, { id: uid("note"), type: "note",
      position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: { label: text } }];
    dispatch({ type: "SET", nodes: next, edges });
  }

  function addEntity() {
    const label = prompt("Entity name:", "") ?? "";
    if (!label) return;
    const next = [...nodes, { id: uid("entity"), type: "entity",
      position: { x: 300 + Math.random() * 300, y: 150 + Math.random() * 300 },
      data: { label, entity_kind: "person", color: "#3b82f6" } }];
    dispatch({ type: "SET", nodes: next, edges });
  }

  function handleImageFile(files: FileList | null) {
    if (!files) return;
    const newNodes: Node[] = [];
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        newNodes.push({ id: uid("photo"), type: "photo",
          position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 },
          data: { label: file.name, src }, style: { width: 160 } });
        if (newNodes.length === files.length) {
          dispatch({ type: "SET", nodes: [...nodes, ...newNodes], edges });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const scene = await boardApi.generate({ prompt: aiPrompt, images: aiImages });
      const { nodes: newNodes, edges: newEdges } = sceneToFlow(scene);
      dispatch({ type: "SET", nodes: [...nodes, ...newNodes], edges: [...edges, ...newEdges] });
      setAiPrompt(""); setAiImages([]);
      if (newNodes.length === 0) toast.info("AI returned an empty scene. Try a more specific prompt.");
      else toast.success(`Added ${newNodes.length} nodes, ${newEdges.length} links.`);
    } catch (err: unknown) {
      toast.error(`AI generation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setAiLoading(false); }
  }

  function handleAiImageAttach(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setAiImages(prev => [...prev, { name: file.name, data_url: e.target?.result as string }]);
      reader.readAsDataURL(file);
    });
  }

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col min-h-0 bg-background">

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 border-b-2 border-foreground bg-card px-3 py-2 shrink-0 overflow-x-auto">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <input value={boardTitle} onChange={e => setBoardTitle(e.target.value)}
            className="w-36 rounded-[4px] border border-border bg-background px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-primary" />
          <span className="h-4 w-px bg-border mx-1" />

          {/* Undo / Redo */}
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="rounded-[5px] border border-border p-1.5 hover:bg-muted disabled:opacity-30 transition">
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
            className="rounded-[5px] border border-border p-1.5 hover:bg-muted disabled:opacity-30 transition">
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <span className="h-4 w-px bg-border mx-1" />

          <button onClick={newBoard}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
            <Plus className="h-3.5 w-3.5" /> New
          </button>
          <button onClick={addNote}
            className="flex items-center gap-1 rounded-[5px] border border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 text-[11px] font-bold hover:bg-yellow-100 transition">
            <StickyNote className="h-3.5 w-3.5" /> Note
          </button>
          <button onClick={addEntity}
            className="flex items-center gap-1 rounded-[5px] border border-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 text-[11px] font-bold hover:bg-blue-100 transition">
            <Plus className="h-3.5 w-3.5" /> Entity
          </button>
          <button onClick={() => imgRef.current?.click()}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
            <Image className="h-3.5 w-3.5" /> Photo
          </button>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => handleImageFile(e.target.files)} />
          <button onClick={() => { setLinkMode(l => !l); setLinkSrc(null); setDrawMode(false); }}
            className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px] font-bold transition ${linkMode ? "border-destructive bg-destructive/10 text-destructive" : "border-border hover:bg-muted"}`}>
            <Link2 className="h-3.5 w-3.5" />
            {linkMode ? (linkSrc ? "Click 2nd node…" : "Click 1st node…") : "Red Link"}
          </button>

          {/* Pencil mode */}
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => { setDrawMode(d => !d); setLinkMode(false); setShowColorPicker(false); }}
              className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px] font-bold transition ${drawMode ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
            >
              <Pencil className="h-3.5 w-3.5" />
              {drawMode ? "Drawing…" : "Draw"}
            </button>
            {/* Color swatch — click to open picker */}
            <button
              onClick={() => setShowColorPicker(p => !p)}
              className="h-6 w-6 rounded-full border-2 border-foreground shadow transition hover:scale-110"
              style={{ background: pencilColor }}
              title="Pen colour"
            />
            {/* Thickness */}
            {drawMode && (
              <select value={pencilWidth} onChange={e => setPencilWidth(Number(e.target.value))}
                className="rounded-[4px] border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold">
                <option value={2}>Thin</option>
                <option value={3}>Normal</option>
                <option value={5}>Thick</option>
                <option value={9}>Bold</option>
              </select>
            )}
            {/* Color picker palette */}
            {showColorPicker && (
              <div className="absolute top-9 left-0 z-50 flex gap-1.5 rounded-[6px] border-2 border-foreground bg-card p-2 shadow-xl">
                {PENCIL_COLORS.map(({ color, label }) => (
                  <button key={color} title={label}
                    onClick={() => { setPencilColor(color); setShowColorPicker(false); }}
                    className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${pencilColor === color ? "border-primary scale-110" : "border-foreground/30"}`}
                    style={{ background: color }}
                  />
                ))}
                {/* custom hex */}
                <input type="color" value={pencilColor}
                  onChange={e => { setPencilColor(e.target.value); setShowColorPicker(false); }}
                  className="h-6 w-6 rounded cursor-pointer border border-border"
                  title="Custom colour"
                />
              </div>
            )}
          </div>
          {drawPaths.length > 0 && (
            <button onClick={clearDrawings}
              className="flex items-center gap-1 rounded-[5px] border border-destructive/40 px-2 py-1 text-[11px] font-bold text-destructive hover:bg-destructive/10 transition">
              <X className="h-3 w-3" /> Clear ink
            </button>
          )}

          <span className="flex-1" />
          <button onClick={loadBoardsList}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
            <FolderOpen className="h-3.5 w-3.5" /> Open
          </button>
          <button onClick={saveBoard} disabled={saving}
            className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground px-3 py-1 text-[11px] font-bold hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
          <button onClick={() => { if (confirm("Clear board?")) { dispatch({ type: "SET", nodes: [], edges: [] }); setDrawPaths([]); }}}
            className="rounded-[5px] border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10 transition">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Canvas */}
        <div
          ref={rfWrapperRef}
          className="flex-1 relative min-h-0"
          style={{ cursor: drawMode ? "crosshair" : undefined }}
          onMouseDown={onDrawStart}
          onMouseMove={onDrawMove}
          onMouseUp={onDrawEnd}
          onMouseLeave={onDrawEnd}
        >
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode="Delete"
            panOnDrag={!drawMode}
            nodesDraggable={!drawMode}
            nodesConnectable={!drawMode}
          >
            <Background color="#d1d5db" gap={24} size={1.5} />
            {!drawMode && <Controls />}
            <MiniMap nodeColor={n => n.type === "photo" ? "#6366f1" : n.type === "note" ? "#fbbf24" : "#3b82f6"} />
            <Panel position="top-left">
              <div className="flex items-center gap-3 rounded-[6px] border border-border bg-card/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold text-foreground shadow">
                <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-destructive inline-block" /> Strong link</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded border-t-2 border-dashed border-destructive inline-block" /> Inferred</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-blue-500 inline-block" /> Person</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-yellow-400 inline-block" /> Note</span>
                {drawMode && <span className="text-primary animate-pulse">✏ Drawing mode ON</span>}
              </div>
            </Panel>
          </ReactFlow>

          {/* SVG freehand drawing overlay — sits on top of the canvas */}
          <svg
            ref={svgLayerRef}
            className="pointer-events-none absolute inset-0 w-full h-full"
            style={{ zIndex: drawMode ? 10 : 5 }}
          >
            {/* Completed paths */}
            {drawPaths.map(p => (
              <path key={p.id}
                d={pointsToPath(p.points)}
                fill="none" stroke={p.color} strokeWidth={p.width}
                strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
              />
            ))}
            {/* Live preview path */}
            <path id="live-path" fill="none" stroke={pencilColor} strokeWidth={pencilWidth}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          </svg>

          {/* Saved boards drawer */}
          {showBoards && (
            <div className="absolute right-0 top-0 h-full w-64 border-l-2 border-foreground bg-card shadow-xl z-50 flex flex-col">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-extrabold">Saved Boards</span>
                <button onClick={() => setShowBoards(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="flex-1 overflow-auto">
                {savedBoards.length === 0 && <div className="p-4 text-xs text-muted-foreground">No saved boards yet.</div>}
                {savedBoards.map(b => (
                  <button key={b.board_id} onClick={() => openBoard(b.board_id)}
                    className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs hover:bg-muted transition">
                    <Workflow className="h-4 w-4 text-primary shrink-0" />
                    <span className="truncate font-semibold">{b.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI chatbox — bottom right */}
          <div className="absolute bottom-4 right-4 z-40 w-80 rounded-[8px] border-2 border-foreground bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-extrabold">AI Scene Generator</span>
              {aiImages.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{aiImages.length} photo{aiImages.length > 1 ? "s" : ""}</span>}
            </div>
            <div className="p-2 space-y-2">
              {aiImages.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {aiImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img.data_url} alt={img.name} className="h-10 w-10 rounded object-cover border border-border" />
                      <button onClick={() => setAiImages(p => p.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 bg-destructive text-white rounded-full h-4 w-4 flex items-center justify-center text-[9px]">×</button>
                    </div>
                  ))}
                </div>
              )}
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAiGenerate(); }}
                placeholder="Describe the crime scene, suspects, and connections… (Ctrl+Enter to generate)"
                rows={3}
                className="w-full resize-none rounded-[5px] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
              <div className="flex gap-2">
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted transition">
                  <Image className="h-3 w-3" /> Photo
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => handleAiImageAttach(e.target.files)} />
                <button onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {aiLoading ? "Generating…" : "Generate"}
                </button>
              </div>
              <p className="text-[9px] text-muted-foreground">AI adds to canvas — use Red Link to connect existing nodes manually.</p>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
