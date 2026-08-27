/**
 * The Indic languages Sarvam's models cover.
 *
 * Data lives here rather than beside the marquee component so it can be checked
 * without a DOM (scripts/check-languages.mjs) and reused if a real language picker
 * ever needs it.
 *
 * IMPORTANT: `live` is the whole honesty of this list, and there are TWO separate
 * reasons the other 21 are not translatable today:
 *
 *   1. WRONG MODEL. This list is sarvam-translate:v1's coverage (22 Indian
 *      languages + English). The app calls `mayura:v1`
 *      (models/api/sarvam.py), which Sarvam documents as 11 languages —
 *      10 Indian + English. Reaching the other 12 means changing the model, and
 *      sarvam-translate:v1 is a fine-tuned Gemma3-4B rather than a dedicated MT
 *      model, so that is a latency decision, not a config tweak.
 *   2. THE CODE COLLAPSES THEM ANYWAY. `_bcp()` returns kn-IN for anything
 *      starting "kn" and en-IN for everything else, and `_norm_lang()` in
 *      api/routes/documents.py does the same. A Tamil upload is therefore sent to
 *      Sarvam labelled English.
 *
 * Also worth knowing before promising X→Kannada: Sarvam documents translation
 * "between English and 22 Indian languages", i.e. English on one side of the pair.
 * Tamil→Kannada would be a two-hop pivot through English, not one call.
 *
 * So listing 23 languages under a translation tool without marking which are
 * wired would promise coverage the code does not have.
 */

export type MarqueeLanguage = {
  /** Endonym, in its own script — the whole point of the row. */
  native: string;
  english: string;
  /** BCP-47 tag as Sarvam names it. */
  code: string;
  /** Wired end to end today, rather than merely supported by the provider. */
  live?: boolean;
};

/** Source: the Sarvam language picker. Order follows it. */
export const SARVAM_LANGUAGES: MarqueeLanguage[] = [
  { native: "हिन्दी", english: "Hindi", code: "hi-IN" },
  { native: "বাংলা", english: "Bengali", code: "bn-IN" },
  { native: "தமிழ்", english: "Tamil", code: "ta-IN" },
  { native: "తెలుగు", english: "Telugu", code: "te-IN" },
  { native: "मराठी", english: "Marathi", code: "mr-IN" },
  { native: "ગુજરાતી", english: "Gujarati", code: "gu-IN" },
  { native: "ಕನ್ನಡ", english: "Kannada", code: "kn-IN", live: true },
  { native: "മലയാളം", english: "Malayalam", code: "ml-IN" },
  { native: "অসমীয়া", english: "Assamese", code: "as-IN" },
  { native: "اردو", english: "Urdu", code: "ur-IN" },
  { native: "संस्कृतम्", english: "Sanskrit", code: "sa-IN" },
  { native: "नेपाली", english: "Nepali", code: "ne-IN" },
  { native: "डोगरी", english: "Dogri", code: "doi-IN" },
  { native: "बड़ो", english: "Bodo", code: "brx-IN" },
  { native: "ਪੰਜਾਬੀ", english: "Punjabi", code: "pa-IN" },
  { native: "ଓଡ଼ିଆ", english: "Odia", code: "od-IN" },
  { native: "कोंकणी", english: "Konkani", code: "kok-IN" },
  { native: "मैथिली", english: "Maithili", code: "mai-IN" },
  { native: "سنڌي", english: "Sindhi", code: "sd-IN" },
  { native: "कॉशुर", english: "Kashmiri", code: "ks-IN" },
  { native: "ꯃꯤꯇꯩꯂꯣꯟ", english: "Manipuri", code: "mni-IN" },
  { native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", code: "sat-IN" },
  { native: "English", english: "English", code: "en-IN", live: true },
];
