import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "EN" | "KN";

// English source string -> Kannada translation
const DICT: Record<string, string> = {
  // Banner / shell
  "Synthetic / demo data — not real case records": "ಕೃತಕ / ಡೆಮೋ ಡೇಟಾ — ನಿಜವಾದ ಪ್ರಕರಣ ದಾಖಲೆಗಳಲ್ಲ",
  "KSP Workspace": "ಕೆ.ಎಸ್.ಪಿ ಕಾರ್ಯಸ್ಥಳ",
  "R. Kumar · Inspector": "ಆರ್. ಕುಮಾರ್ · ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  "Voice": "ಧ್ವನಿ",
  "Settings": "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",

  // Nav
  "Console": "ಕನ್ಸೋಲ್",
  "Map": "ನಕ್ಷೆ",
  "Network": "ನೆಟ್‌ವರ್ಕ್",
  "Reports": "ವರದಿಗಳು",
  "Audit": "ಆಡಿಟ್",

  // Console page
  "Conversation": "ಸಂಭಾಷಣೆ",
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
  "Start a new conversation or pick one from history.": "ಹೊಸ ಸಂಭಾಷಣೆಯನ್ನು ಪ್ರಾರಂಭಿಸಿ ಅಥವಾ ಇತಿಹಾಸದಿಂದ ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
  "Today": "ಇಂದು",
  "Yesterday": "ನಿನ್ನೆ",
  "Last week": "ಕಳೆದ ವಾರ",
  "Created": "ರಚಿಸಲಾಗಿದೆ",
  "Results Canvas": "ಫಲಿತಾಂಶ ಕ್ಯಾನ್ವಾಸ್",
  "Thefts · Whitefield zone · last 30 days": "ಕಳ್ಳತನಗಳು · ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ · ಕಳೆದ 30 ದಿನಗಳು",
  "View SQL / sources": "SQL / ಮೂಲಗಳನ್ನು ನೋಡಿ",
  "View SQL / sources →": "SQL / ಮೂಲಗಳನ್ನು ನೋಡಿ →",
  "Expand": "ವಿಸ್ತರಿಸಿ",
  "Total FIRs": "ಒಟ್ಟು ಎಫ್‌ಐಆರ್‌ಗಳು",
  "Avg / day": "ದಿನಕ್ಕೆ ಸರಾಸರಿ",
  "Cleared": "ಪರಿಹಾರ",
  "By Station": "ಠಾಣೆಯ ಪ್ರಕಾರ",
  "142 rows · streaming…": "142 ಸಾಲುಗಳು · ಸ್ಟ್ರೀಮಿಂಗ್…",
  "Station": "ಠಾಣೆ",
  "FIRs": "ಎಫ್‌ಐಆರ್‌ಗಳು",
  "Trend (30d)": "ಪ್ರವೃತ್ತಿ (30 ದಿನ)",
  "Top IPC": "ಪ್ರಮುಖ ಐಪಿಸಿ",
  "Every figure links to its source row. Click a station to drill into FIRs.":
    "ಪ್ರತಿ ಸಂಖ್ಯೆಯು ಅದರ ಮೂಲ ಸಾಲಿಗೆ ಲಿಂಕ್ ಆಗಿದೆ. ಎಫ್‌ಐಆರ್‌ಗಳಿಗೆ ಡ್ರಿಲ್ ಮಾಡಲು ಠಾಣೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.",

  // Map page
  "Filters": "ಫಿಲ್ಟರ್‌ಗಳು",
  "Hide": "ಮರೆಮಾಡಿ",
  "Crime type": "ಅಪರಾಧ ಪ್ರಕಾರ",
  "Theft": "ಕಳ್ಳತನ",
  "Burglary": "ಮನೆಗಳ್ಳತನ",
  "Assault": "ಹಲ್ಲೆ",
  "Cyber fraud": "ಸೈಬರ್ ವಂಚನೆ",
  "Narcotics": "ಮಾದಕ ದ್ರವ್ಯ",
  "Date range": "ದಿನಾಂಕ ವ್ಯಾಪ್ತಿ",
  "District / Zone": "ಜಿಲ್ಲೆ / ವಲಯ",
  "Offender": "ಅಪರಾಧಿ",
  "Search by ID / alias": "ಐಡಿ / ಅಲಿಯಾಸ್ ಮೂಲಕ ಹುಡುಕಿ",
  "By crime type": "ಅಪರಾಧ ಪ್ರಕಾರದಿಂದ",
  "By offender": "ಅಪರಾಧಿಯಿಂದ",
  "heat": "ಹೀಟ್",
  "pins": "ಪಿನ್‌ಗಳು",
  "grid": "ಗ್ರಿಡ್",
  "Intensity": "ತೀವ್ರತೆ",
  "low → high": "ಕಡಿಮೆ → ಹೆಚ್ಚು",
  "Selected area": "ಆಯ್ದ ಪ್ರದೇಶ",
  "live": "ಲೈವ್",
  "Whitefield zone": "ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯ",
  "Δ 30d": "Δ 30 ದಿನ",
  "Top crimes": "ಪ್ರಮುಖ ಅಪರಾಧಗಳು",
  "7-day trend": "7 ದಿನಗಳ ಪ್ರವೃತ್ತಿ",
  "Ask AI about this area": "ಈ ಪ್ರದೇಶದ ಬಗ್ಗೆ AI ಯನ್ನು ಕೇಳಿ",

  // Network page
  "Seed entity": "ಬೀಜ ಘಟಕ",
  "Depth": "ಆಳ",
  "Edge type": "ಎಡ್ಜ್ ಪ್ರಕಾರ",
  "All": "ಎಲ್ಲಾ",
  "Co-accused": "ಸಹ-ಆರೋಪಿ",
  "Phone": "ಫೋನ್",
  "Vehicle": "ವಾಹನ",
  "Location": "ಸ್ಥಳ",
  "Community": "ಸಮುದಾಯ",
  "Fullscreen": "ಪೂರ್ಣಪರದೆ",
  "Ego-network · seed + 1-hop neighborhood · 9 nodes · 13 edges":
    "ಎಗೋ-ನೆಟ್‌ವರ್ಕ್ · ಬೀಜ + 1-ಹಾಪ್ ನೆರೆಹೊರೆ · 9 ನೋಡ್‌ಗಳು · 13 ಎಡ್ಜ್‌ಗಳು",
  "Node inspector": "ನೋಡ್ ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  "Centrality": "ಕೇಂದ್ರೀಯತೆ",
  "Degree": "ಡಿಗ್ರಿ",
  "Risk": "ಅಪಾಯ",
  "High": "ಅಧಿಕ",
  "Role in network": "ನೆಟ್‌ವರ್ಕ್‌ನಲ್ಲಿ ಪಾತ್ರ",
  "Hub node — appears in 8 FIRs across Whitefield zone. Likely organizer of a vehicle-theft ring (C-01).":
    "ಹಬ್ ನೋಡ್ — ವೈಟ್‌ಫೀಲ್ಡ್ ವಲಯದಲ್ಲಿ 8 ಎಫ್‌ಐಆರ್‌ಗಳಲ್ಲಿ ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ. ವಾಹನ-ಕಳ್ಳತನ ಗ್ಯಾಂಗ್‌ನ (C-01) ಸಂಯೋಜಕ ಆಗಿರಬಹುದು.",
  "Linked cases": "ಲಿಂಕ್ ಮಾಡಿದ ಪ್ರಕರಣಗಳು",
  "Person (C-01)": "ವ್ಯಕ್ತಿ (C-01)",
  "Asset": "ಆಸ್ತಿ",

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
  "Citations": "ಉಲ್ಲೇಖಗಳು",

  // Audit page
  "Compliance": "ಅನುಸರಣೆ",
  "Audit log": "ಆಡಿಟ್ ಲಾಗ್",
  "read-only": "ಓದಲು-ಮಾತ್ರ",
  "Hash-chain integrity": "ಹ್ಯಾಶ್-ಚೈನ್ ಸಮಗ್ರತೆ",
  "VERIFIED · 18,432 entries": "ಪರಿಶೀಲಿಸಲಾಗಿದೆ · 18,432 ನಮೂದುಗಳು",
  "User": "ಬಳಕೆದಾರ",
  "Action": "ಕ್ರಿಯೆ",
  "From": "ಯಿಂದ",
  "To": "ಗೆ",
  "Source table": "ಮೂಲ ಕೋಷ್ಟಕ",
  "Apply": "ಅನ್ವಯಿಸಿ",
  "All users": "ಎಲ್ಲ ಬಳಕೆದಾರರು",
  "Time": "ಸಮಯ",
  "Role": "ಪಾತ್ರ",
  "Query / SQL": "ಪ್ರಶ್ನೆ / SQL",
  "Result": "ಫಲಿತಾಂಶ",
  "Sources": "ಮೂಲಗಳು",
  "Showing 10 of 18,432 entries · Read-only · No edit controls exposed":
    "18,432 ರಲ್ಲಿ 10 ನಮೂದುಗಳನ್ನು ತೋರಿಸಲಾಗಿದೆ · ಓದಲು-ಮಾತ್ರ · ಸಂಪಾದನೆ ನಿಯಂತ್ರಣಗಳಿಲ್ಲ",

  // Login
  "Sign in · Satyam": "ಸೈನ್ ಇನ್ · ಫೋರೆನ್ಸಿಕ್‌ಯು",
  "Crime Intelligence Workspace · KSP": "ಅಪರಾಧ ಗುಪ್ತಚರ ಕಾರ್ಯಸ್ಥಳ · ಕೆಎಸ್‌ಪಿ",
  "Sign in with SSO (OIDC)": "SSO (OIDC) ಮೂಲಕ ಸೈನ್ ಇನ್ ಮಾಡಿ",
  "or": "ಅಥವಾ",
  "Username": "ಬಳಕೆದಾರ ಹೆಸರು",
  "Password": "ಪಾಸ್‌ವರ್ಡ್",
  "MFA code": "MFA ಕೋಡ್",
  "6-digit code": "6-ಅಂಕಿಯ ಕೋಡ್",
  "Sign in": "ಸೈನ್ ಇನ್",
  "Demo mode": "ಡೆಮೋ ಮೋಡ್",
  "Role:": "ಪಾತ್ರ:",
  "Constable": "ಪೇದೆ",
  "Inspector": "ಇನ್ಸ್‌ಪೆಕ್ಟರ್",
  "Admin": "ನಿರ್ವಾಹಕ",
  "Swap roles live to demo access control.": "ಪ್ರವೇಶ ನಿಯಂತ್ರಣ ಡೆಮೋ ಮಾಡಲು ಪಾತ್ರಗಳನ್ನು ಲೈವ್ ಆಗಿ ಬದಲಿಸಿ.",
  "All records shown are synthetic. No real case data is exposed. ·":
    "ತೋರಿಸಲಾದ ಎಲ್ಲ ದಾಖಲೆಗಳು ಕೃತಕವಾಗಿವೆ. ಯಾವುದೇ ನಿಜವಾದ ಪ್ರಕರಣ ಡೇಟಾ ಬಹಿರಂಗವಾಗಿಲ್ಲ. ·",
  "Skip": "ಬಿಟ್ಟುಬಿಡಿ",

  // Case drawer
  "Case": "ಪ್ರಕರಣ",
  "summary": "ಸಾರಾಂಶ",
  "persons": "ವ್ಯಕ್ತಿಗಳು",
  "map": "ನಕ್ಷೆ",
  "Date": "ದಿನಾಂಕ",
  "Status": "ಸ್ಥಿತಿ",
  "Under investigation": "ತನಿಖೆಯಲ್ಲಿದೆ",
  "Theft (Motor vehicle)": "ಕಳ್ಳತನ (ಮೋಟಾರು ವಾಹನ)",
  "14 Aug 2024": "14 ಆಗಸ್ಟ್ 2024",
  "Whitefield PS": "ವೈಟ್‌ಫೀಲ್ಡ್ ಪಿಎಸ್",
  "IPC sections": "ಐಪಿಸಿ ವಿಭಾಗಗಳು",
  "Complainant": "ದೂರುದಾರ",
  "Masked — authorized roles only": "ಮರೆಮಾಡಲಾಗಿದೆ — ಅಧಿಕೃತ ಪಾತ್ರಗಳಿಗೆ ಮಾತ್ರ",
  "Narrative": "ವಿವರಣೆ",
  "Vehicle reported missing from parking lot near ITPL Main Road between 22:30 and 04:00. CCTV footage retrieved. Linked to 2 other theft FIRs in same zone (see Persons tab).":
    "ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ ಬಳಿಯ ಪಾರ್ಕಿಂಗ್ ಸ್ಥಳದಿಂದ 22:30 ರಿಂದ 04:00 ರ ನಡುವೆ ವಾಹನ ಕಾಣೆಯಾಗಿರುವುದು ವರದಿಯಾಗಿದೆ. ಸಿಸಿಟಿವಿ ತುಣುಕು ಪಡೆಯಲಾಗಿದೆ. ಅದೇ ವಲಯದ ಇತರ 2 ಕಳ್ಳತನ ಎಫ್‌ಐಆರ್‌ಗಳಿಗೆ ಲಿಂಕ್ ಮಾಡಲಾಗಿದೆ (ವ್ಯಕ್ತಿಗಳು ಟ್ಯಾಬ್ ನೋಡಿ).",
  "Accused": "ಆರೋಪಿ",
  "Victim": "ಬಲಿಪಶು",
  "Witness": "ಸಾಕ್ಷಿ",
  "Incident location": "ಘಟನೆಯ ಸ್ಥಳ",
  "ITPL Main Road, Whitefield": "ಐಟಿಪಿಎಲ್ ಮುಖ್ಯ ರಸ್ತೆ, ವೈಟ್‌ಫೀಲ್ಡ್",
  "Add to report": "ವರದಿಗೆ ಸೇರಿಸಿ",
  "Export": "ರಫ್ತು",

  // Transcripts
  "Transcripts": "ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "Voice transcripts": "ಧ್ವನಿ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "Saved transcripts": "ಉಳಿಸಿದ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳು",
  "No saved transcripts yet. Use the mic and tap Save to store one.":
    "ಇನ್ನೂ ಯಾವುದೇ ಉಳಿಸಿದ ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್‌ಗಳಿಲ್ಲ. ಮೈಕ್ ಬಳಸಿ ಮತ್ತು ಉಳಿಸಲು Save ಟ್ಯಾಪ್ ಮಾಡಿ.",
  "Save": "ಉಳಿಸಿ",
  "Saved": "ಉಳಿಸಲಾಗಿದೆ",
  "Delete": "ಅಳಿಸಿ",
  "Send to chat": "ಚಾಟ್‌ಗೆ ಕಳುಹಿಸಿ",
  "Speak reply": "ಧ್ವನಿ ಉತ್ತರ",
  "Speech output": "ಧ್ವನಿ ಉತ್ಪಾದನೆ",
  "Rate": "ವೇಗ",
  "Speaking…": "ಮಾತನಾಡುತ್ತಿದೆ…",
  "Tap Pause to pause, Stop to end.": "ವಿರಾಮಕ್ಕೆ ವಿರಾಮ ಟ್ಯಾಪ್ ಮಾಡಿ, ಕೊನೆಗೊಳ್ಳಲು ನಿಲ್ಲಿಸಿ.",
  "Resume": "ಪುನರಾರಂಭಿಸಿ",
  "Pause": "ವಿರಾಮ",
  "Stop speech": "ಮಾತು ನಿಲ್ಲಿಸಿ",
  "Close": "ಮುಚ್ಚಿ",
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string };
const I18nCtx = createContext<Ctx>({ lang: "EN", setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("EN");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fq-lang") as Lang | null;
      if (saved === "EN" || saved === "KN") setLangState(saved);
    } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("fq-lang", l); } catch {}
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "KN" ? "kn" : "en";
    }
  };

  const t = (s: string) => (lang === "KN" ? (DICT[s] ?? s) : s);

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
