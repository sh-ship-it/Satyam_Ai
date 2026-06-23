/**
 * Translate categorical DB field values to Kannada using a pre-built
 * lookup dictionary + a runtime LLM-enriched cache.
 */
import knData from "@/locales/kn-data.json";

type KnData = typeof knData;
type FieldKey = keyof KnData;

const DATA_CACHE_KEY = "satyam.data-translations";

/** Read runtime data translations from localStorage (populated by enrichDictWithLLM). */
function getRuntimeCache(): Record<string, Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

/** Write a batch of new data translations into the runtime cache. */
export function setDataTranslations(field: string, entries: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    const cache = getRuntimeCache();
    cache[field] = { ...(cache[field] ?? {}), ...entries };
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function tData(field: string, value: string | null | undefined, lang: string): string {
  if (value == null || value === "") return value ?? "";
  if (lang !== "KN" && lang !== "kn") return value;

  // 1. Static kn-data.json (categorical enums)
  const dict = (knData as Record<string, Record<string, string>>)[field];
  if (dict && dict[value] !== undefined) return dict[value];

  // 2. Runtime LLM-enriched cache (station names, dynamic strings)
  const cache = getRuntimeCache();
  const runtimeDict = cache[field];
  if (runtimeDict && runtimeDict[value] !== undefined) return runtimeDict[value];

  return value; // fall back to English
}

export function tAuto(value: string | null | undefined, lang: string): string {
  if (!value || (lang !== "KN" && lang !== "kn")) return value ?? "";
  for (const field of Object.keys(knData) as FieldKey[]) {
    const dict = (knData as Record<string, Record<string, string>>)[field];
    if (dict && value in dict) return dict[value];
  }
  // Also check runtime cache
  const cache = getRuntimeCache();
  for (const dict of Object.values(cache)) {
    if (dict[value] !== undefined) return dict[value];
  }
  return value;
}
