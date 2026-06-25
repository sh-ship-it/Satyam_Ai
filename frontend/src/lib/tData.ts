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

// ---------------------------------------------------------------------------
// Station name translation
// ---------------------------------------------------------------------------

/**
 * Comprehensive station-name lookup table.
 * Covers all stations that appear in the top-25 list and common Bengaluru stations.
 * For unlisted names the suffix-based fallback handles " PS" and "Police Station".
 */
const STATION_KN: Record<string, string> = {
  // ── Bengaluru City ────────────────────────────────────────────────────────
  "Banaswadi PS": "ಬಾಣಸವಾಡಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mahadevapura PS": "ಮಹಾದೇವಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mahadevapura Traffic PS": "ಮಹಾದೇವಪುರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Rajagopal Nagar PS": "ರಾಜಗೋಪಾಲ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ramamurthy Nagar PS": "ರಾಮಮೂರ್ತಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "K.R. Puram PS": "ಕೆ.ಆರ್. ಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "K.R.Puram PS": "ಕೆ.ಆರ್. ಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "KR Puram PS": "ಕೆ.ಆರ್. ಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "KR Puram Traffic PS": "ಕೆ.ಆರ್. ಪುರಂ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tunga Nagar PS": "ತುಂಗ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Siddapura PS": "ಸಿದ್ದಾಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "HAL PS": "ಎಚ್ಎಎಲ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Whitefield PS": "ವ್ಹೈಟ್‌ಫೀಲ್ಡ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Whitefield Traffic PS": "ವ್ಹೈಟ್‌ಫೀಲ್ಡ್ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Cubbon Park PS": "ಕಬ್ಬನ್ ಪಾರ್ಕ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kadugondana Halli PS": "ಕಡುಗೊಂಡನಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sadashivanagar PS": "ಸದಾಶಿವನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sadashivanagar Traffic PS": "ಸದಾಶಿವನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Malleshwaram PS": "ಮಲ್ಲೇಶ್ವರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Malleshwaram Traffic PS": "ಮಲ್ಲೇಶ್ವರಂ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Wilsongarden PS": "ವಿಲ್ಸನ್ ಗಾರ್ಡನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Wilsongarden Traffic PS": "ವಿಲ್ಸನ್ ಗಾರ್ಡನ್ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayanagar PS": "ವಿಜಯನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayanagar Traffic PS": "ವಿಜಯನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yeshwanthpur PS": "ಯಶವಂತಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yeshwanthpura PS": "ಯಶವಂತಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yeshwanthapura PS": "ಯಶವಂತಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yeshwanthapura Traffic PS": "ಯಶವಂತಪುರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Hesaraghatta Road PS": "ಹೆಸರಘಟ್ಟ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Koramangala PS": "ಕೋರಮಂಗಲ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Indiranagar PS": "ಇಂದಿರಾನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Marathahalli PS": "ಮಾರತ್ತಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Varthur PS": "ವರ್ತೂರ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Bellandur PS": "ಬೆಳ್ಳಂದೂರು ಪೊಲೀಸ್ ಠಾಣೆ",
  "Electronic City PS": "ಎಲೆಕ್ಟ್ರಾನಿಕ್ ಸಿಟಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yelahanka PS": "ಯಲಹಂಕ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yelahanka New Town PS": "ಯಲಹಂಕ ನ್ಯೂ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yelahanka Traffic PS": "ಯಲಹಂಕ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Peenya PS": "ಪೀಣ್ಯ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Peenya Traffic PS": "ಪೀಣ್ಯ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Rajajinagar PS": "ರಾಜಾಜಿನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Rajajinagar Traffic PS": "ರಾಜಾಜಿನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Seshadripuram PS": "ಶೇಷಾದ್ರಿಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivajinagar PS": "ಶಿವಾಜಿನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivajinagar Traffic PS": "ಶಿವಾಜಿನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Upparpet PS": "ಉಪ್ಪಾರಪೇಟೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Upparpet Traffic PS": "ಉಪ್ಪಾರಪೇಟೆ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vyalikaval PS": "ವ್ಯಾಲಿಕಾವಲ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sanjay Nagar PS": "ಸಂಜಯ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nandini Layout PS": "ನಂದಿನಿ ಲೇಔಟ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vidyaranyapura PS": "ವಿದ್ಯಾರಣ್ಯಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Soladevanahalli PS": "ಸೋಲದೇವನಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Subramanyapura PS": "ಸುಬ್ರಹ್ಮಣ್ಯಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Puttenahalli PS": "ಪುತ್ತೇನಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Thalaghattapura PS": "ತಲಘಟ್ಟಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Thalaghattapura Traffic PS": "ತಲಘಟ್ಟಪುರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Rajarajeshwari Nagar PS": "ರಾಜರಾಜೇಶ್ವರಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kengeri PS": "ಕೆಂಗೇರಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kengeri Traffic PS": "ಕೆಂಗೇರಿ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kumbalagudu PS": "ಕುಂಬಳಗೋಡು ಪೊಲೀಸ್ ಠಾಣೆ",
  "Madivala PS": "ಮಾದಿವಾಳ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Madivala Traffic PS": "ಮಾದಿವಾಳ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "HSR Layout PS": "ಎಚ್ಎಸ್ಆರ್ ಲೇಔಟ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "BTM Layout PS": "ಬಿಟಿಎಂ ಲೇಔಟ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Bannerghatta Road PS": "ಬನ್ನೇರಘಟ್ಟ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "JP Nagar PS": "ಜೆಪಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Jayanagar PS": "ಜಯನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Basavanagudi PS": "ಬಸವನಗುಡಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Suddaguntepalya PS": "ಸುದ್ದಗುಂಟೆಪಾಳ್ಯ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mico Layout PS": "ಮೈಕೊ ಲೇಔಟ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mico Layout Traffic PS": "ಮೈಕೊ ಲೇಔಟ್ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kumaraswamy Layout PS": "ಕುಮಾರಸ್ವಾಮಿ ಲೇಔಟ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kumaraswamy Layout Traffic PS": "ಕುಮಾರಸ್ವಾಮಿ ಲೇಔಟ್ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Narayanapura PS": "ನಾರಾಯಣಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Bagalagunte PS": "ಬಗಲಗುಂಟೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Magadi Road PS": "ಮಗಡಿ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Magadi Road Traffic PS": "ಮಗಡಿ ರಸ್ತೆ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "R.T. Nagar PS": "ಆರ್.ಟಿ. ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "R.T.Nagar Traffic PS": "ಆರ್.ಟಿ. ನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Pulakeshinagar PS": "ಪುಲಕೇಶಿನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Pulakeshinagar Traffic PS": "ಪುಲಕೇಶಿನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Viveknagar PS": "ವಿವೇಕನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Parappana Agrahara PS": "ಪರಪ್ಪನ ಅಗ್ರಹಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kothigehalli PS": "ಕೋತಿಘಟ್ಟ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kodigehalli PS": "ಕೋಡಿಘಟ್ಟ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sampigehalli PS": "ಸಂಪಿಘಟ್ಟ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sarjapura PS": "ಸಾರ್ಜಾಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Jigani PS": "ಜಿಗಣಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nelamangala Town PS": "ನೆಲಮಂಗಲ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nelamangala Rural PS": "ನೆಲಮಂಗಲ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nelamangala Traffic PS": "ನೆಲಮಂಗಲ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Doddaballapur Town PS": "ದೊಡ್ಡಬಳ್ಳಾಪುರ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Victoria Hospital PS": "ವಿಕ್ಟೋರಿಯಾ ಆಸ್ಪತ್ರೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vidhana Soudha PS": "ವಿಧಾನ ಸೌಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sampangiramanagar PS": "ಸಂಪಂಗಿರಾಮನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Thyagarajanagar PS": "ತ್ಯಾಗರಾಜನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Siddarthanagar Traffic PS": "ಸಿದ್ಧಾರ್ಥನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "V.V. Puram PS": "ವಿ.ವಿ. ಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "V V Puram Traffic PS": "ವಿ.ವಿ. ಪುರಂ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vishveshwarapuram PS": "ವಿಶ್ವೇಶ್ವರಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mahalakshmipuram PS": "ಮಹಾಲಕ್ಷ್ಮಿಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Subramanya Nagar PS": "ಸುಬ್ರಹ್ಮಣ್ಯ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Subramanyanagar PS": "ಸುಬ್ರಹ್ಮಣ್ಯನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "P.D. Halli PS": "ಪಿ.ಡಿ. ಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ragavendranagar PS": "ರಾಘವೇಂದ್ರನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "KTJ Nagar PS": "ಕೆಟಿಜೆ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nandagudi PS": "ನಂದಗೂಡಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Devanahalli PS": "ದೇವನಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  // ── CEN Crime PS (all districts) ─────────────────────────────────────────
  "Cyber Crime Police Station": "ಸೈಬರ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Cyber Crime PS": "ಸೈಬರ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "South CEN Crime PS": "ದಕ್ಷಿಣ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "North CEN Crime PS": "ಉತ್ತರ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "East CEN Crime PS": "ಪೂರ್ವ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "West CEN Crime PS": "ಪಶ್ಚಿಮ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "NorthEast CEN Crime PS": "ಈಶಾನ್ಯ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "SouthEast CEN Crime PS": "ಆಗ್ನೇಯ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Whitefield CEN Crime PS": "ವ್ಹೈಟ್‌ಫೀಲ್ಡ್ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru CEN Crime PS": "ತುಮಕೂರು ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru CEN PS": "ತುಮಕೂರು ಸಿಇಎನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "KGF CEN Crime PS": "ಕೆಜಿಎಫ್ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kolar CEN Crime PS": "ಕೋಲಾರ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kodagu CEN Crime PS": "ಕೊಡಗು ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Raichur CEN Crime PS": "ರಾಯಚೂರು ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivamogga CEN Crime PS": "ಶಿವಮೊಗ್ಗ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya CEN Crime PS": "ಮಂಡ್ಯ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mysuru CEN Crime PS": "ಮೈಸೂರು ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Udupi CEN Crime PS": "ಉಡುಪಿ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Koppal CEN Crime PS": "ಕೊಪ್ಪಳ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yadgiri CEN Crime PS": "ಯಾದಗಿರಿ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayapura CEN Crime PS": "ವಿಜಯಪುರ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ramanagara CEN Crime PS": "ರಾಮನಗರ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  "UK CEN Crime PS": "ಉತ್ತರ ಕನ್ನಡ ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ",
  // ── Traffic police ─────────────────────────────────────────────────────────
  "Traffic North Police Station": "ಉತ್ತರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Traffic South Police Station": "ದಕ್ಷಿಣ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  // ── Other cities (already in backend) ─────────────────────────────────────
  "Devaraja PS": "ದೇವರಾಜ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Nazarbad PS": "ನಜರ್‌ಬಾದ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Lashkar PS": "ಲಷ್ಕರ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Lashkar Mohalla PS": "ಲಷ್ಕರ್ ಮೊಹಲ್ಲಾ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kuvempunagar PS": "ಕುವೆಂಪುನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Saraswathipuram PS": "ಸರಸ್ವತಿಪುರಂ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mysuru South PS": "ಮೈಸೂರು ದಕ್ಷಿಣ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mysuru Rly PS": "ಮೈಸೂರು ರೈಲ್ವೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Narasimharaja PS": "ನರಸಿಂಹರಾಜ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Narasimharaja Traffic PS": "ನರಸಿಂಹರಾಜ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Krishnaraja PS": "ಕೃಷ್ಣರಾಜ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Krishnaraja Traffic PS": "ಕೃಷ್ಣರಾಜ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Srirangapatna PS": "ಶ್ರೀರಂಗಪಟ್ಟಣ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mangaluru East PS": "ಮಂಗಳೂರು ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mangaluru North PS": "ಮಂಗಳೂರು ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mangaluru Rly PS": "ಮಂಗಳೂರು ರೈಲ್ವೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mangalore East PS": "ಮಂಗಳೂರು ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mangalore North PS": "ಮಂಗಳೂರು ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Pandeshwar PS": "ಪಾಂಡೇಶ್ವರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Urwa PS": "ಉರ್ವಾ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Surathkal PS": "ಸುರತ್ಕಲ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Moodabidre PS": "ಮೂಡಬಿದರೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Belthangady PS": "ಬೆಳ್ತಂಗಡಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Bantwal PS": "ಬಂಟ್ವಾಳ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Udupi Town PS": "ಉಡುಪಿ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kundapura PS": "ಕುಂದಾಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kundapura Rural PS": "ಕುಂದಾಪುರ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kundapura Traffic PS": "ಕುಂದಾಪುರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kalaburagi City PS": "ಕಲಬುರಗಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kalaburagi Rural PS": "ಕಲಬುರಗಿ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Aland Road PS": "ಆಳಂದ್ ರಸ್ತೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ballari Urban PS": "ಬಳ್ಳಾರಿ ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sandur PS": "ಸಂದೂರು ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kudligi PS": "ಕೂಡ್ಲಿಗಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Hospet Forest Range PS": "ಹೊಸಪೇಟೆ ಅರಣ್ಯ ವಲಯ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Hubballi Town PS": "ಹುಬ್ಬಳ್ಳಿ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Hubballi Rural PS": "ಹುಬ್ಬಳ್ಳಿ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Dharwad PS": "ಧಾರವಾಡ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivamogga East Traffic PS": "ಶಿವಮೊಗ್ಗ ಪೂರ್ವ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivamogga West Traffic PS": "ಶಿವಮೊಗ್ಗ ಪಶ್ಚಿಮ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivamogga Rural PS": "ಶಿವಮೊಗ್ಗ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Shivamogga Rly PS": "ಶಿವಮೊಗ್ಗ ರೈಲ್ವೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Thirthahalli PS": "ತೀರ್ಥಹಳ್ಳಿ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sagar Town PS": "ಸಾಗರ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Sagar Rural PS": "ಸಾಗರ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru North PS": "ತುಮಕೂರು ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru Town PS": "ತುಮಕೂರು ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru Rural PS": "ತುಮಕೂರು ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Tumakuru Traffic PS": "ತುಮಕೂರು ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Raichur Rural PS": "ರಾಯಚೂರು ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Raichur West PS": "ರಾಯಚೂರು ಪಶ್ಚಿಮ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Raichur Traffic PS": "ರಾಯಚೂರು ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayapura PS": "ವಿಜಯಪುರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayapura Rural PS": "ವಿಜಯಪುರ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayapura Traffic PS": "ವಿಜಯಪುರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Vijayapura Rly PS": "ವಿಜಯಪುರ ರೈಲ್ವೆ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ramanagara Town PS": "ರಾಮನಗರ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ramanagara Rural PS": "ರಾಮನಗರ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Ramanagara Traffic PS": "ರಾಮನಗರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kolar Town PS": "ಕೋಲಾರ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kolar Rural PS": "ಕೋಲಾರ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Kolar Traffic PS": "ಕೋಲಾರ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Koppal Town PS": "ಕೊಪ್ಪಳ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Koppal Rural PS": "ಕೊಪ್ಪಳ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Koppal Traffic PS": "ಕೊಪ್ಪಳ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yadgiri Town PS": "ಯಾದಗಿರಿ ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yadgiri Rural PS": "ಯಾದಗಿರಿ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Yadgiri Traffic PS": "ಯಾದಗಿರಿ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya Central PS": "ಮಂಡ್ಯ ಕೇಂದ್ರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya East PS": "ಮಂಡ್ಯ ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya West PS": "ಮಂಡ್ಯ ಪಶ್ಚಿಮ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya Rural PS": "ಮಂಡ್ಯ ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ",
  "Mandya Traffic PS": "ಮಂಡ್ಯ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ",
};

