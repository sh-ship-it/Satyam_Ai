import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "EN" | "KN";

// English source string -> Kannada translation
const DICT: Record<string, string> = {
  // ── Hands-free / multimodal layer ───────────────────────────────────────────
  "Hands-free": "ಕೈಮುಕ್ತ",
  "Hands-free control": "ಕೈಮುಕ್ತ ನಿಯಂತ್ರಣ",
  "Camera gestures, wake word, and presence-aware auto-lock. All processing stays on this device.":
    "ಕ್ಯಾಮೆರಾ ಸನ್ನೆಗಳು, ವೇಕ್ ವರ್ಡ್ ಮತ್ತು ಉಪಸ್ಥಿತಿ-ಆಧಾರಿತ ಸ್ವಯಂ-ಲಾಕ್. ಎಲ್ಲಾ ಪ್ರಕ್ರಿಯೆ ಈ ಸಾಧನದಲ್ಲೇ ನಡೆಯುತ್ತದೆ.",
  "Enable hands-free": "ಕೈಮುಕ್ತ ಸಕ್ರಿಯಗೊಳಿಸಿ",
  "Master switch. Turns the webcam on for gesture and presence features.":
    "ಮುಖ್ಯ ಸ್ವಿಚ್. ಸನ್ನೆ ಮತ್ತು ಉಪಸ್ಥಿತಿ ವೈಶಿಷ್ಟ್ಯಗಳಿಗಾಗಿ ವೆಬ್‌ಕ್ಯಾಮ್ ಆನ್ ಮಾಡುತ್ತದೆ.",
  "Hand-gesture control": "ಕೈ ಸನ್ನೆ ನಿಯಂತ್ರಣ",
  "Point to move the cursor, pinch to click, swipe to navigate, ✋ to talk, ✊ to go back.":
    "ಕರ್ಸರ್ ಸರಿಸಲು ತೋರಿಸಿ, ಕ್ಲಿಕ್ ಮಾಡಲು ಪಿಂಚ್, ನ್ಯಾವಿಗೇಟ್ ಮಾಡಲು ಸ್ವೈಪ್, ಮಾತನಾಡಲು ✋, ಹಿಂದಕ್ಕೆ ✊.",
  "Show gesture cursor": "ಸನ್ನೆ ಕರ್ಸರ್ ತೋರಿಸಿ",
  "Display a glowing dot that follows your index finger.":
    "ನಿಮ್ಮ ತೋರುಬೆರಳನ್ನು ಅನುಸರಿಸುವ ಹೊಳೆಯುವ ಚುಕ್ಕೆ ತೋರಿಸಿ.",
  "Wake word (“Satyam”)": "ವೇಕ್ ವರ್ಡ್ (“ಸತ್ಯಂ”)",
  "Say “Satyam” to open the voice copilot without touching the mic.":
    "ಮೈಕ್ ಮುಟ್ಟದೆ ಧ್ವನಿ ಸಹಾಯಕವನ್ನು ತೆರೆಯಲು “ಸತ್ಯಂ” ಎಂದು ಹೇಳಿ.",
  "Presence auto-lock": "ಉಪಸ್ಥಿತಿ ಸ್ವಯಂ-ಲಾಕ್",
  "Blur sensitive data and lock the session when no officer is at the camera. Writes an audit entry.":
    "ಕ್ಯಾಮೆರಾ ಮುಂದೆ ಯಾವುದೇ ಅಧಿಕಾರಿ ಇಲ್ಲದಿದ್ದಾಗ ಸೂಕ್ಷ್ಮ ಡೇಟಾ ಮಸುಕುಗೊಳಿಸಿ ಸೆಷನ್ ಲಾಕ್ ಮಾಡುತ್ತದೆ. ಆಡಿಟ್ ನಮೂದು ಬರೆಯುತ್ತದೆ.",
  "Speak gesture confirmations": "ಸನ್ನೆ ದೃಢೀಕರಣ ಧ್ವನಿಯಲ್ಲಿ ಹೇಳಿ",
  "Read each gesture action aloud, in addition to the on-screen toast.":
    "ಪರದೆಯ ಸೂಚನೆಯ ಜೊತೆಗೆ ಪ್ರತಿ ಸನ್ನೆ ಕ್ರಿಯೆಯನ್ನು ಧ್ವನಿಯಲ್ಲಿ ಓದಿ.",
  "Auto-lock after": "ಇಷ್ಟು ಸಮಯದ ನಂತರ ಸ್ವಯಂ-ಲಾಕ್",
  "Seconds of no detected face before the session locks.":
    "ಸೆಷನ್ ಲಾಕ್ ಆಗುವ ಮೊದಲು ಮುಖ ಪತ್ತೆಯಾಗದ ಸೆಕೆಂಡುಗಳು.",
  "Reset to defaults": "ಡೀಫಾಲ್ಟ್‌ಗೆ ಮರುಹೊಂದಿಸಿ",


  // Banner / shell
  "Synthetic / demo data — not real case records": "ಕೃತಕ / ಡೆಮೋ ಡೇಟಾ — ನಿಜವಾದ ಪ್ರಕರಣ ದಾಖಲೆಗಳಲ್ಲ",
  "KSP Workspace": "ಕೆ.ಎಸ್.ಪಿ ಕಾರ್ಯಸ್ಥಳ",
  "R. Kumar · Inspector": "ಆರ್. ಕುಮಾರ್ · ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  Voice: "ಧ್ವನಿ",
  Settings: "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",

  // Investigation Board + AI Model Settings
  "Board": "ಬೋರ್ಡ್",
  "Board AI (scene generator)": "ಬೋರ್ಡ್ AI (ದೃಶ್ಯ ರಚನೆ)",
  "Powers the AI Scene Generator on the Board screen": "ಬೋರ್ಡ್ ಪರದೆಯ AI ದೃಶ್ಯ ಜನರೇಟರ್ ಅನ್ನು ಚಾಲನೆ ಮಾಡುತ್ತದೆ",
  "AI Chat Model": "AI ಚಾಟ್ ಮಾದರಿ",
  "Configured": "ಸಂರಚಿಸಲಾಗಿದೆ",
  "No key": "ಕೀ ಇಲ್ಲ",
  "Uses": "ಬಳಕೆ",
  "Google · multimodal · default": "Google · ಬಹುಮಾದರಿ · ಡಿಫಾಲ್ಟ್",
  "GPT-4o · strong reasoning": "GPT-4o · ಬಲವಾದ ತರ್ಕ",
  "Cloud · fastest": "ಕ್ಲೌಡ್ · ವೇಗವಾದ",
  "Choose the model that powers chat. Keys are set on the server (.env).": "ಚಾಟ್ ಅನ್ನು ನಿಯಂತ್ರಿಸುವ ಮಾದರಿ ಆಯ್ಕೆ ಮಾಡಿ. ಕೀಗಳನ್ನು ಸರ್ವರ್‌ನಲ್ಲಿ ಹೊಂದಿಸಿ.",
  "To enable a model, add its API key to the server .env and restart. Your selection is saved on this device and used for every chat.": "ಮಾದರಿ ಸಕ್ರಿಯಗೊಳಿಸಲು, .env ಗೆ API ಕೀ ಸೇರಿಸಿ ಮತ್ತು ಮರುಪ್ರಾರಂಭಿಸಿ.",
  // Access Control
  "Access Control": "ಪ್ರವೇಶ ನಿಯಂತ್ರಣ",
  "Restricted — L4 clearance required": "ನಿರ್ಬಂಧಿತ — L4 ಅನುಮತಿ ಅಗತ್ಯ",
  "Only top-priority administrators (clearance L4) can open Access Control.": "ಕೇವಲ L4 ಅಧಿಕಾರಿಗಳು ಪ್ರವೇಶ ನಿಯಂತ್ರಣ ತೆರೆಯಬಹುದು.",
  "Your clearance": "ನಿಮ್ಮ ಅನುಮತಿ",
  "Officer": "ಅಧಿಕಾರಿ",
  "Clearance": "ಅನುಮತಿ",
  "Scope": "ವ್ಯಾಪ್ತಿ",
  "Created by": "ರಚಿಸಿದವರು",
  "Policy": "ನೀತಿ",
  "Self-registered": "ಸ್ವ-ನೋಂದಣಿ",
  "override": "ಅತಿಕ್ರಮಣ",
  "Change policy": "ನೀತಿ ಬದಲಾಯಿಸಿ",
  "Account active": "ಖಾತೆ ಸಕ್ರಿಯ",
  "Reason (audit-logged, required)": "ಕಾರಣ (ಆಡಿಟ್ ದಾಖಲು, ಅಗತ್ಯ)",
  "Save policy": "ನೀತಿ ಉಳಿಸಿ",
  "A reason is required.": "ಕಾರಣ ಅಗತ್ಯ.",
  "Could not save policy.": "ನೀತಿ ಉಳಿಸಲಾಗಲಿಲ್ಲ.",
  "Could not load accounts.": "ಖಾತೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ.",
  "Loading accounts…": "ಖಾತೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…",
  "No accounts match.": "ಯಾವ ಖಾತೆಗಳೂ ಹೊಂದಿಕೆಯಾಗಲಿಲ್ಲ.",
  "This is your own account. You can't disable it or drop below L4.": "ಇದು ನಿಮ್ಮ ಸ್ವಂತ ಖಾತೆ. ನೀವು ಇದನ್ನು ನಿಷ್ಕ್ರಿಯಗೊಳಿಸಲು ಅಥವಾ L4 ಗಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.",
  "Search by name, email, rank or creator…": "ಹೆಸರು, ಇಮೇಲ್, ಶ್ರೇಣಿ ಅಥವಾ ರಚಿಸಿದವರಿಂದ ಹುಡುಕಿ…",
  "e.g. Promoted to SP — district handover": "ಉದಾ. SP ಗೆ ಬಡ್ತಿ — ಜಿಲ್ಲಾ ಹಸ್ತಾಂತರ",

  // Issue 9 & 11 additions
  "Crime overview · live": "ಅಪರಾಧ ಅವಲೋಕನ · ಲೈವ್",
  "All crimes": "ಎಲ್ಲಾ ಅಪರಾಧಗಳು",
  "All districts": "ಎಲ್ಲಾ ಜಿಲ್ಲೆಗಳು",
  "All crime types": "ಎಲ್ಲಾ ಅಪರಾಧ ಪ್ರಕಾರಗಳು",
  Data: "ಡೇಟಾ",
  "Top crime": "ಪ್ರಮುಖ ಅಪರಾಧ",
  "Top hotspot": "ಪ್ರಮುಖ ಹಾಟ್‌ಸ್ಪಾಟ್",
  Trend: "ಪ್ರವೃತ್ತಿ",
  "Live from Postgres (RLS-scoped). Click a station to drill into its FIRs.":
    "ಪೋಸ್ಟ್‌ಗ್ರೆಸ್‌ನಿಂದ ಲೈವ್ (RLS-ವ್ಯಾಪ್ತಿ). ಎಫ್‌ಐಆರ್‌ಗಳನ್ನು ವಿವರವಾಗಿ ನೋಡಲು ಠಾಣೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.",
  "No data for this scope.": "ಈ ವ್ಯಾಪ್ತಿಗೆ ಯಾವುದೇ ಡೇಟಾ ಇಲ್ಲ.",
  "Show cases in": "ಪ್ರಕರಣಗಳನ್ನು ತೋರಿಸಿ",
  "Theft cases in Bengaluru City this year": "ಈ ವರ್ಷ ಬೆಂಗಳೂರು ನಗರದಲ್ಲಿ ನಡೆದ ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು",
  "Top crime types in Mysuru City": "ಮೈಸೂರು ನಗರದ ಪ್ರಮುಖ ಅಪರಾಧ ಪ್ರಕಾರಗಳು",
  "Network around a person in Dakshina Kannada":
    "ದಕ್ಷಿಣ ಕನ್ನಡದಲ್ಲಿ ಒಬ್ಬ ವ್ಯಕ್ತಿಯ ಸುತ್ತಲಿನ ನೆಟ್‌ವರ್ಕ್",
  "Could not load live data — check you are signed in and the API is reachable.":
    "ಲೈವ್ ಡೇಟಾವನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ — ನೀವು ಸೈನ್ ಇನ್ ಆಗಿದ್ದೀರಾ ಮತ್ತು ಎಪಿಐ ಲಭ್ಯವಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.",
  "Backend unreachable — check login and API status.":
    "ಬ್ಯಾಕೆಂಡ್ ಸಂಪರ್ಕಿಸಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ — ಲಾಗಿನ್ ಮತ್ತು ಎಪಿಐ ಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
  "Summarize crime around": "ಸುತ್ತಲಿನ ಅಪರಾಧದ ಸಾರಾಂಶ",
  Layers: "ಪದರಗಳು",
  View: "ನೋಟ",
  "Chat history": "ಸಂಭಾಷಣೆಯ ಇತಿಹಾಸ",
  "Voice task": "ಧ್ವನಿ ಕಾರ್ಯ",
  "hotspot cells": "ಹಾಟ್‌ಸ್ಪಾಟ್ ಕೋಶಗಳು",
  Overview: "ಅವಲೋಕನ",
  "No data": "ಯಾವುದೇ ಡೇಟಾ ಇಲ್ಲ",
  "Apply filters": "ಫಿಲ್ಟರ್‌ಗಳನ್ನು ಅನ್ವಯಿಸಿ",

  // Nav
  Console: "ಕನ್ಸೋಲ್",
  Map: "ನಕ್ಷೆ",
  Network: "ನೆಟ್‌ವರ್ಕ್",
  Reports: "ವರದಿಗಳು",
  Audit: "ಆಡಿಟ್",

  // Console page
  Conversation: "ಸಂಭಾಷಣೆ",
  "Whitefield theft inquiry": "ವೈಟ್‌ಫೀಲ್ಡ್ ಕಳ್ಳತನ ತನಿಖೆ",
  "+ New": "+ ಹೊಸದು",
  "Show me reported thefts in Whitefield over the last 30 days, grouped by police station.":
    "ಕಳೆದ 30 ದಿನಗಳಲ್ಲಿ ವೈಟ್‌ಫೀಲ್ಡ್‌ನಲ್ಲಿ ವರದಿಯಾದ ಕಳ್ಳತನಗಳನ್ನು ಪೊಲೀಸ್ ಠಾಣೆಯ ಪ್ರಕಾರ ತೋರಿಸಿ.",
  "I found 142 theft FIRs across 6 stations in the Whitefield zone (15 Jul – 14 Aug 2024). Whitefield PS leads with 47 cases, followed by Mahadevapura (38). Trend is up 12% vs the previous 30 days.":
    "ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯದ 6 ಠಾಣೆಗಳಲ್ಲಿ 142 ಕಳ್ಳತನ ಎಫ್‌ಐಆರ್‌ಗಳು ಕಂಡುಬಂದಿವೆ (15 ಜುಲೈ – 14 ಆಗಸ್ಟ್ 2024). ವೈಟ್‌ಫೀಲ್ಡ್ ಪಿಎಸ್ 47 ಪ್ರಕರಣಗಳೊಂದಿಗೆ ಮುಂದಿದೆ, ನಂತರ ಮಹದೇವಪುರ (38). ಹಿಂದಿನ 30 ದಿನಗಳಿಗೆ ಹೋಲಿಸಿದರೆ 12% ಹೆಚ್ಚಳ.",
  "Open the case at the top of that list.": "ಆ ಪಟ್ಟಿಯ ಮೇಲ್ಭಾಗದ ಪ್ರಕರಣವನ್ನು ತೆರೆಯಿರಿ.",
  "Opening FIR-2024-08842 — motor vehicle theft, ITPL Main Road, reported 14 Aug 2024.":
    "ಎಫ್‌ಐಆರ್-2024-08842 ತೆರೆಯಲಾಗುತ್ತಿದೆ — ಮೋಟಾರು ವಾಹನ ಕಳ್ಳತನ, ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ, 14 ಆಗಸ್ಟ್ 2024 ರಂದು ವರದಿ.",
  "Open case": "ಪ್ರಕರಣ ತೆರೆಯಿರಿ",
  "Answer restricted": "ಉತ್ತರ ನಿರ್ಬಂಧಿತ",
  "Your role can't view named accused records. Showing aggregate counts instead.":
    "ನಿಮ್ಮ ಪಾತ್ರಕ್ಕೆ ಆರೋಪಿ ಹೆಸರಿನ ದಾಖಲೆಗಳನ್ನು ನೋಡಲು ಅನುಮತಿ ಇಲ್ಲ. ಬದಲಿಗೆ ಒಟ್ಟು ಸಂಖ್ಯೆಗಳನ್ನು ತೋರಿಸಲಾಗಿದೆ.",
  "View what I can show →": "ನಾನು ತೋರಿಸಬಹುದಾದದನ್ನು ನೋಡಿ →",
  "Ask Satyam… (EN or ಕನ್ನಡ)": "ಫೋರೆನ್ಸಿಕ್‌ಯು ಅನ್ನು ಕೇಳಿ… (EN ಅಥವಾ ಕನ್ನಡ)",
  "Thefts in Whitefield last month": "ಕಳೆದ ತಿಂಗಳು ವೈಟ್‌ಫೀಲ್ಡ್‌ನಲ್ಲಿ ಕಳ್ಳತನಗಳು",
  "Top crime hotspots this quarter": "ಈ ತ್ರೈಮಾಸಿಕದ ಪ್ರಮುಖ ಅಪರಾಧ ಹಾಟ್‌ಸ್ಪಾಟ್‌ಗಳು",
  "Network around suspect FIR-2024-08842": "ಶಂಕಿತ ಎಫ್‌ಐಆರ್-2024-08842 ಸುತ್ತಲಿನ ನೆಟ್‌ವರ್ಕ್",
  "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ": "ಬೆಂಗಳೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ",
  "New conversation": "ಹೊಸ ಸಂಭಾಷಣೆ",
  "No conversations yet.": "ಇನ್ನೂ ಯಾವುದೇ ಸಂಭಾಷಣೆಗಳಿಲ್ಲ.",
  "Start a new conversation or pick one from history.":
    "ಹೊಸ ಸಂಭಾಷಣೆಯನ್ನು ಪ್ರಾರಂಭಿಸಿ ಅಥವಾ ಇತಿಹಾಸದಿಂದ ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
  Today: "ಇಂದು",
  Yesterday: "ನಿನ್ನೆ",
  "Last week": "ಕಳೆದ ವಾರ",
  Created: "ರಚಿಸಲಾಗಿದೆ",
  "Results Canvas": "ಫಲಿತಾಂಶ ಕ್ಯಾನ್ವಾಸ್",
  "Thefts · Whitefield zone · last 30 days": "ಕಳ್ಳತನಗಳು · ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ · ಕಳೆದ 30 ದಿನಗಳು",
  "View SQL / sources": "SQL / ಮೂಲಗಳನ್ನು ನೋಡಿ",
  "View SQL / sources →": "SQL / ಮೂಲಗಳನ್ನು ನೋಡಿ →",
  Expand: "ವಿಸ್ತರಿಸಿ",
  "Total FIRs": "ಒಟ್ಟು ಎಫ್‌ಐಆರ್‌ಗಳು",
  "Avg / day": "ದಿನಕ್ಕೆ ಸರಾಸರಿ",
  Cleared: "ಪರಿಹಾರ",
  "By Station": "ಠಾಣೆಯ ಪ್ರಕಾರ",
  "142 rows · streaming…": "142 ಸಾಲುಗಳು · ಸ್ಟ್ರೀಮಿಂಗ್…",
  Station: "ಠಾಣೆ",
  FIRs: "ಎಫ್‌ಐಆರ್‌ಗಳು",
  "Trend (30d)": "ಪ್ರವೃತ್ತಿ (30 ದಿನ)",
  "Top IPC": "ಪ್ರಮುಖ ಐಪಿಸಿ",
  "Every figure links to its source row. Click a station to drill into FIRs.":
    "ಪ್ರತಿ ಸಂಖ್ಯೆಯು ಅದರ ಮೂಲ ಸಾಲಿಗೆ ಲಿಂಕ್ ಆಗಿದೆ. ಎಫ್‌ಐಆರ್‌ಗಳಿಗೆ ಡ್ರಿಲ್ ಮಾಡಲು ಠಾಣೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.",

  // Map page
  Filters: "ಫಿಲ್ಟರ್‌ಗಳು",
  Hide: "ಮರೆಮಾಡಿ",
  "Crime type": "ಅಪರಾಧ ಪ್ರಕಾರ",
  Theft: "ಕಳ್ಳತನ",
  Burglary: "ಮನೆಗಳ್ಳತನ",
  Assault: "ಹಲ್ಲೆ",
  "Cyber fraud": "ಸೈಬರ್ ವಂಚನೆ",
  Narcotics: "ಮಾದಕ ದ್ರವ್ಯ",
  "Date range": "ದಿನಾಂಕ ವ್ಯಾಪ್ತಿ",
  "District / Zone": "ಜಿಲ್ಲೆ / ವಲಯ",
  Offender: "ಅಪರಾಧಿ",
  "Search by ID / alias": "ಐಡಿ / ಅಲಿಯಾಸ್ ಮೂಲಕ ಹುಡುಕಿ",
  "By crime type": "ಅಪರಾಧ ಪ್ರಕಾರದಿಂದ",
  "By offender": "ಅಪರಾಧಿಯಿಂದ",
  heat: "ಹೀಟ್",
  pins: "ಪಿನ್‌ಗಳು",
  grid: "ಗ್ರಿಡ್",
  Intensity: "ತೀವ್ರತೆ",
  "low → high": "ಕಡಿಮೆ → ಹೆಚ್ಚು",
  "Selected area": "ಆಯ್ದ ಪ್ರದೇಶ",
  live: "ಲೈವ್",
  "Whitefield zone": "ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ",
  "Δ 30d": "Δ 30 ದಿನ",
  "Top crimes": "ಪ್ರಮುಖ ಅಪರಾಧಗಳು",
  "7-day trend": "7 ದಿನಗಳ ಪ್ರವೃತ್ತಿ",
  "Ask AI about this area": "ಈ ಪ್ರದೇಶದ ಬಗ್ಗೆ AI ಯನ್ನು ಕೇಳಿ",

  // Network page
  "Seed entity": "ಬೀಜ ಘಟಕ",
  Depth: "ಆಳ",
  "Edge type": "ಎಡ್ಜ್ ಪ್ರಕಾರ",
  All: "ಎಲ್ಲಾ",
  "Co-accused": "ಸಹ-ಆರೋಪಿ",
  Phone: "ಫೋನ್",
  Vehicle: "ವಾಹನ",
  Location: "ಸ್ಥಳ",
  Community: "ಸಮುದಾಯ",
  Fullscreen: "ಪೂರ್ಣಪರದೆ",
  "Ego-network · seed + 1-hop neighborhood · 9 nodes · 13 edges":
    "ಎಗೋ-ನೆಟ್‌ವರ್ಕ್ · ಬೀಜ + 1-ಹಾಪ್ ನೆರೆಹೊರೆ · 9 ನೋಡ್‌ಗಳು · 13 ಎಡ್ಜ್‌ಗಳು",
  "Node inspector": "ನೋಡ್ ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  Centrality: "ಕೇಂದ್ರೀಯತೆ",
  Degree: "ಡಿಗ್ರಿ",
  Risk: "ಅಪಾಯ",
  High: "ಅಧಿಕ",
  "Role in network": "ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಪಾತ್ರ",
  "Hub node — appears in 8 FIRs across Whitefield zone. Likely organizer of a vehicle-theft ring (C-01).":
    "ಹಬ್ ನೋಡ್ — ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯದಲ್ಲಿ 8 ಎಫ್‌ಐಆರ್‌ಗಳಲ್ಲಿ ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ. ವಾಹನ-ಕಳ್ಳತನ ಗ್ಯಾಂಗ್‌ನ (C-01) ಸಂಯೋಜಕ ಆಗಿರಬಹುದು.",
  "Linked cases": "ಲಿಂಕ್ ಮಾಡಿದ ಪ್ರಕರಣಗಳು",
  "Person (C-01)": "ವ್ಯಕ್ತಿ (C-01)",
  Asset: "ಆಸ್ತಿ",
  Repulsion: "ವಿಕರ್ಷಣೆ",
  Spring: "ಸ್ಪ್ರಿಂಗ್",
  Gravity: "ಗುರುತ್ವಾಕರ್ಷಣೆ",
  Damping: "ಡ್ಯಾಂಪಿಂಗ್",
  Default: "ಡೀಫಾಲ್ಟ್",
  Tight: "ಬಿಗಿ",
  Spread: "ಹರಡುವಿಕೆ",
  Floaty: "ತೇಲುವ",
  Snappy: "ವೇಗದ",
  Custom: "ಕಸ್ಟಮ್",
  "Save current as preset…": "ಪ್ರಸ್ತುತ ಸೆಟ್ಟಿಂಗ್ ಅನ್ನು ಪ್ರಿಸೆಟ್ ಆಗಿ ಉಳಿಸಿ…",
  "Preset name": "ಪ್ರಿಸೆಟ್ ಹೆಸರು",
  "That name is reserved": "ಆ ಹೆಸರು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ",

  // Reports page
  "Saved items": "ಉಳಿಸಿದ ಐಟಂಗಳು",
  "Report cart": "ವರದಿ ಕಾರ್ಟ್",
  "Theft FIRs · Whitefield zone (30d)": "ಕಳ್ಳತನ ಎಫ್‌ಐಆರ್‌ಗಳು · ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ (30 ದಿನ)",
  "142 rows · 6 stations": "142 ಸಾಲುಗಳು · 6 ಠಾಣೆಗಳು",
  "Hotspot snapshot · Whitefield": "ಹಾಟ್‌ಸ್ಪಾಟ್ ಸ್ನ್ಯಾಪ್‌ಶಾಟ್ · ವೈಟ್‌ಫೀಲ್ಡ್",
  "Heat layer · 14 Aug 2024": "ಹೀಟ್ ಲೇಯರ್ · 14 ಆಗಸ್ಟ್ 2024",
  "Case FIR-2024-08842": "ಪ್ರಕರಣ ಎಫ್‌ಐಆರ್-2024-08842",
  "Motor vehicle theft · ITPL Main Rd": "ಮೋಟಾರು ವಾಹನ ಕಳ್ಳತನ · ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ",
  "No items yet. Add results from Console, Map, or Network.":
    "ಇನ್ನೂ ಯಾವುದೇ ಐಟಂಗಳಿಲ್ಲ. ಕನ್ಸೋಲ್, ನಕ್ಷೆ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್‌ನಿಂದ ಫಲಿತಾಂಶಗಳನ್ನು ಸೇರಿಸಿ.",
  "Template: KSP Intelligence Brief": "ಟೆಂಪ್ಲೇಟ್: ಕೆಎಸ್‌ಪಿ ಗುಪ್ತಚರ ವರದಿ",
  "Template: Court submission": "ಟೆಂಪ್ಲೇಟ್: ನ್ಯಾಯಾಲಯ ಸಲ್ಲಿಕೆ",
  "Template: Daily digest": "ಟೆಂಪ್ಲೇಟ್: ದೈನಂದಿನ ಸಾರಾಂಶ",
  "Generate PDF": "ಪಿಡಿಎಫ್ ರಚಿಸಿ",
  "Karnataka State Police": "ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪೊಲೀಸ್",
  "Intelligence Brief — Whitefield Zone": "ಗುಪ್ತಚರ ವರದಿ — ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ",
  "Ref: KSP/INT/2024/0814": "ಸಂದರ್ಭ: KSP/INT/2024/0814",
  "Generated: 14 Aug 2024": "ರಚಿಸಿದ: 14 ಆಗಸ್ಟ್ 2024",
  "1. Executive Summary": "1. ಕಾರ್ಯಕಾರಿ ಸಾರಾಂಶ",
  "2. Distribution by Station": "2. ಠಾಣೆಯ ಪ್ರಕಾರ ಹಂಚಿಕೆ",
  "3. Geospatial Concentration": "3. ಭೌಗೋಳಿಕ ಸಾಂದ್ರತೆ",
  "4. Key Case": "4. ಪ್ರಮುಖ ಪ್ರಕರಣ",
  "Top §": "ಪ್ರಮುಖ §",
  Citations: "ಉಲ್ಲೇಖಗಳು",

  // Audit page
  Compliance: "ಅನುಸರಣೆ",
  "Audit log": "ಆಡಿಟ್ ಲಾಗ್",
  "read-only": "ಓದಲು-ಮಾತ್ರ",
  "Hash-chain integrity": "ಹ್ಯಾಶ್-ಚೈನ್ ಸಮಗ್ರತೆ",
  "VERIFIED · 18,432 entries": "ಪರಿಶೀಲಿಸಲಾಗಿದೆ · 18,432 ನಮೂದುಗಳು",
  User: "ಬಳಕೆದಾರ",
  Action: "ಕ್ರಮ",
  From: "ಯಿಂದ",
  To: "ಗೆ",
  "Source table": "ಮೂಲ ಕೋಷ್ಟಕ",
  Apply: "ಅನ್ವಯಿಸಿ",
  "All users": "ಎಲ್ಲ ಬಳಕೆದಾರರು",
  Time: "ಸಮಯ",
  Role: "ಪಾತ್ರ",
  "Query / SQL": "ಪ್ರಶ್ನೆ / SQL",
  Result: "ಫಲಿತಾಂಶ",
  Sources: "ಮೂಲಗಳು",
  "Showing 10 of 18,432 entries · Read-only · No edit controls exposed":
    "18,432 ರಲ್ಲಿ 10 ನಮೂದುಗಳನ್ನು ತೋರಿಸಲಾಗಿದೆ · ಓದಲು-ಮಾತ್ರ · ಸಂಪಾದನೆ ನಿಯಂತ್ರಣಗಳಿಲ್ಲ",
  Search: "ಹುಡುಕಿ",
  "Search user, query, result…": "ಬಳಕೆದಾರ, ಪ್ರಶ್ನೆ, ಫಲಿತಾಂಶ ಹುಡುಕಿ…",
  Showing: "ತೋರಿಸಲಾಗಿದೆ",
  of: "ರಲ್ಲಿ",
  "Read-only · No edit controls exposed": "ಓದಲು-ಮಾತ್ರ · ಸಂಪಾದನೆ ನಿಯಂತ್ರಣಗಳಿಲ್ಲ",
  rows: "ಸಾಲುಗಳು",
  "loading…": "ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  stations: "ಠಾಣೆಗಳು",
  selected: "ಆಯ್ಕೆ",
  Clear: "ತೆರವುಗೊಳಿಸಿ",
  "Delete preset": "ಪ್ರಿಸೆಟ್ ಅಳಿಸಿ",
  "Physics presets": "ಭೌತಶಾಸ್ತ್ರ ಪ್ರಿಸೆಟ್‌ಗಳು",
  "Built-in": "ಅಂತರ್ನಿರ್ಮಿತ",
  Saved: "ಉಳಿಸಲಾಗಿದೆ",
  "Enter name or ID…": "ಹೆಸರು ಅಥವಾ ಐಡಿ ನಮೂದಿಸಿ…",
  "Coordinates unavailable": "ನಿರ್ದೇಶಾಂಕಗಳು ಲಭ್ಯವಿಲ್ಲ",
  "Loading…": "ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  "No person records.": "ಯಾವುದೇ ವ್ಯಕ್ತಿ ದಾಖಲೆಗಳಿಲ್ಲ.",
  "Could not load case data.": "ಪ್ರಕರಣ ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "Some fields masked for your clearance level.":
    "ನಿಮ್ಮ ಅನುಮತಿ ಮಟ್ಟಕ್ಕೆ ಕೆಲವು ಕ್ಷೇತ್ರಗಳನ್ನು ಮರೆಮಾಡಲಾಗಿದೆ.",
  Sections: "ವಿಭಾಗಗಳು",
  "I couldn't reach the backend just now. Please retry once the API is running.":
    "ಈ ಕ್ಷಣ ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. API ಚಾಲನೆಯಾದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",

  // Login
  "Sign in · Satyam": "ಸೈನ್ ಇನ್ · ಫೋರೆನ್ಸಿಕ್‌ಯು",
  "Crime Intelligence Workspace · KSP": "ಅಪರಾಧ ಗುಪ್ತಚರ ಕಾರ್ಯಸ್ಥಳ · ಕೆಎಸ್‌ಪಿ",
  "Sign in with SSO (OIDC)": "SSO (OIDC) ಮೂಲಕ ಸೈನ್ ಇನ್ ಮಾಡಿ",
  or: "ಅಥವಾ",
  Username: "ಬಳಕೆದಾರ ಹೆಸರು",
  Password: "ಪಾಸ್‌ವರ್ಡ್",
  "MFA code": "MFA ಕೋಡ್",
  "6-digit code": "6-ಅಂಕಿಯ ಕೋಡ್",
  "Sign in": "ಸೈನ್ ಇನ್",
  "Demo mode": "ಡೆಮೋ ಮೋಡ್",
  "Role:": "ಪಾತ್ರ:",
  Constable: "ಪೇದೆ",
  Inspector: "ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  Admin: "ನಿರ್ವಾಹಕ",
  "Swap roles live to demo access control.":
    "ಪ್ರವೇಶ ನಿಯಂತ್ರಣ ಡೆಮೋ ಮಾಡಲು ಪಾತ್ರಗಳನ್ನು ಲೈವ್ ಆಗಿ ಬದಲಿಸಿ.",
  "All records shown are synthetic. No real case data is exposed. ·":
    "ತೋರಿಸಲಾದ ಎಲ್ಲ ದಾಖಲೆಗಳು ಕೃತಕವಾಗಿವೆ. ಯಾವುದೇ ನಿಜವಾದ ಪ್ರಕರಣ ಡೇಟಾ ಬಹಿರಂಗವಾಗಿಲ್ಲ. ·",
  "Create account": "ಖಾತೆ ರಚಿಸಿ",
  "Camera unavailable — check browser permissions.":
    "ಕ್ಯಾಮೆರಾ ಲಭ್ಯವಿಲ್ಲ — ಬ್ರೌಸರ್ ಅನುಮತಿಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
  "Upload photo": "ಫೋಟೋ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ",
  Capture: "ಫೋಟೋ ತೆಗೆಯಿರಿ",
  Retake: "ಮತ್ತೆ ತೆಗೆಯಿರಿ",
  "Use camera": "ಕ್ಯಾಮೆರಾ ಬಳಸಿ",
  "Full name": "ಪೂರ್ಣ ಹೆಸರು",
  "Email address": "ಇಮೇಲ್ ವಿಳಾಸ",
  "Select police station (optional)": "ಪೊಲೀಸ್ ಠಾಣೆ ಆಯ್ಕೆಮಾಡಿ (ಐಚ್ಛಿಕ)",
  "Search police station…": "ಪೊಲೀಸ್ ಠಾಣೆ ಹುಡುಕಿ…",
  "Could not create the account. Try again.": "ಖಾತೆ ರಚಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ.",
  "DGP — Director General (state)": "DGP — ಪೊಲೀಸ್ ಮಹಾನಿರ್ದೇಶಕರು (ರಾಜ್ಯ)",
  "IGP — Inspector General (state)": "IGP — ಪೊಲೀಸ್ ಮಹಾನಿರೀಕ್ಷಕರು (ರಾಜ್ಯ)",
  "DIG — Dy. Inspector General (range)": "DIG — ಪೊಲೀಸ್ ಉಪಮಹಾನಿರೀಕ್ಷಕರು (ವಲಯ)",
  "SP — Superintendent (district)": "SP — ಪೊಲೀಸ್ ಅಧೀಕ್ಷಕರು (ಜಿಲ್ಲೆ)",
  "DySP — Dy. Superintendent (district)": "DySP — ಪೊಲೀಸ್ ಉಪಾಧೀಕ್ಷಕರು (ಜಿಲ್ಲೆ)",
  "CI / PI — Circle/Police Inspector (station)": "CI / PI — ವೃತ್ತ/ಪೊಲೀಸ್ ಇನ್ಸ್‌ಪೆಕ್ಟರ್ (ಠಾಣೆ)",
  "PSI / SI — Sub-Inspector (station)": "PSI / SI — ಸಬ್-ಇನ್ಸ್‌ಪೆಕ್ಟರ್ (ಠಾಣೆ)",
  "ASI — Asst. Sub-Inspector (station)": "ASI — ಸಹಾಯಕ ಸಬ್-ಇನ್ಸ್‌ಪೆಕ್ಟರ್ (ಠಾಣೆ)",
  "HC — Head Constable (station)": "HC — ಹೆಡ್ ಕಾನ್ಸ್‌ಟೇಬಲ್ (ಠಾಣೆ)",
  "PC — Police Constable (station)": "PC — ಪೊಲೀಸ್ ಕಾನ್ಸ್‌ಟೇಬಲ್ (ಠಾಣೆ)",
  "Loading audit log…": "ಆಡಿಟ್ ಲಾಗ್ ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ...",
  "Couldn't load the audit log.": "ಆಡಿಟ್ ಲಾಗ್ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "No entries match your search.": "ನಿಮ್ಮ ಹುಡುಕಾಟಕ್ಕೆ ಯಾವುದೇ ನಮೂದುಗಳು ಹೊಂದಿಕೆಯಾಗುತ್ತಿಲ್ಲ.",
  "Verifying…": "ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
  "CHAIN BROKEN": "ಸರಪಳಿ ಮುರಿದಿದೆ",
  VERIFIED: "ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
  entries: "ನಮೂದುಗಳು",
  "Connect the dots": "ಚುಕ್ಕಿಗಳನ್ನು ಸಂಪರ್ಕಿಸಿ",
  "Open network": "ನೆಟ್‌ವರ್ಕ್ ತೆರೆಯಿರಿ",
  Skip: "ಬಿಟ್ಟುಬಿಡಿ",

  // Case drawer
  Case: "ಪ್ರಕರಣ",
  summary: "ಸಾರಾಂಶ",
  persons: "ವ್ಯಕ್ತಿಗಳು",
  map: "ನಕ್ಷೆ",
  Date: "ದಿನಾಂಕ",
  Status: "ಸ್ಥಿತಿ",
  "Under investigation": "ತನಿಖೆಯಲ್ಲಿದೆ",
  "Theft (Motor vehicle)": "ಕಳ್ಳತನ (ಮೋಟಾರು ವಾಹನ)",
  "14 Aug 2024": "14 ಆಗಸ್ಟ್ 2024",
  "Whitefield PS": "ವೈಟ್‌ಫೀಲ್ಡ್ ಪಿಎಸ್",
  "IPC sections": "ಐಪಿಸಿ ವಿಭಾಗಗಳು",
  Complainant: "ದೂರುದಾರ",
  "Masked — authorized roles only": "ಮರೆಮಾಡಲಾಗಿದೆ — ಅಧಿಕೃತ ಪಾತ್ರಗಳಿಗೆ ಮಾತ್ರ",
  Narrative: "ವಿವರಣೆ",
  "Vehicle reported missing from parking lot near ITPL Main Road between 22:30 and 04:00. CCTV footage retrieved. Linked to 2 other theft FIRs in same zone (see Persons tab).":
    "ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ ಬಳಿಯ ಪಾರ್ಕಿಂಗ್ ಸ್ಥಳದಿಂದ 22:30 ರಿಂದ 04:00 ರ ನಡುವೆ ವಾಹನ ಕಾಣೆಯಾಗಿರುವುದು ವರದಿಯಾಗಿದೆ. ಸಿಸಿಟಿವಿ ತುಣುಕು ಪಡೆಯಲಾಗಿದೆ. ಅದೇ ವಲಯದ ಇತರ 2 ಕಳ್ಳತನ ಎಫ್‌ಐಆರ್‌ಗಳಿಗೆ ಲಿಂಕ್ ಮಾಡಲಾಗಿದೆ (ವ್ಯಕ್ತಿಗಳು ಟ್ಯಾಬ್ ನೋಡಿ).",
  Accused: "ಆರೋಪಿ",
  Victim: "ಬಲಿಪಶು",
  Witness: "ಸಾಕ್ಷಿ",
  "Incident location": "ಘಟನೆಯ ಸ್ಥಳ",
  "ITPL Main Road, Whitefield": "ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ, ವೈಟ್‌ಫೀಲ್ಡ್",
  "Add to report": "ವರದಿಗೆ ಸೇರಿಸಿ",
  Export: "ರಫ್ತು",

  // Transcripts
  Transcripts: "ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "Voice transcripts": "ಧ್ವನಿ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "Saved transcripts": "ಉಳಿಸಿದ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "No saved transcripts yet. Use the mic and tap Save to store one.":
    "ಇನ್ನೂ ಯಾವುದೇ ಉಳಿಸಿದ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳಿಲ್ಲ. ಮೈಕ್ ಬಳಸಿ ಮತ್ತು ಉಳಿಸಲು Save ಟ್ಯಾಪ್ ಮಾಡಿ.",
  Save: "ಉಳಿಸಿ",
  Delete: "ಅಳಿಸಿ",
  "Send to chat": "ಚಾಟ್‌ಗೆ ಕಳುಹಿಸಿ",
  "Speak reply": "ಧ್ವನಿ ಉತ್ತರ",
  "Speech output": "ಧ್ವನಿ ಉತ್ಪಾದನೆ",
  Rate: "ವೇಗ",
  "Speaking…": "ಮಾತನಾಡುತ್ತಿದೆ…",
  "Tap Pause to pause, Stop to end.": "ವಿರಾಮಕ್ಕೆ ವಿರಾಮ ಟ್ಯಾಪ್ ಮಾಡಿ, ಕೊನೆಗೊಳ್ಳಲು ನಿಲ್ಲಿಸಿ.",
  "Speak now. Tap anywhere to stop.": "ಈಗ ಮಾತನಾಡಿ. ನಿಲ್ಲಿಸಲು ಎಲ್ಲಿಯಾದರೂ ಟ್ಯಾಪ್ ಮಾಡಿ.",
  "Thinking…": "ಯೋಚಿಸುತ್ತಿದೆ…",
  "Speaking… (mic paused)": "ಮಾತನಾಡುತ್ತಿದೆ… (ಮೈಕ್ ನಿಂತಿದೆ)",
  "Conversation mode · just talk, the agent replies and listens again.":
    "ಸಂಭಾಷಣೆ ಮೋಡ್ · ಮಾತನಾಡಿ, ಏಜೆಂಟ್ ಉತ್ತರಿಸಿ ಮತ್ತೆ ಕೇಳುತ್ತದೆ.",
  "Start conversation": "ಸಂಭಾಷಣೆ ಪ್ರಾರಂಭಿಸಿ",
  "Conversation: ON": "ಸಂಭಾಷಣೆ: ಚಾಲು",
  "Auto (detect)": "ಸ್ವಯಂ (ಪತ್ತೆ)",
  "(auto)": "(ಸ್ವಯಂ)",
  "Voice (Text-to-Speech)": "ಧ್ವನಿ (ಪಠ್ಯ-ಭಾಷಣ)",
  "Which engine speaks replies aloud.": "ಯಾವ ಎಂಜಿನ್ ಉತ್ತರಗಳನ್ನು ಮಾತನಾಡುತ್ತದೆ.",
  "Best Kannada (default)": "ಅತ್ಯುತ್ತಮ ಕನ್ನಡ (ಡಿಫಾಲ್ಟ್)",
  "Cloud Neural voices": "ಕ್ಲೌಡ್ ನ್ಯೂರಲ್ ಧ್ವನಿಗಳು",
  "Browser, offline": "ಬ್ರೌಸರ್, ಆಫ್‌ಲೈನ್",
  "Downloaded local models": "ಡೌನ್‌ಲೋಡ್ ಮಾಡಿದ ಸ್ಥಳೀಯ ಮಾಡೆಲ್‌ಗಳು",
  "Embedder — RAG semantic search": "ಎಂಬೆಡರ್ — RAG ಶಬ್ದಾರ್ಥ ಹುಡುಕಾಟ",
  "Reranker — cross-encoder scoring": "ರೀರ್ಯಾಂಕರ್ — ಕ್ರಾಸ್-ಎನ್‌ಕೋಡರ್ ಸ್ಕೋರಿಂಗ್",
  "Both models run on the RTX 4070 (8 GB VRAM) and are always active — they are not switchable.":
    "ಎರಡೂ ಮಾಡೆಲ್‌ಗಳು RTX 4070 ನಲ್ಲಿ ಚಲಿಸುತ್ತವೆ ಮತ್ತು ಯಾವಾಗಲೂ ಸಕ್ರಿಯವಾಗಿರುತ್ತವೆ.",
  Resume: "ಪುನರಾರಂಭಿಸಿ",
  Pause: "ವಿರಾಮ",
  "Stop speech": "ಮಾತು ನಿಲ್ಲಿಸಿ",
  "Top offenders": "ಪ್ರಮುಖ ಆರೋಪಿಗಳು",
  "Seed person": "ಬೀಜ ವ್ಯಕ್ತಿ",
  "Accused / co-accused": "ಆರೋಪಿ / ಸಹ-ಆರೋಪಿ",
  "Victim / complainant": "ಸಂತ್ರಸ್ತ / ದೂರುದಾರ",
  "Case / FIR": "ಪ್ರಕರಣ / ಎಫ್‌ಐಆರ್",
  Connections: "ಸಂಪರ್ಕಗಳು",
  "Node type": "ನೋಡ್ ಪ್ರಕಾರ",
  "Network summary": "ನೆಟ್‌ವರ್ಕ್ ಸಾರಾಂಶ",
  "Total nodes": "ಒಟ್ಟು ನೋಡ್‌ಗಳು",
  Victims: "ಸಂತ್ರಸ್ತರು",
  "People & Cases": "ಜನರು ಮತ್ತು ಪ್ರಕರಣಗಳು",
  "Financial links": "ಹಣಕಾಸು ಲಿಂಕ್‌ಗಳು",
  Rings: "ರಿಂಗ್‌ಗಳು",
  "Highest access": "ಅತ್ಯುನ್ನತ ಪ್ರವೇಶ",
  "Medium access": "ಮಧ್ಯಮ ಪ್ರವೇಶ",
  "Low access": "ಕಡಿಮೆ ಪ್ರವೇಶ",
  "Invalid email or password. Please try again.": "ತಪ್ಪಾದ ಇಮೇಲ್ ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  "Please enter your email address.": "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಇಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿ.",
  "No account found for this email. Please create an account first.":
    "ಈ ಇಮೇಲ್‌ಗೆ ಯಾವುದೇ ಖಾತೆ ಕಂಡುಬಂದಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೊದಲು ಖಾತೆ ರಚಿಸಿ.",
  "your.name@ksp.gov.in": "your.name@ksp.gov.in",
  "Select your rank / role": "ನಿಮ್ಮ ಶ್ರೇಣಿ / ಪಾತ್ರ ಆಯ್ಕೆ ಮಾಡಿ",
  "Signing in…": "ಸೈನ್ ಇನ್ ಆಗುತ್ತಿದೆ…",
  "This username is already taken. Try a different name or email.":
    "ಈ ಬಳಕೆದಾರ ಹೆಸರು ಈಗಾಗಲೇ ಬಳಸಲ್ಪಟ್ಟಿದೆ.",
  "Password is required.": "ಪಾಸ್‌ವರ್ಡ್ ಅಗತ್ಯ.",
  "Please fill in all required fields.": "ಎಲ್ಲ ಅಗತ್ಯ ಕ್ಷೇತ್ರಗಳನ್ನು ತುಂಬಿಸಿ.",
  "Transcripts & History": "ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು ಮತ್ತು ಇತಿಹಾಸ",
  Conversations: "ಸಂಭಾಷಣೆಗಳು",
  "Find similar cases by description": "ವಿವರಣೆಯ ಮೂಲಕ ಹೋಲುವ ಪ್ರಕರಣಗಳನ್ನು ಹುಡುಕಿ",
  "e.g. chain snatching near bus stand at night":
    "ಉದಾ: ರಾತ್ರಿ ಬಸ್ ನಿಲ್ದಾಣದ ಬಳಿ ಚೈನ್ ಕಿತ್ತುಕೊಳ್ಳುವಿಕೆ",
  "Searching…": "ಹುಡುಕಲಾಗುತ್ತಿದೆ…",
  Close: "ಮುಚ್ಚಿ",

  // Forecast / Trends extra keys
  "Tell me more about": "ಬಗ್ಗೆ ಹೆಚ್ಚಿನ ಮಾಹಿತಿ ನೀಡಿ",
  in: "ನಲ್ಲಿ",
  "Show network": "ನೆಟ್‌ವರ್ಕ್ ತೋರಿಸಿ",
  "Ask AI": "AI ಅನ್ನು ಕೇಳಿ",
  "All clear": "ಎಲ್ಲ ಸ್ಪಷ್ಟ",
  Distribution: "ವಿತರಣೆ",
  "Model accuracy": "ಮಾಡೆಲ್ ನಿಖರತೆ",
  Active: "ಸಕ್ರಿಯ",
  Grid: "ಗ್ರಿಡ್",
  Fine: "ಸೂಕ್ಷ್ಮ",
  Med: "ಮಧ್ಯಮ",
  Coarse: "ಸ್ಥೂಲ",
  "Historical validation period": "ಐತಿಹಾಸಿಕ ಮೌಲ್ಯೀಕರಣ ಅವಧಿ",
  cards: "ಕಾರ್ಡ್‌ಗಳು",
  table: "ಕೋಷ್ಟಕ",
  "View case": "ಪ್ರಕರಣ ನೋಡಿ",
  "Crime Types": "ಅಪರಾಧ ಪ್ರಕಾರಗಳು",
  "Time Series": "ಕಾಲ ಶ್ರೇಣಿ",
  Granularity: "ಗ್ರ್ಯಾನ್ಯೂಲಾರಿಟಿ",
  week: "ವಾರ",
  month: "ತಿಂಗಳು",
  quarter: "ತ್ರೈಮಾಸಿಕ",
  "Incident Trend": "ಘಟನೆ ಪ್ರವೃತ್ತಿ",
  Period: "ಅವಧಿ",
  Count: "ಎಣಿಕೆ",
  "Top Districts": "ಪ್ರಮುಖ ಜಿಲ್ಲೆಗಳು",
  clusters: "ಕ್ಲಸ್ಟರ್‌ಗಳು",
  "No clusters available.": "ಯಾವುದೇ ಕ್ಲಸ್ಟರ್‌ಗಳು ಲಭ್ಯವಿಲ್ಲ.",
  "No seasonal data available for the current filters.":
    "ಪ್ರಸ್ತುತ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಋತುಮಾನ ಡೇಟಾ ಲಭ್ಯವಿಲ್ಲ.",
  Note: "ಗಮನಿಸಿ",

  // Profile screen
  "Search person, FIR number, crime type…": "ವ್ಯಕ್ತಿ, ಎಫ್‌ಐಆರ್ ಸಂಖ್ಯೆ, ಅಪರಾಧ ಪ್ರಕಾರ ಹುಡುಕಿ…",
  Persons: "ವ್ಯಕ್ತಿಗಳು",
  "Cases / FIRs": "ಪ್ರಕರಣಗಳು / ಎಫ್‌ಐಆರ್‌ಗಳು",
  "No results for": "ಇದಕ್ಕೆ ಯಾವುದೇ ಫಲಿತಾಂಶಗಳಿಲ್ಲ",
  "Find a Person or Case": "ವ್ಯಕ್ತಿ ಅಥವಾ ಪ್ರಕರಣ ಹುಡುಕಿ",
  "Search for a person or case": "ವ್ಯಕ್ತಿ ಅಥವಾ ಪ್ರಕರಣ ಹುಡುಕಿ",
  "Search by person name, FIR number, crime type, or date. Select a result to view the complete intelligence dossier.":
    "ವ್ಯಕ್ತಿಯ ಹೆಸರು, ಎಫ್‌ಐಆರ್ ಸಂಖ್ಯೆ, ಅಪರಾಧ ಪ್ರಕಾರ ಅಥವಾ ದಿನಾಂಕದಿಂದ ಹುಡುಕಿ.",
  "Loading profile…": "ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  "Insufficient clearance to view this profile.": "ಈ ಪ್ರೊಫೈಲ್ ವೀಕ್ಷಿಸಲು ಸಾಕಷ್ಟು ಅನುಮತಿ ಇಲ್ಲ.",
  "Download PDF": "PDF ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ",
  "Gender unknown": "ಲಿಂಗ ತಿಳಿದಿಲ್ಲ",
  Age: "ವಯಸ್ಸು",
  "Total Cases": "ಒಟ್ಟು ಪ್ರಕರಣಗಳು",
  "As Accused": "ಆರೋಪಿಯಾಗಿ",
  "Indicative only. Human review required.": "ಸೂಚಕ ಮಾತ್ರ. ಮಾನವ ಪರಿಶೀಲನೆ ಅಗತ್ಯ.",
  "Crime History": "ಅಪರಾಧ ಇತಿಹಾಸ",
  "Recent Activity": "ಇತ್ತೀಚಿನ ಚಟುವಟಿಕೆ",
  "View all": "ಎಲ್ಲ ನೋಡಿ",
  "No crime history found.": "ಯಾವುದೇ ಅಪರಾಧ ಇತಿಹಾಸ ಕಂಡುಬಂದಿಲ್ಲ.",
  "Known Associates": "ಪರಿಚಿತ ಆರೋಪಿಗಳು",
  "No known associates found.": "ಯಾವುದೇ ಪರಿಚಿತ ಆರೋಪಿಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",
  "shared cases": "ಹಂಚಿಕೊಂಡ ಪ್ರಕರಣಗಳು",
  "Legal Sections": "ಕಾನೂನು ವಿಭಾಗಗಳು",
  "Typical Time": "ಸಾಮಾನ್ಯ ಸಮಯ",
  "MO Fingerprint": "ಎಂಒ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್",
  "Risk Breakdown": "ಅಪಾಯ ವಿಭಜನೆ",

  // Reports screen
  "Report Builder": "ವರದಿ ನಿರ್ಮಾಣ",
  "Attach evidence": "ಸಾಕ್ಷ್ಯ ಸೇರಿಸಿ",
  "Upload from device": "ಸಾಧನದಿಂದ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ",
  "PDF, image, CSV — max ~5 MB": "PDF, ಚಿತ್ರ, CSV — ಗರಿಷ್ಠ ~5 MB",
  "Import from case dataset": "ಪ್ರಕರಣ ಡೇಟಾಸೆಟ್‌ನಿಂದ ಆಮದು",
  "Search FIR / crime type…": "ಎಫ್‌ಐಆರ್ / ಅಪರಾಧ ಪ್ರಕಾರ ಹುಡುಕಿ…",
  "Crime Trend Signal": "ಅಪರಾಧ ಪ್ರವೃತ್ತಿ ಸಂಕೇತ",
  "Notable Repeat Offenders": "ಪ್ರಮುಖ ಪುನರಾವರ್ತಿತ ಅಪರಾಧಿಗಳು",
  "Quarter-on-quarter": "ತ್ರೈಮಾಸಿಕ-ಮೇಲೆ-ತ್ರೈಮಾಸಿಕ",
  "Year-on-year": "ವರ್ಷ-ಮೇಲೆ-ವರ್ಷ",
  "Reviewed / Authorized": "ಪರಿಶೀಲಿಸಿ / ಅಧಿಕೃತಗೊಳಿಸಿ",
  "Confidential · Karnataka State Police · Synthetic data only":
    "ಗೌಪ್ಯ · ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪೊಲೀಸ್ · ಕೃತಕ ಡೇಟಾ ಮಾತ್ರ",
  "Model live inference": "ಮಾಡೆಲ್ ಲೈವ್ ಅನುಮಾನ",
  "Neural forecast engine": "ನ್ಯೂರಲ್ ಮುನ್ಸೂಚನೆ ಎಂಜಿನ್",
  "Live inference": "ಲೈವ್ ಅನುಮಾನ",
  "Acquiring signal…": "ಸಿಗ್ನಲ್ ಪಡೆಯಲಾಗುತ್ತಿದೆ…",
  "Cells scored": "ಕೋಶಗಳನ್ನು ಸ್ಕೋರ್ ಮಾಡಲಾಗಿದೆ",
  "High risk": "ಹೆಚ್ಚು ಅಪಾಯ",
  PAI: "PAI",
  "FIR intake": "ಎಫ್‌ಐಆರ್ ಸ್ವೀಕಾರ",
  Features: "ವೈಶಿಷ್ಟ್ಯಗಳು",
  "Risk model": "ಅಪಾಯ ಮಾಡೆಲ್",
  "Risk surface": "ಅಪಾಯ ಮೇಲ್ಮೈ",
  "Live threat surface": "ಲೈವ್ ಬೆದರಿಕೆ ಮೇಲ್ಮೈ",
  "Standing by…": "ಸ್ಟ್ಯಾಂಡ್‌ಬೈ ಆಗಿದೆ…",
  scored: "ಸ್ಕೋರ್ ಆಯಿತು",
  risk: "ಅಪಾಯ",
  "Backtest PAI": "ಬ್ಯಾಕ್‌ಟೆಸ್ಟ್ PAI",
  "Lower risk": "ಕಡಿಮೆ ಅಪಾಯ",
  "Higher risk": "ಹೆಚ್ಚು ಅಪಾಯ",
  "No grid cells for the current filters.": "ಪ್ರಸ್ತುತ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಯಾವುದೇ ಗ್ರಿಡ್ ಕೋಶಗಳಿಲ್ಲ.",
  "Darker cells indicate more reported incidents for that crime type in that period.":
    "ಗಾಢ ಕೋಶಗಳು ಆ ಅವಧಿಯಲ್ಲಿ ಹೆಚ್ಚಿನ ವರದಿಯಾದ ಘಟನೆಗಳನ್ನು ಸೂಚಿಸುತ್ತವೆ.",
  Fewer: "ಕಡಿಮೆ",
  "More incidents": "ಹೆಚ್ಚು ಘಟನೆಗಳು",
  "Ingesting FIR signals": "ಎಫ್‌ಐಆರ್ ಸಂಕೇತಗಳನ್ನು ಸ್ವೀಕರಿಸಲಾಗುತ್ತಿದೆ",
  "Engineering features": "ವೈಶಿಷ್ಟ್ಯಗಳನ್ನು ರೂಪಿಸಲಾಗುತ್ತಿದೆ",
  "KDE · recency · seasonality": "KDE · ಇತ್ತೀಚಿನ · ಋತುಮಾನ",
  "Running risk model": "ಅಪಾಯ ಮಾಡೆಲ್ ಚಲಾಯಿಸಲಾಗುತ್ತಿದೆ",
  "Self-exciting hotspot model": "ಸ್ವ-ಉತ್ತೇಜಕ ಹಾಟ್‌ಸ್ಪಾಟ್ ಮಾಡೆಲ್",
  "Projecting risk surface": "ಅಪಾಯ ಮೇಲ್ಮೈ ಪ್ರಕ್ಷೇಪಿಸಲಾಗುತ್ತಿದೆ",
  "Grid cell scoring": "ಗ್ರಿಡ್ ಕೋಶ ಸ್ಕೋರಿಂಗ್",
  "PAI hit rate": "PAI ಸಾಧನೆ ದರ",
  "as of": "ದಿನಾಂಕ",
  "Projected risk surface": "ಪ್ರಕ್ಷೇಪಿತ ಅಪಾಯ ಮೇಲ್ಮೈ",
  "Awaiting grid…": "ಗ್ರಿಡ್ ನಿರೀಕ್ಷಿಸಲಾಗುತ್ತಿದೆ…",
  "Crime × Period intensity": "ಅಪರಾಧ × ಅವಧಿ ತೀವ್ರತೆ",
  "Total Incidents": "ಒಟ್ಟು ಘಟನೆಗಳು",
  periods: "ಅವಧಿಗಳು",
  incidents: "ಘಟನೆಗಳು",
  "by incident count": "ಘಟನೆ ಎಣಿಕೆಯ ಪ್ರಕಾರ",
  Rising: "ಏರಿಕೆ",
  Falling: "ಇಳಿಕೆ",
  Stable: "ಸ್ಥಿರ",
  "Dominant Pattern Detected": "ಪ್ರಧಾನ ಮಾದರಿ ಪತ್ತೆಯಾಗಿದೆ",
  "accounts for": "ಕಾರಣವಾಗಿದೆ",
  "of all incidents in this view.": "ಈ ದೃಶ್ಯದ ಎಲ್ಲ ಘಟನೆಗಳ.",
  "Highest Seasonal Spike": "ಅತ್ಯಧಿಕ ಋತುಮಾನ ಏರಿಕೆ",
  "Total reported incidents per period. Peak bar is highlighted.":
    "ಪ್ರತಿ ಅವಧಿಗೆ ಒಟ್ಟು ವರದಿಯಾದ ಘಟನೆಗಳು. ಶಿಖರ ಪಟ್ಟಿ ಹೈಲೈಟ್ ಆಗಿದೆ.",
  "Clear all": "ಎಲ್ಲ ತೆರವು",
  "Quick add — Top Stations": "ತ್ವರಿತ ಸೇರ್ಪಡೆ — ಪ್ರಮುಖ ಠಾಣೆಗಳು",
  "Search and add person, FIR, crime type…": "ವ್ಯಕ್ತಿ, ಎಫ್‌ಐಆರ್, ಅಪರಾಧ ಪ್ರಕಾರ ಹುಡುಕಿ ಸೇರಿಸಿ…",
  "Search above to add persons, FIRs, or use quick add":
    "ವ್ಯಕ್ತಿಗಳು ಅಥವಾ ಎಫ್‌ಐಆರ್‌ಗಳನ್ನು ಸೇರಿಸಲು ಮೇಲೆ ಹುಡುಕಿ",
  "Report Title": "ವರದಿ ಶೀರ್ಷಿಕೆ",
  "Prepared by": "ತಯಾರಿಸಿದವರು",
  "Officer name / rank": "ಅಧಿಕಾರಿ ಹೆಸರು / ಶ್ರೇಣಿ",
  Template: "ಟೆಂಪ್ಲೇಟ್",
  "Print PDF": "PDF ಮುದ್ರಿಸಿ",
  "Executive Summary": "ಕಾರ್ಯಕಾರಿ ಸಾರಾಂಶ",
  "Distribution by Station": "ಠಾಣೆಯ ಪ್ರಕಾರ ವಿತರಣೆ",
  "Selected Items": "ಆಯ್ಕೆ ಮಾಡಿದ ಐಟಂಗಳು",
  "Compliance Notice": "ಅನುಸರಣೆ ಸೂಚನೆ",
  "Clearance Rate": "ಕ್ಲಿಯರೆನ್ಸ್ ದರ",
  "Top Crime": "ಪ್ರಮುಖ ಅಪರಾಧ",
  Total: "ಒಟ್ಟು",
  "Add persons or cases from the search bar on the left.":
    "ಎಡ ಭಾಗದ ಹುಡುಕಾಟ ಪಟ್ಟಿಯಿಂದ ವ್ಯಕ್ತಿಗಳನ್ನು ಅಥವಾ ಪ್ರಕರಣಗಳನ್ನು ಸೇರಿಸಿ.",
  "Items will appear here and be included in the exported PDF.":
    "ಐಟಂಗಳು ಇಲ್ಲಿ ಕಾಣಿಸಿಕೊಂಡು ರಫ್ತು ಮಾಡಿದ PDF ನಲ್ಲಿ ಸೇರಿಸಲಾಗುತ್ತದೆ.",
  "View profile": "ಪ್ರೊಫೈಲ್ ನೋಡಿ",
  "This report is generated for law enforcement use only. All data shown is synthetic and does not represent real individuals, cases, or incidents. Risk scores are decision-support tools — not predictive policing instruments. Human review is required before any operational action.":
    "ಈ ವರದಿಯನ್ನು ಕಾನೂನು ಜಾರಿ ಉಪಯೋಗಕ್ಕೆ ಮಾತ್ರ ರಚಿಸಲಾಗಿದೆ. ಎಲ್ಲ ಡೇಟಾ ಕೃತಕ ಮಾತ್ರ.",
  "Loading station data…": "ಠಾಣೆ ಡೇಟಾ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  "No results matched your query. Try a broader question or different filters.":
    "ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ಯಾವುದೇ ಫಲಿತಾಂಶ ಸಿಗಲಿಲ್ಲ. ವಿಭಿನ್ನ ಫಿಲ್ಟರ್ ಬಳಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  "Seasonal lift % indicates how much higher the crime rate is compared to the year-round baseline for that period. Higher values indicate stronger seasonal patterns.":
    "ಋತುಮಾನ ಏರಿಕೆ % ಎಂದರೆ ಆ ಅವಧಿಗೆ ವಾರ್ಷಿಕ ಆಧಾರರೇಖೆಗಿಂತ ಅಪರಾಧ ದರ ಎಷ್ಟು ಹೆಚ್ಚಿದೆ ಎಂದು ಸೂಚಿಸುತ್ತದೆ.",

  "Voice copilot mic (Speech-to-Text)": "ವಾಯ್ಸ್ ಕೋಪೈಲಟ್ ಮೈಕ್ (ವಾಕ್-ಟು-ಟೆಕ್ಸ್ಟ್)",
  "Engine for the top-right voice copilot only. Does not affect the chat box mic or the chat voice.":
    "ಮೇಲ್-ಬಲ ವಾಯ್ಸ್ ಕೋಪೈಲಟ್‌ಗೆ ಮಾತ್ರ. ಚಾಟ್ ಬಾಕ್ಸ್ ಮೈಕ್ ಅಥವಾ ಚಾಟ್ ವಾಯ್ಸ್ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರುವುದಿಲ್ಲ.",
  Browser: "ಬ್ರೌಸರ್",
  "Lowest latency · live captions": "ಕಡಿಮೆ ವಿಳಂಬ · ಲೈವ್ ಕ್ಯಾಪ್ಷನ್",
  "Best Kannada accuracy": "ಅತ್ಯುತ್ತಮ ಕನ್ನಡ ನಿಖರತೆ",
  "Stop dictation": "ಡಿಕ್ಟೇಶನ್ ನಿಲ್ಲಿಸಿ",
  "Dictate into chat": "ಚಾಟ್‌ಗೆ ಡಿಕ್ಟೇಟ್ ಮಾಡಿ",
  "PS8 · Predictive Intelligence": "PS8 · ಭವಿಷ್ಯಸೂಚಕ ಗುಪ್ತಚರ",
  "Early Warning & Forecast": "ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ಮತ್ತು ಮುನ್ಸೂಚನೆ",
  "hit rate": "ಸಾಧನೆ ದರ",
  "active alert": "ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆ",
  "active alerts": "ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆಗಳು",
  "Crime type…": "ಅಪರಾಧ ಪ್ರಕಾರ…",
  "District…": "ಜಿಲ್ಲೆ…",
  Horizon: "ಅವಧಿ",
  d: "ದಿ",
  Refresh: "ರಿಫ್ರೆಶ್",
  "Toggle details": "ವಿವರಗಳನ್ನು ತೋರಿಸು",
  Patrol: "ಗಸ್ತು",
  "Recommended Action": "ಶಿಫಾರಸು ಮಾಡಿದ ಕ್ರಮ",
  "Why this cell is flagged": "ಈ ಕೋಶ ಏಕೆ ಫ್ಲ್ಯಾಗ್ ಆಗಿದೆ",
  "Early Warning Alerts": "ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ಅಲರ್ಟ್‌ಗಳು",
  "Data as of": "ಡೇಟಾ ದಿನಾಂಕ",
  "comparing last 30 data-days vs prior 30-day baseline":
    "ಕಳೆದ 30 ಡೇಟಾ-ದಿನಗಳನ್ನು ಹಿಂದಿನ 30-ದಿನದ ಆಧಾರರೇಖೆಯೊಂದಿಗೆ ಹೋಲಿಕೆ",
  "No active alerts": "ಯಾವುದೇ ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆಗಳಿಲ್ಲ",
  "No forecast thresholds exceeded for the current filters.":
    "ಪ್ರಸ್ತುತ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಯಾವುದೇ ಮುನ್ಸೂಚನೆ ಮಿತಿ ಮೀರಿಲ್ಲ.",
  "Forecast Risk Grid": "ಮುನ್ಸೂಚನೆ ಅಪಾಯ ಗ್ರಿಡ್",
  horizon: "ಅವಧಿ",
  "Group by crime type": "ಅಪರಾಧ ಪ್ರಕಾರದಂತೆ ಗುಂಪುಮಾಡಿ",
  "Loading grid cells…": "ಗ್ರಿಡ್ ಕೋಶಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…",
  "No risk grid data for the selected filters.":
    "ಆಯ್ಕೆ ಮಾಡಿದ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಯಾವುದೇ ಅಪಾಯ ಗ್ರಿಡ್ ಡೇಟಾ ಇಲ್ಲ.",
  "Risk Level": "ಅಪಾಯ ಮಟ್ಟ",
  "Crime Type": "ಅಪರಾಧ ಪ್ರಕಾರ",
  "Risk Score": "ಅಪಾಯ ಸ್ಕೋರ್",
  "Location (lat, lng)": "ಸ್ಥಳ (ಅಕ್ಷಾಂಶ, ರೇಖಾಂಶ)",
  "Showing top-risk cell per crime type": "ಪ್ರತಿ ಅಪರಾಧ ಪ್ರಕಾರಕ್ಕೆ ಅತ್ಯಧಿಕ ಅಪಾಯದ ಕೋಶ ತೋರಿಸಲಾಗಿದೆ",
  "total cells analysed": "ಒಟ್ಟು ಕೋಶಗಳನ್ನು ವಿಶ್ಲೇಷಿಸಲಾಗಿದೆ",
  "Model Validation (Backtest)": "ಮಾಡೆಲ್ ಮೌಲ್ಯೀಕರಣ (ಬ್ಯಾಕ್‌ಟೆಸ್ಟ್)",
  Score: "ಸ್ಕೋರ್",
  "Backtest Window": "ಬ್ಯಾಕ್‌ಟೆಸ್ಟ್ ವಿಂಡೋ",
  "What This Means": "ಇದರ ಅರ್ಥ",
  "Decision support only — not predictive policing. Risk scores are based on historical reported incidents, not arrests or individual characteristics. Patrol decisions require human judgment.":
    "ನಿರ್ಧಾರ ಬೆಂಬಲ ಮಾತ್ರ — ಭವಿಷ್ಯಸೂಚಕ ಪೊಲೀಸಿಂಗ್ ಅಲ್ಲ. ಅಪಾಯ ಸ್ಕೋರ್‌ಗಳು ಐತಿಹಾಸಿಕ ವರದಿ ಘಟನೆಗಳ ಆಧಾರದ ಮೇಲಿವೆ, ಬಂಧನ ಅಥವಾ ವ್ಯಕ್ತಿಗತ ಗುಣಲಕ್ಷಣಗಳ ಆಧಾರದ ಮೇಲಲ್ಲ. ಗಸ್ತು ನಿರ್ಧಾರಗಳಿಗೆ ಮಾನವ ತೀರ್ಪು ಅಗತ್ಯ.",
  "Could not load forecast data. Check you are signed in and the backend is running.":
    "ಮುನ್ಸೂಚನೆ ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ನೀವು ಸೈನ್ ಇನ್ ಆಗಿದ್ದೀರಾ ಮತ್ತು ಬ್ಯಾಕೆಂಡ್ ಚಾಲನೆಯಲ್ಲಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.",

  // Trends screen
  "PS3 · MO Clustering": "PS3 · ಎಂಒ ಕ್ಲಸ್ಟರಿಂಗ್",
  "Trends & Patterns": "ಪ್ರವೃತ್ತಿಗಳು ಮತ್ತು ಮಾದರಿಗಳು",
  "Crime type filter…": "ಅಪರಾಧ ಪ್ರಕಾರ ಫಿಲ್ಟರ್…",
  "District filter…": "ಜಿಲ್ಲೆ ಫಿಲ್ಟರ್…",
  "Could not load trends data.": "ಪ್ರವೃತ್ತಿ ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "No trend data": "ಯಾವುದೇ ಪ್ರವೃತ್ತಿ ಡೇಟಾ ಇಲ್ಲ",
  "Peak period": "ಶಿಖರ ಅವಧಿ",
  max: "ಗರಿಷ್ಠ",
  "QoQ Change": "ತ್ರೈಮಾಸಿಕ-ಮೇಲೆ-ತ್ರೈಮಾಸಿಕ ಬದಲಾವಣೆ",
  "YoY Change": "ವರ್ಷ-ಮೇಲೆ-ವರ್ಷ ಬದಲಾವಣೆ",
  "Top Crime Types": "ಪ್ರಮುಖ ಅಪರಾಧ ಪ್ರಕಾರಗಳು",
  "Seasonal Peaks": "ಋತುಮಾನ ಶಿಖರಗಳು",
  "above baseline": "ಆಧಾರರೇಖೆಗಿಂತ ಹೆಚ್ಚು",
  "MO Clusters": "ಎಂಒ ಕ್ಲಸ್ಟರ್‌ಗಳು",
  Cluster: "ಕ್ಲಸ್ಟರ್",
  Cases: "ಪ್ರಕರಣಗಳು",

  // ── Admin screen ────────────────────────────────────────────────────────
  "Rank": "ಶ್ರೇಣಿ",
  "admin": "ನಿರ್ವಾಹಕ",
  "Disabled": "ನಿಷ್ಕ್ರಿಯ",
  "Edit": "ಸಂಪಾದಿಸಿ",
  "Cancel": "ರದ್ದುಮಾಡಿ",
  "Name": "ಹೆಸರು",
  "No results": "ಯಾವುದೇ ಫಲಿತಾಂಶ ಇಲ್ಲ",
  "Save changes": "ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ",
  "Profile": "ಪ್ರೊಫೈಲ್",
  "Preferences": "ಆದ್ಯತೆಗಳು",
  "Notifications": "ಅಧಿಸೂಚನೆಗಳು",
  "Security": "ಭದ್ರತೆ",
  "Data & Privacy": "ಡೇಟಾ ಮತ್ತು ಗೌಪ್ಯತೆ",
  "Models & Backend": "ಮಾದರಿಗಳು ಮತ್ತು ಬ್ಯಾಕೆಂಡ್",
  "Live-switch engines without redeploying": "ಮರು-ನಿಯೋಜನೆ ಇಲ್ಲದೆ ಎಂಜಿನ್ ಬದಲಿಸಿ",
  "Model backend": "ಮಾದರಿ ಬ್ಯಾಕೆಂಡ್",
  "API model (cloud)": "API ಮಾದರಿ (ಕ್ಲೌಡ್)",
  "Local model (on-prem)": "ಸ್ಥಳೀಯ ಮಾದರಿ (ಆನ್-ಪ್ರೆಮ್)",
  "Text-to-SQL engine": "ಟೆಕ್ಸ್ಟ್-ಟು-SQL ಎಂಜಿನ್",
  "Your investigator details": "ನಿಮ್ಮ ತನಿಖಾಧಿಕಾರಿ ವಿವರಗಳು",
  "Badge ID": "ಬ್ಯಾಡ್ಜ್ ಐಡಿ",
  "Email": "ಇಮೇಲ್",
  "Language": "ಭಾಷೆ",
  "Default landing": "ಡಿಫಾಲ್ಟ್ ಲ್ಯಾಂಡಿಂಗ್",
  "Density": "ಸಾಂದ್ರತೆ",
  "Comfortable": "ಆರಾಮದಾಯಕ",
  "Compact": "ಸಂಕ್ಷಿಪ್ತ",
  "Time format": "ಸಮಯ ಸ್ವರೂಪ",
  "New FIR assignments": "ಹೊಸ FIR ನಿಯೋಜನೆಗಳು",
  "Case status updates": "ಪ್ರಕರಣ ಸ್ಥಿತಿ ನವೀಕರಣಗಳು",
  "Hotspot alerts": "ಹಾಟ್‌ಸ್ಪಾಟ್ ಎಚ್ಚರಿಕೆಗಳು",
  "Weekly summary email": "ಸಾಪ್ತಾಹಿಕ ಸಾರಾಂಶ ಇಮೇಲ್",
  "Sound on new message": "ಹೊಸ ಸಂದೇಶದ ಮೇಲೆ ಧ್ವನಿ",
  "Choose what alerts you receive": "ನೀವು ಸ್ವೀಕರಿಸುವ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿ",
  "Current password": "ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್",
  "New password": "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್",
  "Two-factor authentication (TOTP)": "ಎರಡು-ಅಂಶ ದೃಢೀಕರಣ (TOTP)",
  "Require MFA on every sign-in": "ಪ್ರತಿ ಸೈನ್ ಇನ್‌ನಲ್ಲಿ MFA ಅಗತ್ಯ",
  "Allow analytics on query patterns": "ಪ್ರಶ್ನೆ ಮಾದರಿಗಳ ವಿಶ್ಲೇಷಣೆ ಅನುಮತಿಸಿ",
  "Share anonymized usage with KSP IT": "ಅನಾಮಧೇಯ ಬಳಕೆಯನ್ನು KSP IT ಜೊತೆ ಹಂಚಿ",
  "Manage workspace data": "ಕಾರ್ಯಸ್ಥಳ ಡೇಟಾ ನಿರ್ವಹಿಸಿ",
  "Workspace appearance & language": "ಕಾರ್ಯಸ್ಥಳ ಗೋಚರತೆ ಮತ್ತು ಭಾಷೆ",

  // ── Board screen ─────────────────────────────────────────────────────────
  "Insert": "ಸೇರಿಸಿ",
  "Insert shapes / errors / media": "ಆಕಾರ / ದೋಷ / ಮಾಧ್ಯಮ ಸೇರಿಸಿ",
  "Saved boards": "ಉಳಿಸಿದ ಬೋರ್ಡ್‌ಗಳು",
  "No saved boards yet.": "ಇನ್ನೂ ಯಾವುದೇ ಉಳಿಸಿದ ಬೋರ್ಡ್‌ಗಳಿಲ್ಲ.",
  "Load saved canvas": "ಉಳಿಸಿದ ಕ್ಯಾನ್ವಾಸ್ ಲೋಡ್ ಮಾಡಿ",
  "AI Scene Generator": "AI ದೃಶ್ಯ ಜನರೇಟರ್",
  "Describe suspects, evidence, crime scene… (Ctrl+Enter)": "ಶಂಕಿತರನ್ನು, ಸಾಕ್ಷ್ಯ, ಅಪರಾಧ ಸ್ಥಳ ವಿವರಿಸಿ… (Ctrl+Enter)",
  "Photo": "ಫೋಟೋ",
  "Generate": "ರಚಿಸಿ",
  "Generating…": "ರಚಿಸಲಾಗುತ್ತಿದೆ…",
  "AI builds the scene — use tldraw tools to edit anything.": "AI ದೃಶ್ಯ ನಿರ್ಮಿಸುತ್ತದೆ — ಏನನ್ನಾದರೂ ಸಂಪಾದಿಸಲು tldraw ಉಪಕರಣಗಳನ್ನು ಬಳಸಿ.",
  "Open": "ತೆರೆಯಿರಿ",
  "Export PNG": "PNG ರಫ್ತು",
  "Clear board?": "ಬೋರ್ಡ್ ತೆರವು ಮಾಡಬೇಕೇ?",
  "Recover": "ಮರುಪಡೆಯಿರಿ",
  "Nothing to export — add some shapes first.": "ರಫ್ತು ಮಾಡಲು ಏನೂ ಇಲ್ಲ — ಮೊದಲು ಕೆಲವು ಆಕಾರಗಳನ್ನು ಸೇರಿಸಿ.",
  "Could not save board.": "ಬೋರ್ಡ್ ಉಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "Could not open board.": "ಬೋರ್ಡ್ ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "Could not load boards — check you are signed in.": "ಬೋರ್ಡ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ — ನೀವು ಸೈನ್ ಇನ್ ಆಗಿದ್ದೀರಾ ಎಂದು ಪರಿಶೀಲಿಸಿ.",
  "Rate limit hit — switch to Groq in Settings → Models → Board AI, then try again.": "ದರ ಮಿತಿ ತಲುಪಿದೆ — Settings → Models → Board AI ನಲ್ಲಿ Groq ಗೆ ಬದಲಿಸಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  "Shapes": "ಆಕಾರಗಳು",
  "Errors": "ದೋಷಗಳು",
  "Import": "ಆಮದು",
  "Size": "ಗಾತ್ರ",
  "Import PNG / JPG": "PNG / JPG ಆಮದು",
  "Paste images onto canvas": "ಕ್ಯಾನ್ವಾಸ್ ಮೇಲೆ ಚಿತ್ರಗಳನ್ನು ಅಂಟಿಸಿ",
  "Import Audio Clip": "ಆಡಿಯೋ ಕ್ಲಿಪ್ ಆಮದು",
  "MP3, WAV, M4A → evidence card": "MP3, WAV, M4A → ಸಾಕ್ಷ್ಯ ಕಾರ್ಡ್",

  // ── Ops / Predictive Deployment ──────────────────────────────────────────
  "Predictive Deployment": "ಭವಿಷ್ಯಸೂಚಕ ನಿಯೋಜನೆ",
  "Rule-based forecast · real case data · no synthetic incidents": "ನಿಯಮ-ಆಧಾರಿತ ಮುನ್ಸೂಚನೆ · ನಿಜ ಪ್ರಕರಣ ಡೇಟಾ · ಕೃತಕ ಘಟನೆಗಳಿಲ್ಲ",
  "Predicted Risk Surface": "ಭವಿಷ್ಯಸೂಚಕ ಅಪಾಯ ಮೇಲ್ಮೈ",
  "forecast cells": "ಮುನ್ಸೂಚನೆ ಕೋಶಗಳು",
  "Deployment suggestions": "ನಿಯೋಜನೆ ಸಲಹೆಗಳು",
  "Recompute": "ಮರು-ಲೆಕ್ಕ ಹಾಕಿ",
  "No active forecast alerts.": "ಯಾವುದೇ ಸಕ್ರಿಯ ಮುನ್ಸೂಚನೆ ಎಚ್ಚರಿಕೆಗಳಿಲ್ಲ.",
  "Simulate deployment": "ನಿಯೋಜನೆ ಅನುಕರಿಸಿ",
  "Stop simulation": "ಅನುಕರಣೆ ನಿಲ್ಲಿಸಿ",
  "Unit on station": "ಘಟಕ ಠಾಣೆಯಲ್ಲಿದೆ",
  "Patrol deploying": "ಗಸ್ತು ನಿಯೋಜಿಸಲಾಗುತ್ತಿದೆ",
  "Unit on station — Reset": "ಘಟಕ ಠಾಣೆಯಲ್ಲಿದೆ — ರೀಸೆಟ್",
  "Demo Mode ON": "ಡೆಮೋ ಮೋಡ್ ಚಾಲು",
  "Demo Mode OFF": "ಡೆಮೋ ಮೋಡ್ ಆಫ್",
  "Simulate All": "ಎಲ್ಲ ಅನುಕರಿಸಿ",
  "Stop All": "ಎಲ್ಲ ನಿಲ್ಲಿಸಿ",
  "Active Dispatches": "ಸಕ್ರಿಯ ರವಾನೆಗಳು",
  "Turn on Demo Mode, then hit Simulate All.": "ಡೆಮೋ ಮೋಡ್ ಆನ್ ಮಾಡಿ, ನಂತರ Simulate All ಒತ್ತಿ.",
  "en route": "ಮಾರ್ಗದಲ್ಲಿ",
  "min": "ನಿ",
  "Green Corridor": "ಹಸಿರು ಕಾರಿಡಾರ್",
  "ACTIVE": "ಸಕ್ರಿಯ",
  "IDLE": "ನಿಷ್ಕ್ರಿಯ",
  "Signals prioritized for responding units.": "ಪ್ರತಿಕ್ರಿಯಿಸುವ ಘಟಕಗಳಿಗಾಗಿ ಸಂಕೇತಗಳಿಗೆ ಆದ್ಯತೆ ನೀಡಲಾಗಿದೆ.",
  "signals green": "ಸಂಕೇತಗಳು ಹಸಿರು",
  "Live Event Feed": "ಲೈವ್ ಘಟನೆ ಫೀಡ್",
  "No events yet.": "ಇನ್ನೂ ಯಾವುದೇ ಘಟನೆಗಳಿಲ್ಲ.",

  // ── Audit screen extra ────────────────────────────────────────────────────
  "Reset": "ರೀಸೆಟ್",

  // ── Reports extra ─────────────────────────────────────────────────────────
  "Remove from report": "ವರದಿಯಿಂದ ತೆಗೆಯಿರಿ",
  "Type 2+ characters to search FIRs": "FIR ಹುಡುಕಲು 2+ ಅಕ್ಷರಗಳನ್ನು ಟೈಪ್ ಮಾಡಿ",

  // ── General UI ────────────────────────────────────────────────────────────
  "Back": "ಹಿಂದೆ",
  "Done": "ಮುಗಿಯಿತು",
  "Confirm": "ದೃಢೀಕರಿಸಿ",
  "Yes": "ಹೌದು",
  "No": "ಇಲ್ಲ",
  "Unknown": "ತಿಳಿದಿಲ್ಲ",
  "Retry": "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",

  // ── CaseDrawer ────────────────────────────────────────────────────────────
  "Similar Cases": "ಹೋಲುವ ಪ್ರಕರಣಗಳು",
  "Timeline": "ಸಮಯರೇಖೆ",
  "Loading timeline…": "ಸಮಯರೇಖೆ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  "No timeline events found.": "ಯಾವುದೇ ಸಮಯರೇಖೆ ಘಟನೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",
  "Finding similar cases…": "ಹೋಲುವ ಪ್ರಕರಣಗಳನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ…",
  "No similar cases found.": "ಯಾವುದೇ ಹೋಲುವ ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",
  "match": "ಹೊಂದಾಣಿಕೆ",
  // Timeline event titles
  "Incident occurred": "ಘಟನೆ ಸಂಭವಿಸಿದೆ",
  "FIR registered": "ಎಫ್‌ಐಆರ್ ನೋಂದಾಯಿಸಲಾಗಿದೆ",
  "Charge sheet filed": "ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಲಾಗಿದೆ",
  "Conviction recorded": "ಶಿಕ್ಷೆ ದಾಖಲಾಗಿದೆ",
  // Timeline event type keys (raw from API)
  "incident": "ಘಟನೆ",
  "fir_registered": "ಎಫ್‌ಐಆರ್ ನೋಂದಾಯಿತ",
  "io_assigned": "ತನಿಖಾಧಿಕಾರಿ ನಿಯೋಜಿತ",
  "charge_sheeted": "ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಿದ",
  "convicted": "ಶಿಕ್ಷೆಗೊಳಗಾದ",
  "acquitted": "ಖುಲಾಸೆಗೊಂಡ",
  "closed": "ಮುಕ್ತಾಯ",
  // why_similar tags from API
  "Same crime type": "ಒಂದೇ ಅಪರಾಧ ಪ್ರಕಾರ",
  "Same district": "ಒಂದೇ ಜಿಲ್ಲೆ",
  "Same legal sections": "ಒಂದೇ ಕಾನೂನು ವಿಭಾಗಗಳು",
  "Same station": "ಒಂದೇ ಠಾಣೆ",
  "Same time of day": "ದಿನದ ಒಂದೇ ಸಮಯ",

  // ── Profile screen ────────────────────────────────────────────────────────
  "Browse offenders…": "ಅಪರಾಧಿಗಳನ್ನು ಬ್ರೌಸ್ ಮಾಡಿ…",
  "Frequency": "ಆವರ್ತನ",
  "Recency": "ಇತ್ತೀಚಿನತೆ",
  "Severity": "ತೀವ್ರತೆ",
  "Group offending": "ಗುಂಪು ಅಪರಾಧ",
  "Outcomes": "ಫಲಿತಾಂಶಗಳು",
  "0 accused cases": "0 ಆರೋಪಿ ಪ್ರಕರಣಗಳು",
  "Recent case activity": "ಇತ್ತೀಚಿನ ಪ್ರಕರಣ ಚಟುವಟಿಕೆ",
  "0 heinous cases": "0 ಘೋರ ಪ್ರಕರಣಗಳು",
  "Connected to 0 associates": "0 ಸಹಚರರಿಗೆ ಸಂಪರ್ಕಿತ",
  "Charge-sheeted cases": "ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಿದ ಪ್ರಕರಣಗಳು",
  "Decision support only — not predictive policing.": "ನಿರ್ಧಾರ ಬೆಂಬಲ ಮಾತ್ರ — ಭವಿಷ್ಯಸೂಚಕ ಪೊಲೀಸಿಂಗ್ ಅಲ್ಲ.",
  "Associates": "ಸಹಚರರು",
  "PS5 · Offender Profile": "PS5 · ಅಪರಾಧಿ ಪ್ರೊಫೈಲ್",
  "Offender Intelligence": "ಅಪರಾಧಿ ಗುಪ್ತಚರ",

  // ── Socio dashboard ───────────────────────────────────────────────────────
  "PS4 · SP+ access": "PS4 · SP+ ಪ್ರವೇಶ",
  "Socio-Economic Dashboard": "ಸಾಮಾಜಿಕ-ಆರ್ಥಿಕ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
  "SP+ rank required to view this data.": "ಈ ಡೇಟಾ ವೀಕ್ಷಿಸಲು SP+ ಶ್ರೇಣಿ ಅಗತ್ಯ.",
  "Could not load socio data.": "ಸಾಮಾಜಿಕ ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
  "Age Distribution": "ವಯಸ್ಸಿನ ವಿತರಣೆ",
  "Gender Distribution": "ಲಿಂಗ ವಿತರಣೆ",
  "Correlation Matrix": "ಸಹಸಂಬಂಧ ಮ್ಯಾಟ್ರಿಕ್ಸ್",
  "Social Risk Index": "ಸಾಮಾಜಿಕ ಅಪಾಯ ಸೂಚ್ಯಂಕ",
  "Crime Rate": "ಅಪರಾಧ ದರ",
  "Literacy %": "ಸಾಕ್ಷರತೆ %",
  "Urban %": "ನಗರ %",
  "Income Index": "ಆದಾಯ ಸೂಚ್ಯಂಕ",
  // Socio risk drivers (from API)
  "High crime rate": "ಅಧಿಕ ಅಪರಾಧ ದರ",
  "Low literacy": "ಕಡಿಮೆ ಸಾಕ್ಷರತೆ",
  "High urbanization": "ಅಧಿಕ ನಗರೀಕರಣ",
  "Low income": "ಕಡಿಮೆ ಆದಾಯ",
  "Repeat offending": "ಪುನರಾವರ್ತಿತ ಅಪರಾಧ",
  "Young offender concentration": "ಯುವ ಅಪರಾಧಿ ಸಾಂದ್ರತೆ",

  // ── Translation settings tab ─────────────────────────────────────────────
  "Translation": "ಅನುವಾದ",
  "Kannada Translation": "ಕನ್ನಡ ಅನುವಾದ",
  "Use Groq Llama-3.1-70B to fill in missing Kannada translations": "ಕಾಣೆಯಾದ ಕನ್ನಡ ಅನುವಾದಗಳನ್ನು ತುಂಬಲು Groq Llama-3.1-70B ಬಳಸಿ",
  "How it works": "ಇದು ಹೇಗೆ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ",
  "Translates UI labels AND synthetic data values (station names, crime types, districts)": "UI ಲೇಬಲ್‌ಗಳು ಮತ್ತು ಸಿಂಥೆಟಿಕ್ ಡೇಟಾ ಮೌಲ್ಯಗಳನ್ನು (ಠಾಣೆ ಹೆಸರುಗಳು, ಅಪರಾಧ ವಿಧಗಳು, ಜಿಲ್ಲೆಗಳು) ಅನುವಾದಿಸುತ್ತದೆ",
  // ── ProfileMenu / Account switcher ───────────────────────────────────────
  "Switch account": "ಖಾತೆ ಬದಲಾಯಿಸಿ",
  "Switch account?": "ಖಾತೆ ಬದಲಾಯಿಸಬೇಕೇ?",
  "Switch & reload": "ಬದಲಾಯಿಸಿ ಮತ್ತು ಮರುಲೋಡ್ ಮಾಡಿ",
  "Add another account": "ಮತ್ತೊಂದು ಖಾತೆ ಸೇರಿಸಿ",
  "Manage accounts": "ಖಾತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ",
  "Profile & settings": "ಪ್ರೊಫೈಲ್ ಮತ್ತು ಸೆಟ್ಟಿಂಗ್‌ಗಳು",
  "Sign out": "ಸೈನ್ ಔಟ್",
  "Change photo": "ಫೋಟೋ ಬದಲಾಯಿಸಿ",
  "Update profile photo": "ಪ್ರೊಫೈಲ್ ಫೋಟೋ ನವೀಕರಿಸಿ",
  "Remove photo": "ಫೋಟೋ ತೆಗೆದುಹಾಕಿ",
  "Loading workspace…": "ಕಾರ್ಯಸ್ಥಳ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  "Workspace ready": "ಕಾರ್ಯಸ್ಥಳ ಸಿದ್ಧ",
  "Switching ends the current session and reloads cases, permissions, and dashboards for the selected workspace.":
    "ಬದಲಾಯಿಸುವುದರಿಂದ ಪ್ರಸ್ತುತ ಸೆಶನ್ ಮುಗಿಯುತ್ತದೆ ಮತ್ತು ಆಯ್ಕೆ ಮಾಡಿದ ಕಾರ್ಯಸ್ಥಳಕ್ಕಾಗಿ ಪ್ರಕರಣಗಳು, ಅನುಮತಿಗಳು ಮತ್ತು ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ಗಳನ್ನು ಮರುಲೋಡ್ ಮಾಡುತ್ತದೆ.",
  "Signing out current session": "ಪ್ರಸ್ತುತ ಸೆಶನ್ ಸೈನ್ ಔಟ್ ಮಾಡಲಾಗುತ್ತಿದೆ",
  "Authenticating new identity": "ಹೊಸ ಗುರುತನ್ನು ದೃಢೀಕರಿಸಲಾಗುತ್ತಿದೆ",
  "Loading workspace permissions": "ಕಾರ್ಯಸ್ಥಳ ಅನುಮತಿಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ",
  "Refreshing case data": "ಪ್ರಕರಣ ಡೇಟಾ ರಿಫ್ರೆಶ್ ಮಾಡಲಾಗುತ್ತಿದೆ",

  "Sends untranslated strings to Groq Llama-3.1-70B in batches": "ಅನುವಾದಿಸದ ಸ್ಟ್ರಿಂಗ್‌ಗಳನ್ನು Groq Llama-3.1-70B ಗೆ ಬ್ಯಾಚ್‌ಗಳಲ್ಲಿ ಕಳುಹಿಸುತ್ತದೆ",
  "Saves translations to your browser's local storage": "ಬ್ರೌಸರ್‌ನ ಲೋಕಲ್ ಸ್ಟೋರೇಜ್‌ಗೆ ಅನುವಾದಗಳನ್ನು ಉಳಿಸುತ್ತದೆ",
  "Runs only once — uses cached result on every subsequent visit": "ಒಮ್ಮೆ ಮಾತ್ರ ಚಲಿಸುತ್ತದೆ — ನಂತರದ ಪ್ರತಿ ಭೇಟಿಯಲ್ಲಿ ಕ್ಯಾಶ್ ಫಲಿತಾಂಶ ಬಳಸುತ್ತದೆ",
  "New screens added later can be re-enriched using the Reset button": "ನಂತರ ಸೇರಿಸಿದ ಹೊಸ ಪರದೆಗಳನ್ನು Reset ಬಟನ್ ಬಳಸಿ ಮತ್ತೆ ಸಮೃದ್ಧಗೊಳಿಸಬಹುದು",
  "Requires": "ಅಗತ್ಯ",
  "GROQ_API_KEY set on the backend server (.env). The key never leaves the server.": "GROQ_API_KEY ಬ್ಯಾಕೆಂಡ್ ಸರ್ವರ್‌ನಲ್ಲಿ (.env) ಹೊಂದಿಸಿ. ಕೀ ಎಂದಿಗೂ ಸರ್ವರ್ ಬಿಡುವುದಿಲ್ಲ.",
  "Connecting to Groq Llama-3.1-70B…": "Groq Llama-3.1-70B ಗೆ ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ…",
  "new translations added and saved to local storage": "ಹೊಸ ಅನುವಾದಗಳನ್ನು ಸೇರಿಸಿ ಲೋಕಲ್ ಸ್ಟೋರೇಜ್‌ಗೆ ಉಳಿಸಲಾಗಿದೆ",
  "Enrichment already applied. All translations loaded from local storage.": "ಸಮೃದ್ಧೀಕರಣ ಈಗಾಗಲೇ ಅನ್ವಯಿಸಲಾಗಿದೆ. ಎಲ್ಲ ಅನುವಾದಗಳನ್ನು ಲೋಕಲ್ ಸ್ಟೋರೇಜ್‌ನಿಂದ ಲೋಡ್ ಮಾಡಲಾಗಿದೆ.",
  "Run Kannada enrichment": "ಕನ್ನಡ ಸಮೃದ್ಧೀಕರಣ ಚಲಾಯಿಸಿ",
  "Reset — allow re-enrichment for new screens": "ರೀಸೆಟ್ — ಹೊಸ ಪರದೆಗಳಿಗೆ ಮತ್ತೆ ಸಮೃದ್ಧೀಕರಣ ಅನುಮತಿಸಿ",
  "Translations are saved to localStorage and merged with the built-in DICT on every page load. They are never sent anywhere except the backend /settings/translate endpoint.": "ಅನುವಾದಗಳನ್ನು localStorage ಗೆ ಉಳಿಸಲಾಗುತ್ತದೆ ಮತ್ತು ಪ್ರತಿ ಪೇಜ್ ಲೋಡ್‌ನಲ್ಲಿ ಅಂತರ್ನಿರ್ಮಿತ DICT ಜೊತೆ ವಿಲೀನಗೊಳ್ಳುತ್ತವೆ.",

  // ── Dossier screen ────────────────────────────────────────────────────────
  "Search name / district…": "ಹೆಸರು / ಜಿಲ್ಲೆ ಹುಡುಕಿ…",
  "Select a person from the list": "ಪಟ್ಟಿಯಿಂದ ಒಬ್ಬ ವ್ಯಕ್ತಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ",
  "Demo data — fictional only": "ಡೆಮೋ ಡೇಟಾ — ಕಾಲ್ಪನಿಕ ಮಾತ್ರ",
  "Admin access required": "ನಿರ್ವಾಹಕ ಪ್ರವೇಶ ಅಗತ್ಯ",
  "DEMO — fictional": "DEMO — ಕಾಲ್ಪನಿಕ",
  "Also known as": "ಇತರ ಹೆಸರುಗಳು",
  "Front": "ಮುಂಭಾಗ",
  "Left Profile": "ಎಡ ಪ್ರೊಫೈಲ್",
  "Right Profile": "ಬಲ ಪ್ರೊಫೈಲ್",
  "Personal & Physical": "ವೈಯಕ್ತಿಕ ಮತ್ತು ದೈಹಿಕ",
  "Contact Details": "ಸಂಪರ್ಕ ವಿವರಗಳು",
  "Gender": "ಲಿಂಗ",
  "Date of Birth": "ಜನ್ಮ ದಿನಾಂಕ",
  "Height": "ಎತ್ತರ",
  "Build": "ದೇಹ ರಚನೆ",
  "Complexion": "ಮೈಬಣ್ಣ",
  "Blood Group": "ರಕ್ತ ಗುಂಪು",
  "Nationality": "ರಾಷ್ಟ್ರೀಯತೆ",
  "Identifying Marks": "ಗುರುತಿನ ಚಿಹ್ನೆಗಳು",
  "Primary Phone": "ಪ್ರಾಥಮಿಕ ಫೋನ್",
  "Secondary Phone": "ಮಾಧ್ಯಮಿಕ ಫೋನ್",
  "Home Address": "ಮನೆ ವಿಳಾಸ",
  "Bank Accounts": "ಬ್ಯಾಂಕ್ ಖಾತೆಗಳು",
  "accounts": "ಖಾತೆಗಳು",
  "Bank": "ಬ್ಯಾಂಕ್",
  "Account No.": "ಖಾತೆ ಸಂಖ್ಯೆ",
  "Type": "ವಿಧ",
  "Balance": "ಬಾಕಿ",
  "Flag": "ಫ್ಲ್ಯಾಗ್",
  "records": "ದಾಖಲೆಗಳು",
  "open": "ತೆರೆದ",
  "Family Members": "ಕುಟುಂಬ ಸದಸ್ಯರು",
  "Known Associates / Contacts": "ಪರಿಚಿತ ಆರೋಪಿಗಳು / ಸಂಪರ್ಕಗಳು",
  "No records.": "ಯಾವುದೇ ದಾಖಲೆಗಳಿಲ್ಲ.",
  "Print / Export PDF": "PDF ಮುದ್ರಿಸಿ / ರಫ್ತು",
  "Sentence": "ಶಿಕ್ಷೆ",
  "years": "ವರ್ಷಗಳು",
  "Person 360": "ವ್ಯಕ್ತಿ 360",

  // ── Map / Ops legend ──────────────────────────────────────────────────────
  "Crime density": "ಅಪರಾಧ ಸಾಂದ್ರತೆ",
  "Incident": "ಘಟನೆ",
  "Corridor": "ಕಾರಿಡಾರ್",
  "Signal": "ಸಂಕೇತ",
  "Heatmap": "ಹೀಟ್‌ಮ್ಯಾಪ್",
  "Routes": "ಮಾರ್ಗಗಳು",
  "DEMO": "ಡೆಮೋ",
  "GREEN CORRIDOR ACTIVE": "ಹಸಿರು ಕಾರಿಡಾರ್ ಸಕ್ರಿಯ",
  "signals": "ಸಂಕೇತಗಳು",
  "Heatmap shows real crime density from the case dataset. Patrols, scenes and green corridors appear here live once Response Ops is running.":
    "ಹೀಟ್‌ಮ್ಯಾಪ್ ಪ್ರಕರಣ ಡೇಟಾಸೆಟ್‌ನಿಂದ ನಿಜ ಅಪರಾಧ ಸಾಂದ್ರತೆ ತೋರಿಸುತ್ತದೆ. Response Ops ಚಾಲನೆಯಾದ ನಂತರ ಗಸ್ತು, ದೃಶ್ಯಗಳು ಮತ್ತು ಹಸಿರು ಕಾರಿಡಾರ್‌ಗಳು ಲೈವ್ ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತವೆ.",

  "Reset all cached translations": "ಎಲ್ಲ ಸಂಗ್ರಹಿಸಿದ ಅನುವಾದಗಳನ್ನು ರೀಸೆಟ್ ಮಾಡಿ",
  "Camera": "ಕ್ಯಾಮೆರಾ",
  "Live Ops": "ಲೈವ್ ಕಾರ್ಯಾಚರಣೆ",
  "Dispatch": "ರವಾನೆ",
  "Predictive": "ಭವಿಷ್ಯಸೂಚಕ",
  "Trends": "ಪ್ರವೃತ್ತಿಗಳು",
  "Forecast": "ಮುನ್ಸೂಚನೆ",
  "Socio": "ಸಾಮಾಜಿಕ",
  "About": "ಬಗ್ಗೆ",
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string };
const I18nCtx = createContext<Ctx>({ lang: "EN", setLang: () => {}, t: (s) => s });

