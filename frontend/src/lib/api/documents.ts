/**
 * Document Translation API client.
 *
 * WHY THIS DOES NOT USE `request()`
 * `client.ts`'s `authHeaders()` hard-codes `content-type: application/json`. For a
 * multipart upload that suppresses the boundary the browser would otherwise
 * generate, and the server then cannot parse the body at all. So the upload calls
 * use `fetch` directly with only the Authorization header — the same approach
 * `sttTranscribe` already takes for audio.
 *
 * The tradeoff that comes with bypassing `request()`: no automatic
 * `handleUnauthorized()` on a 401. `readError()` below re-dispatches the session
 * event so an expired token still sends the officer to sign in rather than
 * surfacing as a mysterious upload failure.
 */
import { API_BASE, ApiError, getAuthToken, SESSION_EXPIRED_EVENT } from "./client";

export type TranslateDocResult = {
  filename: string;
  mime: string;
  size_bytes: number;
  pages: number;
  sha256: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  translated_text: string;
  provider: string;
  /** Parsed fine but has no text layer — a scan. Not an error. */
  needs_ocr: boolean;
  chars_translated: number;
};

export type SealResult = {
  audit_id: number;
  sha256: string;
  short: string;
  prev_hash: string;
  row_hash: string;
  sealed_at: string;
  algorithm: "SHA-256";
};

export type VerifyResult = {
  found: boolean;
  sha256: string;
  short: string;
  audit_id?: number | null;
  sealed_at?: string | null;
  sealed_by?: number | null;
  filename?: string | null;
  link_intact: boolean;
  detail: string;
};

function authOnly(): Record<string, string> {
  const token = getAuthToken();
  // Deliberately NO content-type: the browser must set the multipart boundary.
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Turn a failed response into an ApiError carrying the server's own message.
 *
 * The backend writes these details to be shown verbatim ("file is larger than the
 * 20 MB limit", "this file is not a real PDF"), so surfacing `detail` instead of a
 * generic status is what makes the screen actionable.
 */
async function readError(res: Response, fallback: string): Promise<ApiError> {
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  let detail = fallback;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string" && body.detail) detail = body.detail;
  } catch {
    /* non-JSON body — keep the fallback */
  }
  return new ApiError(res.status, detail);
}

/**
 * One fetch wrapper for all four calls, so a failure always names its cause.
 *
 * A rejected fetch throws a bare `TypeError: Failed to fetch` with no status and no
 * message — the browser deliberately withholds the reason. Shown verbatim that reads
 * as "the server is down" even when the real cause is a CORS header the response
 * carried, which is exactly how the encrypt bug was misread for several rounds.
 * Naming the address being dialled at least points at the right question.
 */
async function send(path: string, init: RequestInit, fallback: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(
      0,
      `Could not reach the Satyam server at ${API_BASE}. Check that the backend is running, then try again.`,
    );
  }
  if (!res.ok) throw await readError(res, fallback);
  return res;
}

export const documents = {
  /** Upload, extract text, translate. Returns text only — no file. */
  async translate(
    file: File,
    sourceLang: "en" | "kn" = "en",
    targetLang: "en" | "kn" = "kn",
  ): Promise<TranslateDocResult> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("source_lang", sourceLang);
    fd.append("target_lang", targetLang);
    const res = await send(
      "/api/documents/translate",
      { method: "POST", headers: authOnly(), body: fd },
      "Translation failed",
    );
    return (await res.json()) as TranslateDocResult;
  },

  /** Append the digest to the tamper-evident audit chain. */
  async seal(sha256: string, filename: string, note = ""): Promise<SealResult> {
    const res = await send(
      "/api/documents/seal",
      {
        method: "POST",
        headers: { ...authOnly(), "content-type": "application/json" },
        body: JSON.stringify({ sha256, filename, note }),
      },
      "Seal failed",
    );
    return (await res.json()) as SealResult;
  },

  /** Was this exact file sealed, and does its chain link still recompute? */
  async verify(sha256: string): Promise<VerifyResult> {
    const res = await send(
      "/api/documents/verify",
      {
        method: "POST",
        headers: { ...authOnly(), "content-type": "application/json" },
        body: JSON.stringify({ sha256 }),
      },
      "Verify failed",
    );
    return (await res.json()) as VerifyResult;
  },
};
