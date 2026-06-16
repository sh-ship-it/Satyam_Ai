/**
 * Language auto-detection for Satyam voice pipeline.
 *
 * Single source of truth: detect from the text content itself so neither
 * the spoken reply language nor the chat request lang depends on a manual
 * dropdown when "Auto" is selected.
 */

/**
 * Detect whether a string is predominantly Kannada or English.
 * Uses the Kannada Unicode block (U+0C80–U+0CFF) as the signal.
 * Returns "kn" if any Kannada codepoint is present, "en" otherwise.
 */
export function detectLang(text: string): "en" | "kn" {
  return /[\u0C80-\u0CFF]/.test(text || "") ? "kn" : "en";
}

/**
 * Convert a voiceLang selector value (e.g. "auto", "en-IN", "kn-IN") +
 * a piece of text into the concrete "en" | "kn" value used by the TTS
 * and chat pipeline.
 *
 * "auto" (or falsy) → detectLang(text)
 * "kn-IN" / anything starting with "kn" → "kn"
 * anything else → "en"
 */
export function resolveLang(
  voiceLang: string | null | undefined,
  text: string,
): "en" | "kn" {
  const v = (voiceLang || "").toLowerCase();
  if (!v || v === "auto") return detectLang(text);
  if (v.startsWith("kn")) return "kn";
  return "en";
}