// ── Static manifest of ALL strings known to need translation ─────────────
// Generated from `select-string -pattern 't\("([^"]+)"\)'` across all source files.
// This is the ground truth — enrichDictWithLLM sends these to Groq so the
// button works on first click without requiring any pre-browsing.
const ALL_TRANSLATABLE: string[] = [
  "Access your forensics workspace","Accused","Acquiring signal…","Action",
  "Add a workspace account to start switching between identities.",
  "Add an account","Add another account","Admin access required","Age",
  "AI builds the scene — use tldraw tools to edit anything.",
  "AI detection · human confirmation · incident filing","AI Digital Forensics","All",
  "Apply","Ask Satyam… (EN or ಕನ್ನಡ)","Audit","Back to home","Browse offenders…",
  "Browser","Build","Building Network Graph…","Camera","Camera Review",
  "Camera unavailable — check browser permissions.","Cancel deletion",
  "Cannot remove the only account","Capture","Case","Chain-of-Custody",
  "Change photo","Citations","Clear","Cleared","Close","Cloud · fastest",
  "Cluster","clusters","Community","Compliance",
  "Confidential · Karnataka State Police · Synthetic data only",
  "Confirm account deletion","Confirm data export",
  "Connecting to Groq Llama-3.1-70B…","Connections","Console","Conversation",
  "Conversation mode · just talk, the agent replies and listens again.",
  "Conversations","Copied","Copy","Could not load profile.",
  "Could not load your linked accounts. Check your connection and try again.",
  "Couldn't load accounts","Count","Crime × Period intensity",
  "Crime hotspots forecasting · resource allocation planning",
  "Crime overview · live","Crime type filter…","Crime type…","Custom","Data",
  "Date","Decision support only — not predictive policing.","Default","Delete",
  "Delete my account data","Deletion scheduled","Depth",
  "Describe suspects, evidence, crime scene… (Ctrl+Enter)","Dispatch",
  "Dispatch & Green Corridor",
  "Dispatch patrol units · priority signal corridor · live tracking",
  "Distribution","District","District filter…","District…",
  "Don't have an account?","Download export","e.g. Promoted to SP — district handover",
  "Embedder — RAG semantic search","Enter name or ID…",
  "Enter offender name or ID:","Enter suspect name…","Enter your password",
  "Error","Export","Export my account data","Exporting…","Falling","Features",
  "Fewer","Finalizes on","Finding similar cases…","FIRs","Forecast",
  "Forensically Sound","Forgot password?","From","Fullscreen","Generating…",
  "Google · multimodal · default","GPT-4o · strong reasoning","Granularity","Grid",
  "History","in","Intensity","JSON snapshot",
  "Last sign-in: today, 09:42 from Bengaluru (Chrome · Windows)",
  "Legal code","Linked accounts","Listening…","Live","Live Ops","Loading",
  "Loading accounts…","Loading audit log…","Loading profile…",
  "Loading station data…","Loading timeline…","Loading workspace…","Loading…",
  "low → high","Lowest latency · live captions","Manage accounts","Map","max",
  "Models","Motives","Narrative","Network","New",
  "No accounts linked yet","No linked cases found for this node.","No selection",
  "Nodes, edges, metadata","Note","of","Overview","Password","Patrol","Pause",
  "PDF, image, CSV — max ~5 MB","Period","Person","Person 360","PNG image",
  "Predictive","Preparing…","Profile & settings","Protect your account",
  "PS3 · MO Clustering","PS4 · SP+ access","PS5 · Offender Profile",
  "PS8 · Predictive Intelligence","QoQ Trend","Quick add — Top Stations","Rate",
  "Read-only · No edit controls exposed","Refresh","Remember me","Remove",
  "Remove account","Remove account?","Remove from switcher","Remove photo",
  "Removing…","Rendered graph snapshot","Reports",
  "Reranker — cross-encoder scoring",
  "Reset — allow re-enrichment for new screens",
  "Restricted — L4 clearance required","Result","Resume","Retake","Rings",
  "Rising","risk","Role","Runs only once — uses cached result on every subsequent visit",
  "Save","Save current as preset…","Saved","Schedule deletion (7 days)",
  "Scheduling…","Score","Search",
  "Search and add person, FIR, crime type…",
  "Search by name, email, rank or creator…","Search FIR / crime type…",
  "Search person, FIR number, crime type…","Search police station…",
  "Search user, query, result…","Searching…","Seasonal","Sections","Secure Login",
  "Seed Entity Link Graph","Selection",
  "Server rejected the request. Please retry.","Settings","Showing",
  "Sign in to your account","Sign out","Signing in…","Sources","Speaking…",
  "Speaking… (mic paused)","Stable","Standing by…","Station","Status","Stop",
  "Switch account","Switch account?","Take me to map","Tap textarea to edit",
  "Tap the mic to stop & send, or wait for silence.","Tap to stop & send",
  "Template","Thinking…",
  "This account will be removed from the switcher.",
  "This browser has no speech recognition. Use Chrome or Edge.",
  "Time","Tip: Shift-click nodes to add to selection","To","Today",
  "Top District","Total","Transcripts","Trend","Trends","Try again",
  "Type DELETE to confirm","Update profile photo","User","Verifying…","Victims",
  "View SQL / sources →","Voice","Voice input","Waiting for speech…",
  "Welcome back, Investigator.","Workspace ready","Yesterday",
  "Your account will be permanently deleted in",
];
const LLM_CACHE_KEY = "satyam.translation.llm-cache";

