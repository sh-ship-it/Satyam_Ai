import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import React, {
  useCallback, useEffect, useRef, useState,
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
  Link2, Image, StickyNote, Send, Loader2, X, AlertTriangle,
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
    style: {
      stroke: e.color ?? "#ef4444",
      strokeWidth: 2,
      strokeDasharray: e.style === "dashed" ? "6 3" : undefined,
    },
    animated: false,
    type: "default",
    markerEnd: { type: "arrowclosed" as const, color: e.color ?? "#ef4444" },
    data: { kind: e.kind },
  }));
  return { nodes, edges };
}

// ── Main screen ───────────────────────────────────────────────────────────

function BoardScreen() {
  const t = useT();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [boardTitle, setBoardTitle] = useState("Untitled board");
  const [savedBoards, setSavedBoards] = useState<{ board_id: number; title: string }[]>([]);
  const [showBoards, setShowBoards] = useState(false);
  const [saving, setSaving] = useState(false);

  // AI chatbox state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiImages, setAiImages] = useState<BoardImage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSrc, setLinkSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);

  // React Flow callbacks
  const onNodesChange = useCallback((c: NodeChange[]) => setNodes(n => applyNodeChanges(c, n)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges(e => applyEdgeChanges(c, e)), []);
  const onConnect = useCallback((c: Connection) => {
    setEdges(e => addEdge({
      ...c,
      style: { stroke: "#ef4444", strokeWidth: 2 },
      markerEnd: { type: "arrowclosed" as const, color: "#ef4444" },
      label: "",
    }, e));
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (!linkMode) return;
    if (!linkSrc) { setLinkSrc(node.id); return; }
    if (linkSrc === node.id) { setLinkSrc(null); return; }
    const label = prompt("Link label (e.g. 'Co-accused', 'Family'):", "") ?? "";
    setEdges(e => [...e, {
      id: uid("link"), source: linkSrc, target: node.id,
      label, style: { stroke: "#ef4444", strokeWidth: 2 },
      markerEnd: { type: "arrowclosed" as const, color: "#ef4444" },
    }]);
    setLinkSrc(null);
    setLinkMode(false);
  }, [linkMode, linkSrc]);

  // ── Board CRUD ────────────────────────────────────────────────────────

  async function saveBoard() {
    setSaving(true);
    try {
      const res = await boardApi.save({
        board_id: boardId, title: boardTitle,
        state_json: { nodes, edges } as unknown as Record<string, unknown>,
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
      const state = b.state_json as Record<string, unknown>;
      setNodes((state.nodes as Node[]) ?? []);
      setEdges((state.edges as Edge[]) ?? []);
      setBoardId(b.board_id);
      setBoardTitle(b.title);
      setShowBoards(false);
    } catch { toast.error("Could not open board."); }
  }

  function newBoard() {
    setNodes([]); setEdges([]); setBoardId(null); setBoardTitle("Untitled board");
  }

  // ── Add elements ───────────────────────────────────────────────────────

  function addNote() {
    const text = prompt("Sticky note text:", "Note") ?? "Note";
    setNodes(n => [...n, {
      id: uid("note"), type: "note", position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: { label: text },
    }]);
  }

  function addEntity() {
    const label = prompt("Entity name:", "") ?? "";
    if (!label) return;
    setNodes(n => [...n, {
      id: uid("entity"), type: "entity",
      position: { x: 300 + Math.random() * 300, y: 150 + Math.random() * 300 },
      data: { label, entity_kind: "person", color: "#3b82f6" },
    }]);
  }

  function handleImageFile(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        setNodes(n => [...n, {
          id: uid("photo"), type: "photo",
          position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 },
          data: { label: file.name, src },
          style: { width: 160 },
        }]);
      };
      reader.readAsDataURL(file);
    });
  }

  // ── AI Generate ────────────────────────────────────────────────────────

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const scene = await boardApi.generate({ prompt: aiPrompt, images: aiImages });
      const { nodes: newNodes, edges: newEdges } = sceneToFlow(scene);
      // Append to existing canvas (never clears board on error — toast used instead)
      setNodes(prev => [...prev, ...newNodes]);
      setEdges(prev => [...prev, ...newEdges]);
      setAiPrompt("");
      setAiImages([]);
      if (newNodes.length === 0) {
        toast.info("AI returned an empty scene. Try a more specific prompt.");
      } else {
        toast.success(`Added ${newNodes.length} nodes, ${newEdges.length} links.`);
      }
    } catch (err: unknown) {
      // Zod parse error or network error — board is untouched
      toast.error(`AI generation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setAiLoading(false); }
  }

  function handleAiImageAttach(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data_url = e.target?.result as string;
        setAiImages(prev => [...prev, { name: file.name, data_url }]);
      };
      reader.readAsDataURL(file);
    });
  }

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col min-h-0 bg-background">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b-2 border-foreground bg-card px-4 py-2 shrink-0 overflow-x-auto">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <input
            value={boardTitle}
            onChange={e => setBoardTitle(e.target.value)}
            className="w-40 rounded-[4px] border border-border bg-background px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-primary"
          />
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
          <button
            onClick={() => { setLinkMode(l => !l); setLinkSrc(null); }}
            className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px] font-bold transition ${linkMode ? "border-destructive bg-destructive/10 text-destructive" : "border-border hover:bg-muted"}`}>
            <Link2 className="h-3.5 w-3.5" />
            {linkMode ? (linkSrc ? "Click 2nd node…" : "Click 1st node…") : "Red Link"}
          </button>
          <span className="flex-1" />
          <button onClick={loadBoardsList}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted transition">
            <FolderOpen className="h-3.5 w-3.5" /> Open
          </button>
          <button onClick={saveBoard} disabled={saving}
            className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground px-3 py-1 text-[11px] font-bold hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button onClick={() => { if (confirm("Clear board?")) { setNodes([]); setEdges([]); }}}
            className="rounded-[5px] border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10 transition">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-h-0">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode="Delete"
            style={{ cursor: linkMode ? "crosshair" : undefined }}
          >
            <Background color="#d1d5db" gap={24} size={1.5} />
            <Controls />
            <MiniMap nodeColor={n => n.type === "photo" ? "#6366f1" : n.type === "note" ? "#fbbf24" : "#3b82f6"} />
            <Panel position="top-left">
              {/* Legend */}
              <div className="flex items-center gap-3 rounded-[6px] border border-border bg-card/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold text-foreground shadow">
                <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-destructive inline-block" /> Strong link</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded border-t-2 border-dashed border-destructive inline-block" /> Inferred</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-blue-500 inline-block" /> Person</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-yellow-400 inline-block" /> Note</span>
              </div>
            </Panel>
          </ReactFlow>

          {/* Saved boards drawer */}
          {showBoards && (
            <div className="absolute right-0 top-0 h-full w-64 border-l-2 border-foreground bg-card shadow-xl z-50 flex flex-col">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-extrabold">Saved Boards</span>
                <button onClick={() => setShowBoards(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="flex-1 overflow-auto">
                {savedBoards.length === 0 && (
                  <div className="p-4 text-xs text-muted-foreground">No saved boards yet.</div>
                )}
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
              {aiImages.length > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground">{aiImages.length} photo{aiImages.length > 1 ? "s" : ""}</span>
              )}
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
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
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
                <button
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition"
                >
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
