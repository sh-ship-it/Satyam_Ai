/**
 * Translate categorical DB field values to Kannada using a pre-built
 * lookup dictionary.  Falls back to English if the value is not mapped.
 *
 * Usage:
 *   import { tData } from "@/lib/tData";
 *   tData("crime_type", row.crime_type, lang)   // → "ಕಳ್ಳತನ" when lang==="KN"
 *   tData("status",     row.status,     lang)   // → "ತೆರೆದಿದೆ"
 *   tData("district",   row.district,   lang)   // → "ಬೆಂಗಳೂರು ನಗರ"
 *
 * Supported fields: crime_type, status, fir_type, crime_category,
 *   motive, complaint_mode, role, gender, district, legal_code,
 *   risk_label, kyc_risk_level
 *
 * IMPORTANT: never use this for proper nouns (FIR numbers, person names,
 * station names in free text, coordinates, IDs, dates) — pass those verbatim.
 */
import knData from "@/locales/kn-data.json";

type KnData = typeof knData;
type FieldKey = keyof KnData;

export function tData(
  field: string,
  value: string | null | undefined,
  lang: string,
): string {
  if (value == null || value === "") return value ?? "";
  if (lang !== "KN" && lang !== "kn") return value;

  const dict = (knData as Record<string, Record<string, string>>)[field];
  if (!dict) return value;
  return dict[value] ?? value; // fall back to English if not mapped
}

/**
 * Convenience: translate a display value that may be one of several fields.
 * The field is auto-detected from a known set of canonical field names.
 * Only use this when you don't know the field at call time.
 */
export function tAuto(value: string | null | undefined, lang: string): string {
  if (!value || (lang !== "KN" && lang !== "kn")) return value ?? "";
  for (const field of Object.keys(knData) as FieldKey[]) {
    const dict = (knData as Record<string, Record<string, string>>)[field];
    if (dict && value in dict) return dict[value];
  }
  return value;
}