/** Load any LLM-generated translations cached in localStorage and merge them
 *  into the runtime dict. Called once on provider mount. */
function loadLLMCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LLM_CACHE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {}
  return {};
}

/** Call the backend /settings/translate endpoint which uses Groq Llama-3.1-70B
 *  to translate all DICT keys that currently fall back to English.
 *
 *  Strategy: we use a tracking proxy — render a fake KN pass over every known
 *  DICT key AND collect any string seen by t() that had no translation.
 *  All untranslated strings (returned as-is) are sent to Groq in batches.
 */
export async function enrichDictWithLLM(
  onProgress?: (msg: string, count: number, total: number) => void,
): Promise<number> {
  const { API_BASE, getAuthToken } = await import("@/lib/api/client");
  const token = getAuthToken() ?? "";

  // Collect strings that have NO Kannada translation:
  // 1. Every key in DICT that maps to itself (shouldn't happen, but covers edge cases)
  // 2. Strings collected via the runtime miss tracker (populated during normal use)
  const missedKey = "satyam.translation.misses";
  let runtimeMisses: string[] = [];
  try {
    const raw = localStorage.getItem(missedKey);
    if (raw) runtimeMisses = JSON.parse(raw) as string[];
  } catch {}

  // Combine: static manifest + runtime misses — everything needing translation
  // Filter to only strings not already in DICT with a real Kannada value
  const selfHits = Object.keys(DICT).filter((k) => DICT[k] === k);
  const allMissing = Array.from(new Set([...ALL_TRANSLATABLE, ...selfHits, ...runtimeMisses]))
    .filter((s) => {
      if (!s || s.trim().length <= 1) return false;
      // Skip if already in DICT with a real Kannada translation
      const existing = DICT[s];
      if (existing && existing !== s && /[\u0C80-\u0CFF]/.test(existing)) return false;
      // Skip pure numbers / symbols
      if (/^[\d\s.%,:/()[\]{}#@!?]+$/.test(s)) return false;
      // Skip strings already in Kannada
      if (/[\u0C80-\u0CFF]/.test(s)) return false;
      return true;
    });

  if (allMissing.length === 0) {
    onProgress?.(`All ${ALL_TRANSLATABLE.length} strings are already translated — nothing to enrich.`, 0, 0);
    try { localStorage.removeItem(missedKey); } catch {}
    return 0;
  }

  const total = ALL_TRANSLATABLE.length + selfHits.length + runtimeMisses.length;
  onProgress?.(`Translating ${allMissing.length} UI strings…`, 0, allMissing.length);

  const BATCH = 20;
  const allNew: Record<string, string> = {};
  let added = 0;

  for (let i = 0; i < allMissing.length; i += BATCH) {
    const batch = allMissing.slice(i, i + BATCH);
    onProgress?.(
      `UI strings: batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allMissing.length / BATCH)} · ${added} done`,
      added,
      allMissing.length,
    );

    try {
      const res = await fetch(`${API_BASE}/settings/translate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ strings: batch }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Backend returned ${res.status}: ${detail}`);
      }

      const data: { translations: Record<string, string> } = await res.json();
      for (const [k, v] of Object.entries(data.translations)) {
        if (v && v !== k && /[\u0C80-\u0CFF]/.test(v)) {
          // Valid Kannada translation — apply immediately to live DICT
          DICT[k] = v;
          allNew[k] = v;
          added++;
        }
      }
    } catch (err) {
      console.warn("[i18n] enrichDictWithLLM batch failed:", err);
      // Continue with remaining batches — partial enrichment is still useful
    }
  }

  // Persist to localStorage so subsequent page loads use these translations
  try {
    const existing = loadLLMCache();
    localStorage.setItem(LLM_CACHE_KEY, JSON.stringify({ ...existing, ...allNew }));
    // Clear miss tracker — everything has been processed
    localStorage.removeItem(missedKey);
  } catch {}

  onProgress?.(`UI strings done — ${added} translated.`, added, allMissing.length);
  return added;
}

/** Translate synthetic dataset values (station names, districts, crime types, statuses)
 *  via Groq Llama-3.1-70B and cache them in localStorage for tData() to use.
 */
export async function enrichDataWithLLM(
  onProgress?: (msg: string, count: number, total: number) => void,
): Promise<number> {
  const { API_BASE, getAuthToken } = await import("@/lib/api/client");
  const token = getAuthToken() ?? "";

  // Fetch unique data values from the DB
  onProgress?.("Fetching unique data values from database…", 0, 1);
  let dataValues: {
    station_names: string[];
    districts: string[];
    crime_types: string[];
    statuses: string[];
  };
  try {
    const r = await fetch(`${API_BASE}/settings/data-values`, {
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    dataValues = await r.json();
  } catch (err) {
    onProgress?.(`Could not fetch data values: ${err}. Skipping data translation.`, 0, 0);
    return 0;
  }

  // Import setDataTranslations at runtime to avoid circular dependency
  const { setDataTranslations } = await import("@/lib/tData");

  const SYSTEM = `You are translating Karnataka State Police database values to formal Kannada (ಕನ್ನಡ).
Rules:
1. Keep "PS", "Police Station" abbreviations in English within names
2. Keep district names in Kannada script (they are Karnataka place names)
3. Station names: translate descriptive parts to Kannada, keep "PS" suffix
4. Return ONLY valid JSON {"english": "ಕನ್ನಡ", ...}
5. No markdown, no explanation`;

  const BATCH = 20;
  let total = 0;

  // Translate each field type
  const fieldGroups: [string, string[], string][] = [
    ["station", dataValues.station_names,
      "Translate these Karnataka police station names to Kannada. Keep 'PS' suffix in English."],
    ["district", dataValues.districts,
      "Translate these Karnataka district names to Kannada script."],
    ["crime_type", dataValues.crime_types,
      "Translate these crime type names to Kannada. Use official police terminology."],
    ["status", dataValues.statuses,
      "Translate these case status values to Kannada."],
  ];

  for (const [field, values, hint] of fieldGroups) {
    if (!values.length) continue;
    const fieldTotal = values.length;
    onProgress?.(`Translating ${fieldTotal} ${field} values…`, total, total + fieldTotal);

    for (let i = 0; i < values.length; i += BATCH) {
      const batch = values.slice(i, i + BATCH);
      onProgress?.(
        `${field}: batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(values.length / BATCH)} · ${total} done`,
        total,
        total + fieldTotal,
      );

      try {
        const r = await fetch(`${API_BASE}/settings/translate`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            strings: batch,
            system_hint: hint,
          }),
        });
        if (!r.ok) continue;
        const data: { translations: Record<string, string> } = await r.json();
        const valid: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.translations)) {
          if (v && v !== k && v.trim()) {
            valid[k] = v;
            total++;
          }
        }
        if (Object.keys(valid).length > 0) {
          setDataTranslations(field, valid);
        }
      } catch { /* continue with next batch */ }
    }
  }

  onProgress?.(`Data values done — ${total} translated.`, total, total);
  return total;
}

