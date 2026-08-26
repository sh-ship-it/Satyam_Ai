/**
 * News Feed API client — which Karnataka news channels are live right now.
 *
 * Deliberately NOT routed through `cachedFetch` like the other modules: that
 * cache is tuned for crime data that barely changes within a session, whereas a
 * channel goes on and off air within minutes and a stale hit here shows the
 * officer an off-air player. The server already caches for three minutes, which
 * is the right place for it.
 */
import { API_BASE, getAuthToken } from "./client";

export type NewsChannel = {
  slug: string;
  name: string;
  broadcaster: string;
  channel_id: string;
  /** null while the channel is between broadcasts. */
  video_id: string | null;
  live: boolean;
};

export type NewsChannelsResponse = {
  channels: NewsChannel[];
  live_count: number;
  resolved_at: number;
  ttl_seconds: number;
  cached: boolean;
};

export const news = {
  channels: async (refresh = false): Promise<NewsChannelsResponse> => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/api/news/channels${refresh ? "?refresh=true" : ""}`, {
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`news/channels failed: ${res.status}`);
    return res.json() as Promise<NewsChannelsResponse>;
  },
};
