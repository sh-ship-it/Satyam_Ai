import os
import json
import httpx

# Never hardcode a real key here — this file is tracked in git. Read it from
# the environment (backend/.env, gitignored) instead.
api_key = os.environ.get("GEMINI_API_KEY", "")
if not api_key:
    raise SystemExit(
        "GEMINI_API_KEY is not set. Export it or run this with the backend "
        "venv's env loaded (e.g. `set -a; source backend/.env; set +a` on "
        "bash, or set $env:GEMINI_API_KEY in PowerShell) before running."
    )

strings = [
  # Landing Page
  "Features",
  "Login",
  "About",
  "Home",
  "Capabilities",
  "Platform",
  "About us",
  "Crime Intelligence",
  "Defending Karnataka on the Data.",
  "Satyam turns scattered case records, statements and signals into one bilingual, voice-driven, explainable intelligence picture for the Karnataka State Police.",
  "Watch Demo",
  "Tailored crime ⊗ intelligence solutions",
  "From first FIR to courtroom-ready reasoning — grounded Q&A, networks, money-trails, forecasting, and a hands-free voice & gesture copilot, all in one place.",
  "We provide intelligence for your toughest cases",
  "Investigation Console",
  "Ask in Kannada or English. Satyam runs grounded Text-to-SQL and RAG over case narratives, cites every source, and streams a spoken summary back to you.",
  "Network & Rings",
  "Surface hidden links between people, places and cases, expand ego-networks, and auto-detect criminal rings on an interactive graph.",
  "Financial Money-Trail",
  "Trace funds across accounts and transactions with a flagged BFS money-trail — never via raw LLM SQL.",
  "Forecast & Trends",
  "Anticipate hotspots and risk windows, and cluster modus-operandi patterns from historical data.",
  "Voice, Eye & Gesture Copilot",
  "Hands-free, bilingual control — speak a command, calibrate eye-gaze tracking, or use webcam hand gestures to navigate and run any screen.",
  "Built to stay ahead of the curve",
  "Private by design, fully auditable, and powered by state-of-the-art retrieval and reasoning — on synthetic data, with role-based access at every layer.",
  "Synthetic, privacy-safe data",
  "Bilingual — Kannada & English",
  "Screens in one voice-driven workspace",
  "AI Functions",
  "State-of-the-art AI, built for the beat",
  "A bilingual voice agent, eye-gaze tracking, hands-free hand gesture control, an AI investigation canvas, and grounded reasoning — all behind row-level security and a tamper-evident audit trail.",
  "Voice Screen Agent",
  "Speak in English or Kannada — the copilot navigates to the right screen and runs the task for you: set filters, search a network, generate a report. It answers data questions aloud, grounded in your records.",
  "Eye & Gesture Control",
  "Drive the cursor and hover elements using eye-gaze tracking, and click or scroll with webcam hand gestures. Say “Satyam” to wake the copilot, and the session auto-locks & blurs PII the moment you step away.",
  "AI Investigation Board",
  "Describe a crime scene in plain language and the AI lays out suspects, victims, locations and links on an infinite canvas — auto-arranged with production-grade graph layouts.",
  "Grounded Text-to-SQL",
  "Natural-language questions become safe, read-only SQL — validated by a sqlglot guard, scoped by Row-Level Security, and pointed only at masked views, never raw PII.",
  "Tamper-Evident Audit",
  "Every query is written to a SHA-256 hash-chained audit log, with four-tier PII masking and L1–L4 clearance enforced at every layer.",
  "Court-Ready Reports",
  "Build cited intelligence briefs from cases and FIRs, then export print-ready PDFs — with on-demand Kannada translation across the whole workspace.",
  "Contact us Today",
  "Whenever you have queries, require a walkthrough, or need prompt support — we are just a click away.",
  "Open Console",
  "tailored crime ⊗ intelligence",
  "Response Ops",
  "Network Analysis",
  "Forecasting",
  "Explore",
  "Connect",
  "© 2026 Satyam. All rights reserved.",
  "build by Teen Titans",
  
  # About Page
  "About — Satyam AI Digital Forensics",
  "About Satyam",
  "Built for investigators, engineered for evidence",
  "Satyam unifies AI triage, link analysis, geospatial intelligence, and tamper-evident reporting on a modern edge-native stack — multilingual, voice-enabled, and built to keep investigators in control of their case.",
  "Workflow",
  "Working Pipeline",
  "End-to-end flow from raw evidence to court-ready exhibit. Click any step to expand details.",
  "7 stages",
  "Auditable end-to-end",
  "STEP",
  "Hide details",
  "View details",
  "System Architecture & Data Flows",
  "A comprehensive blueprint of the Satyam bilingual voice-enabled forensics platform.",
  "Ingest",
  "Upload disk images, mobile dumps, cloud exports, and case files into a single evidence vault.",
  "Hash & Custody",
  "SHA-256 fingerprint every artifact; sign a chain-of-custody entry with timestamp and investigator identity.",
  "AI Triage",
  "Classify, deduplicate, and rank artifacts by investigative relevance using on-demand AI models.",
  "Entity Extraction",
  "Pull people, accounts, devices, locations, transactions, and communication threads from raw data.",
  "Link & Geo Analysis",
  "Build interactive network graphs and plot movements on a tactical heatmap with a time-slider.",
  "Investigator Review",
  "Voice + chat console, multi-user task boards, structured peer review, and redaction workflows.",
  "Court-Ready Report",
  "Generate signed, exhibit-numbered PDFs with full provenance, timeline, and citations."
]

strings = list(set(strings))
print(f"Translating {len(strings)} strings with Gemini...")

# gemini-2.5-flash 404s "no longer available to new users" on newer key cohorts.
model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

system_prompt = """You are translating Karnataka State Police crime intelligence web application labels to formal Kannada (ಕನ್ನಡ).
Rules:
1. Keep proper nouns in English script if appropriate, but translite to Kannada if it is a name/brand (e.g. Satyam -> ಸತ್ಯಂ, Teen Titans -> ಟೀನ್ ಟೈಟಾನ್ಸ್).
2. Keep short tech terms in English: AI, SQL, PDF, RAG, OIDC, SSO, SHA-256, PII, L1-L4, etc.
3. Return ONLY valid JSON format: {"english string": "Kannada translation", ...}
4. Use formal, professional Kannada terminology as used in official police/government documents."""

user_prompt = f"{system_prompt}\n\nTranslate these strings to Kannada:\n\n{json.dumps(strings)}"

data = {
    "contents": [{
        "parts": [{"text": user_prompt}]
    }],
    "generationConfig": {
        "responseMimeType": "application/json"
    }
}

try:
    # Key in a header, never the URL query string — a query-string key leaks
    # into access logs, proxy logs, browser history, and Referer headers.
    r = httpx.post(url, json=data, headers={"x-goog-api-key": api_key}, timeout=60.0)
    if r.status_code != 200:
        print("Error response:", r.text)
        r.raise_for_status()
    res = r.json()
    content = res["candidates"][0]["content"]["parts"][0]["text"]
    
    # Try parsing to make sure it's valid JSON
    parsed = json.loads(content)
    
    with open("d:/college/Projects/Satyam/scratch/landing_translations.json", "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)
    print("Successfully translated and saved to scratch/landing_translations.json!")
except Exception as e:
    print("Error calling Gemini:", e)
