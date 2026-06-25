import json

# Define the new keys to add
new_keys = {
    "Architecture": "ಆರ್ಕಿಟೆಕ್ಚರ್",
    "Under the hood": "ತಂತ್ರಜ್ಞಾನದ ಹಿನ್ನೆಲೆ",
    "The complete toolset powering the Satyam platform.": "ಸತ್ಯಂ ವೇದಿಕೆಯನ್ನು ನಿಯಂತ್ರಿಸುವ ಸಂಪೂರ್ಣ ಟೂಲ್‌ಸೆಟ್.",
    "Bilingual Forensic System Blueprint": "ದ್ವಿಭಾಷಾ ಫೋರೆನ್ಸಿಕ್ ಸಿಸ್ಟಮ್ ನೀಲನಕ್ಷೆ",
    "Client Tier": "ಕ್ಲೈಂಟ್ ಹಂತ",
    "Officer's Browser Workspace": "ಅಧಿಕಾರಿಯ ಬ್ರೌಸರ್ ಕಾರ್ಯಕ್ಷೇತ್ರ",
    "Application Tier": "ಅಪ್ಲಿಕೇಶನ್ ಹಂತ",
    "FastAPI Async Backend": "FastAPI ಅಸಿಂಕ್ ಬ್ಯಾಕೆಂಡ್",
    "Intents Router • Progressive NL→SQL • SSE Spoken Summary • RLS Enforcement": "ಇಂಟೆಂಟ್ಸ್ ರೂಟರ್ • ಪ್ರೋಗ್ರೆಸ್ಸಿವ್ NL→SQL • SSE ಸ್ಪೋಕನ್ ಸಾರಾಂಶ • RLS ಜಾರಿ",
    "Data Tier": "ಡೇಟಾ ಹಂತ",
    "Secure Storage": "ಸುರಕ್ಷಿತ ಸಂಗ್ರಹಣೆ",
    "Row-Level Security (RLS)": "ಸಾಲು-ಮಟ್ಟದ ಭದ್ರತೆ (RLS)",
    "Hash-Chained Audit Log": "ಹ್ಯಾಶ್-ಸರಣಿ ಆಡಿಟ್ ಲಾಗ್",
    "Redis Conversation State": "Redis ಸಂಭಾಷಣೆ ಸ್ಥಿತಿ",
    "Model Tier": "ಮಾಡೆಲ್ ಹಂತ",
    "AI & Model Engines": "AI ಮತ್ತು ಮಾಡೆಲ್ ಎಂಜಿನ್‌ಗಳು",
    "Gemini 2.5 & Groq Llama": "Gemini 2.5 ಮತ್ತು Groq Llama",
    "Sarvam Bulbul & Saaras": "Sarvam Bulbul ಮತ್ತು Saaras",
    "Local BGE-M3 Embedder": "ಸ್ಥಳೀಯ BGE-M3 ಎಂಬೆಡರ್",
    "Subprocess YOLOv8s": "ಸಬ್‌ಪ್ರೊಸೆಸ್ YOLOv8s",
    "Grounded Text-to-SQL Pipeline": "ಗ್ರೌಂಡೆಡ್ ಟೆಕ್ಸ್ಟ್-ಟು-SQL ಪೈಪ್‌ಲೈನ್",
    "How plain-text English/Kannada questions are translated into secure database queries.": "ಸರಳ-ಪಠ್ಯ ಇಂಗ್ಲಿಷ್/ಕನ್ನಡ ಪ್ರಶ್ನೆಗಳನ್ನು ಸುರಕ್ಷಿತ ಡೇಟಾಬೇಸ್ ಪ್ರಶ್ನೆಗಳಾಗಿ ಹೇಗೆ ಅನುವಾದಿಸಲಾಗುತ್ತದೆ.",
    "Natural Language Query": "ನೈಸರ್ಗಿಕ ಭಾಷೆಯ ಪ್ರಶ್ನೆ",
    "Show me vehicle thefts in Mysuru this year": "ಈ ವರ್ಷ ಮೈಸೂರಿನಲ್ಲಿ ವಾಹನ ಕಳ್ಳತನಗಳನ್ನು ತೋರಿಸಿ",
    "Conversational memory + Broadening": "ಸಂಭಾಷಣೆಯ ಮೆಮೊರಿ + ಬ್ರಾಡ್ನಿಂಗ್",
    "Merges last 6 turns. If 0 rows return, relax filters (relax=0..3).": "ಕಳೆದ 6 ತಿರುವುಗಳನ್ನು ವಿಲೀನಗೊಳಿಸುತ್ತದೆ. 0 ಸಾಲುಗಳು ಮರಳಿದರೆ, ಫಿಲ್ಟರ್‌ಗಳನ್ನು ಸಡಿಲಗೊಳಿಸಿ (relax=0..3).",
    "sqlglot Security Guard": "sqlglot ಭದ್ರತಾ ಕಾವಲುಗಾರ",
    "Validates single SELECT, restricts to 6-table allow-list, forces auto-LIMIT.": "ಏಕ SELECT ಅನ್ನು ಮೌಲ್ಯೀಕರಿಸುತ್ತದೆ, 6-ಕೋಷ್ಟಕಗಳ ಅನುಮತಿ ಪಟ್ಟಿಗೆ ನಿರ್ಬಂಧಿಸುತ್ತದೆ, ಸ್ವಯಂ-LIMIT ಅನ್ನು ಒತ್ತಾಯಿಸುತ್ತದೆ.",
    "Restricts rows at the PG engine level via GUC session claims.": "GUC ಸೆಷನ್ ಕ್ಲೈಮ್‌ಗಳ ಮೂಲಕ PG ಎಂಜಿನ್ ಮಟ್ಟದಲ್ಲಿ ಸಾಲುಗಳನ್ನು ನಿರ್ಬಂಧಿಸುತ್ತದೆ.",
    "Bilingual STT/TTS Pipeline": "ದ್ವಿಭಾಷಾ STT/TTS ಪೈಪ್‌ಲೈನ್",
    "Bilingual voice processing with automatic language detection and spoken summaries.": "ಸ್ವಯಂಚಾಲಿತ ಭಾಷಾ ಪತ್ತೆ ಮತ್ತು ಮಾತನಾಡುವ ಸಾರಾಂಶಗಳೊಂದಿಗೆ ದ್ವಿಭಾಷಾ ಧ್ವನಿ ಪ್ರಕ್ರಿಯೆ.",
    "Speech Ingest & Transcription": "ಧ್ವನಿ ಸ್ವೀಕಾರ ಮತ್ತು ಪ್ರತಿಲಿಪಿ",
    "Capture mic, transcribe via Browser Web Speech or Sarvam Saaras v3.": "ಮೈಕ್ ಅನ್ನು ಸೆರೆಹಿಡಿಯಿರಿ, ಬ್ರೌಸರ್ ವೆಬ್ ಸ್ಪೀಚ್ ಅಥವಾ ಸರ್ವಮ್ ಸಾರಸ್ v3 ಮೂಲಕ ಪ್ರತಿಲಿಪಿ ಮಾಡಿ.",
    "Voice Screen Command Router": "ಧ್ವನಿ ಪರದೆ ಆಜ್ಞೆಯ ರೂಟರ್",
    "Extracts navigation intents (e.g., \"open network\") or directs query to chat.": "ನ್ಯಾವಿಗೇಷನ್ ಉದ್ದೇಶಗಳನ್ನು ಹೊರತೆಗೆಯುತ್ತದೆ (ಉದಾ., \"ನೆಟ್‌ವರ್ಕ್ ತೆರೆಯಿರಿ\") ಅಥವಾ ಪ್ರಶ್ನೆಯನ್ನು ಚಾಟ್‌ಗೆ ನಿರ್ದೇಶಿಸುತ್ತದೆ.",
    "Spoken Summary Generation": "ಮಾತನಾಡುವ ಸಾರಾಂಶದ ರಚನೆ",
    "LLM outputs a 2-3 sentence [SPEAK] block, or backend builds it from rows.": "LLM 2-3 ವಾಕ್ಯಗಳ [SPEAK] ಬ್ಲಾಕ್ ಅನ್ನು ಔಟ್‌ಪುಟ್ ಮಾಡುತ್ತದೆ, ಅಥವಾ ಬ್ಯಾಕೆಂಡ್ ಅದನ್ನು ಸಾಲುಗಳಿಂದ ನಿರ್ಮಿಸುತ್ತದೆ.",
    "SSE Stream & Neural Speech": "SSE ಸ್ಟ್ರೀಮ್ ಮತ್ತು ನ್ಯೂರಲ್ ಸ್ಪೀಚ್",
    "Streams speak event separate from UI table. Plays via Bulbul v3 TTS.": "UI ಕೋಷ್ಟಕದಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ಮಾತನಾಡುವ ಈವೆಂಟ್ ಅನ್ನು ಸ್ಟ್ರೀಮ್ ಮಾಡುತ್ತದೆ. ಬುಲ್‌ಬುಲ್ v3 TTS ಮೂಲಕ ಪ್ಲೇ ಮಾಡುತ್ತದೆ.",
    "Frontend Core": "ಫ್ರಂಟ್‌ಎಂಡ್ ಕೋರ್",
    "UI & Visualization": "UI ಮತ್ತು ದೃಶ್ಯೀಕರಣ",
    "Backend & Server": "ಬ್ಯಾಕೆಂಡ್ ಮತ್ತು ಸರ್ವರ್",
    "Database & Cache": "ಡೇಟಾಬೇಸ್ ಮತ್ತು ಕ್ಯಾಶ್",
    "AI Models & Engines": "AI ಮಾದರಿಗಳು ಮತ್ತು ಎಂಜಿನ್‌ಗಳು",
    "Voice & Language": "ಧ್ವನಿ ಮತ್ತು ಭಾಷೆ",
    "Security & Integrity": "ಭದ್ರತೆ ಮತ್ತು ಸಮಗ್ರತೆ",
    "DevOps & Infra": "DevOps ಮತ್ತು ಇನ್ಫ್ರಾ"
}

# Load i18n.tsx
filepath = "d:/college/Projects/Satyam/frontend/src/lib/i18n.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Generate TS code for translations
ts_lines = ["  // ── About Page Blueprint keys ────────────────────────────────────────"]
for k, v in new_keys.items():
    k_esc = k.replace('"', '\\"')
    v_esc = v.replace('"', '\\"')
    ts_lines.append(f'  "{k_esc}": "{v_esc}",')

ts_block = "\n".join(ts_lines) + "\n"

# Insert right after the DICT opening
dict_start = "const DICT: Record<string, string> = {"
if dict_start in content:
    new_content = content.replace(dict_start, f"{dict_start}\n{ts_block}")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Added successfully!")
else:
    print("Error: DICT start not found!")