/**
 * Pattern-based suffix fallback for stations not in the static dict.
 * Strips " PS" / " Police Station" / " Rly PS" etc. and appends Kannada suffix.
 */
function translateStationFallback(name: string): string {
  const suffixMap: [string, string][] = [
    [" Traffic PS", " ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Forest Range PS", " ಅರಣ್ಯ ವಲಯ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Forest PS", " ಅರಣ್ಯ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" CEN Crime PS", " ಸಿಇಎನ್ ಅಪರಾಧ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" CEN PS", " ಸಿಇಎನ್ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Rly PS", " ರೈಲ್ವೆ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Women PS", " ಮಹಿಳಾ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" City PS", " ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Rural PS", " ಗ್ರಾಮಾಂತರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Town PS", " ಟೌನ್ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" North PS", " ಉತ್ತರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" South PS", " ದಕ್ಷಿಣ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" East PS", " ಪೂರ್ವ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" West PS", " ಪಶ್ಚಿಮ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Urban PS", " ನಗರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" Central PS", " ಕೇಂದ್ರ ಪೊಲೀಸ್ ಠಾಣೆ"],
    ["Police Station", "ಪೊಲೀಸ್ ಠಾಣೆ"],
    [" PS", " ಪೊಲೀಸ್ ಠಾಣೆ"],
  ];
  for (const [eng, kn] of suffixMap) {
    if (name.endsWith(eng)) {
      return name.slice(0, -eng.length) + kn;
    }
  }
  return name; // unchanged if no pattern matches
}

