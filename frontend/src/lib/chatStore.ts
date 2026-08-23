import type { ReactNode } from "react";

/**
 * Shared conversation store for the chat surfaces (/console and /ask).
 *
 * Both screens read and write the SAME localStorage key, so a conversation
 * started in the Console is continued in Ask Satyam and vice versa. Keeping one
 * store is deliberate: two copies of this format would drift.
 */

/** A pipeline lane the backend reported for one AI turn (router / text_to_sql / rag …). */
export type ChatLane = { name: string; detail?: string };

export type ChatMessage =
  | { role: "user"; text: string }
  | {
      role: "ai";
      text: string;
      citations?: string[];
      streaming?: boolean;
      action?: ReactNode;
      /** Tool events the pipeline emitted for this turn. Surfaced on /ask. */
      lanes?: ChatLane[];
    };

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export const CHAT_STORAGE_KEY = "satyam-chat-history";

export function generateId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* corrupt or unavailable storage — start clean */
  }
  return [];
}

export function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    /* quota or private mode — history is best-effort */
  }
}

export function generateTitle(text: string): string {
  const cleaned = text.replace(/[?!.，。、]+/g, "").trim();
  const words = cleaned.split(/\s+/);
  const short = words.slice(0, 6).join(" ");
  return short.length > 40 ? short.slice(0, 40) + "…" : short;
}