/** Track strings that t() returned unchanged (no translation found). */
function trackMiss(s: string): void {
  if (typeof window === "undefined" || !s || s.length <= 1) return;
  // Skip strings that look like they shouldn't be translated
  if (/^[\d\s.%,:/()[\]{}#@!?]+$/.test(s)) return;
  if (/[\u0C80-\u0CFF]/.test(s)) return; // already Kannada
  try {
    const key = "satyam.translation.misses";
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(s)) {
      existing.push(s);
      // Cap at 500 to avoid storage bloat
      localStorage.setItem(key, JSON.stringify(existing.slice(-500)));
    }
  } catch {}
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("EN");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fq-lang") as Lang | null;
      if (saved === "EN" || saved === "KN") setLangState(saved);
    } catch {}

    // Merge any previously-enriched LLM translations into the live DICT
    const cached = loadLLMCache();
    for (const [k, v] of Object.entries(cached)) {
      if (v && v !== k) DICT[k] = v;
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("fq-lang", l);
    } catch {}
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "KN" ? "kn" : "en";
    }
  };

  const t = (s: string) => {
    if (lang !== "KN") return s;
    const translation = DICT[s];
    if (translation !== undefined) return translation;
    // Track this as a miss so enrichDictWithLLM can find and translate it later
    trackMiss(s);
    return s;
  };

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;