/**
 * Translate a station name to Kannada.
 * 1. Static lookup table (STATION_KN)
 * 2. Pattern-based suffix fallback
 */
export function translateStation(name: string, lang: string): string {
  if (!name || (lang !== "kn" && lang !== "KN")) return name;
  if (STATION_KN[name]) return STATION_KN[name];
  return translateStationFallback(name);
}

// ---------------------------------------------------------------------------
// Core tData / tAuto API
// ---------------------------------------------------------------------------

export function tData(field: string, value: string | null | undefined, lang: string): string {
  if (value == null || value === "") return value ?? "";
  if (lang !== "KN" && lang !== "kn") return value;

  // Station field: use comprehensive station lookup + suffix fallback
  if (field === "station") return translateStation(value, lang);

  // 1. Static kn-data.json (categorical enums)
  const dict = (knData as Record<string, Record<string, string>>)[field];
  if (dict && dict[value] !== undefined) return dict[value];

  // 2. Runtime LLM-enriched cache (dynamic strings)
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
  // Check station lookup
  const stationTry = translateStation(value, lang);
  if (stationTry !== value) return stationTry;
  // Also check runtime cache
  const cache = getRuntimeCache();
  for (const dict of Object.values(cache)) {
    if (dict[value] !== undefined) return dict[value];
  }
  return value;
}
