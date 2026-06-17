// Reads the Console's persisted chat history so other screens (Transcripts)
// can display + export it. Single source of truth = localStorage["satyam-chat-history"].
export type StoredChatMessage = { role: "user" | "ai"; text: string; citations?: string[] };
export type StoredConversation = {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  createdAt: string | number;
  updatedAt: string | number;
  officer?: string;
};

const KEY = "satyam-chat-history";

export function loadConversations(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && Array.isArray(c.messages))
      .sort((a, b) => {
        const ta = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt || 0).getTime();
        const tb = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt || 0).getTime();
        return tb - ta;
      });
  } catch {
    return [];
  }
}

export function fmtTime(ts: string | number): string {
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}
