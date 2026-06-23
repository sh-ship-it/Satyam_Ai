/**
 * Investigation Board API client.
 * Uses /api/board/* endpoints — all require Permission.CHAT.
 */
import { z } from "zod";
import { API_BASE, getAuthToken } from "./client";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Zod validation (catches malformed AI output before touching the canvas) ──

export const SceneNodeZ = z.object({
  id:          z.string(),
  type:        z.string(),
  x:           z.number(),
  y:           z.number(),
  w:           z.number().default(220),
  h:           z.number().default(140),
  label:       z.string().default(""),
  image_ref:   z.string().nullish(),
  color:       z.string().nullish(),
  entity_kind: z.string().nullish(),
  entity_id:   z.number().nullish(),
});

export const SceneEdgeZ = z.object({
  source: z.string(),
  target: z.string(),
  label:  z.string().default(""),
  color:  z.string().default("#ef4444"),
  style:  z.string().default("solid"),
  kind:   z.string().default("link"),
});

export const SceneGraphZ = z.object({
  nodes: z.array(SceneNodeZ),
  edges: z.array(SceneEdgeZ),
});

export type SceneNode  = z.infer<typeof SceneNodeZ>;
export type SceneEdge  = z.infer<typeof SceneEdgeZ>;
export type SceneGraph = z.infer<typeof SceneGraphZ>;

// ── TS types for board CRUD ────────────────────────────────────────────────

export type BoardImage = { name?: string; data_url: string };

export type BoardListItem = {
  board_id: number;
  title: string;
  district: string | null;
  thumbnail: string | null;
  updated_at: string | null;
  orphaned?: boolean;   // true = saved before owner-id fix; can be claimed
};

export type BoardDetail = BoardListItem & { state_json: Record<string, unknown> };

// ── API functions ──────────────────────────────────────────────────────────

export const boardApi = {
  generate: async (args: {
    prompt: string;
    images?: BoardImage[];
    lang?: string;
    brain_engine?: string;
    existing_snapshot?: Record<string, unknown> | null;
  }): Promise<SceneGraph> => {
    const raw = await apiFetch<unknown>("/api/board/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: args.prompt,
        images: args.images ?? [],
        lang: args.lang ?? "en",
        brain_engine: args.brain_engine,
        existing_snapshot: args.existing_snapshot ?? null,
      }),
    });
    return SceneGraphZ.parse(raw);
  },

  save: (payload: { board_id?: number | null; title: string; state_json: Record<string, unknown>; thumbnail?: string | null }) =>
    apiFetch<{ board_id: number }>("/api/board/save", { method: "POST", body: JSON.stringify(payload) }),

  list: () => apiFetch<BoardListItem[]>("/api/board/list"),

  load: (id: number) => apiFetch<BoardDetail>(`/api/board/${id}`),

  claim: (id: number) => apiFetch<{ ok: boolean; board_id: number }>(
    `/api/board/${id}/claim`, { method: "POST" }
  ),
};
