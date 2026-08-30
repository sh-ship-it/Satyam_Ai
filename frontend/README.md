# Satyam — Frontend Application

Modern React 19 + TanStack Start/Router frontend for the Satyam Police Crime Intelligence AI workspace. Features real-time voice streaming, conversational intelligence, interactive investigation boards (`tldraw`), crime link networks (`@xyflow/react`), tactical geospatial heatmaps (`Leaflet`), and suspect 360° dossiers.

---

## 🛠️ Tech Stack & Key Libraries

| Area | Library / Tool | Description |
| :--- | :--- | :--- |
| **Framework** | **React 19.2** | Modern component architecture, server actions, optimistic UI |
| **Routing** | **TanStack Router + Start** | File-based typed routing (`src/routes`) |
| **Build & Runtime** | **Vite 8 + Bun** | Ultra-fast HMR and build pipelines |
| **Styling** | **Tailwind CSS v4** | Neobrutalist design tokens, 13 custom themes |
| **Investigation Canvas** | **tldraw v5.1.1** | Freeform design & investigation whiteboard with AI scene generation |
| **Network Graphs** | **@xyflow/react v12** | Interactive multi-hop entity graph for crime rings and money trails |
| **Graph Layouts** | **@dagrejs/dagre + elkjs** | Automated hierarchical and force-directed graph layouts |
| **Geospatial Maps** | **Leaflet + Leaflet.heat** | Crime incident heatmaps, patrol grids, and station bounds |
| **3D & Visuals** | **three 0.160 + cobe 2.0.1** | Interactive WebGL dotted globe (`/ask`) and landing particle brain |
| **Voice & Speech** | **Web Audio API + SSE** | Audio recording, real-time waveform, streaming TTS playback |
| **Internationalization** | **i18next + Custom Parser** | Complete bilingual English ↔ Kannada UI localization |

---

## ⚡ Quick Start

### 1. Prerequisites
- **Bun 1.0+** (Recommended) or **Node.js 18+ / npm**

### 2. Installation
```bash
cd frontend

# Install dependencies using Bun (recommended)
bun install
# Or with npm:
# npm install
```

### 3. Environment Configuration
Create a `.env` file in the `frontend/` directory (or rely on default backend URL):
```bash
cp .env.example .env
```

**Environment Variables:**
```env
# URL pointing to the FastAPI backend
VITE_API_BASE_URL=http://localhost:8000
```

### 4. Start Development Server
```bash
bun run dev
# Or with npm:
# npm run dev
```

- **Frontend App:** [http://localhost:3000](http://localhost:3000)

---

## 🧭 Page Routes & Views

```
src/routes/
├── __root.tsx            # Global Shell, navigation sidebar, voice-router & theme provider
├── index.tsx             # Landing presentation & intelligence portal
├── console.tsx           # Primary Conversational Intelligence Console
├── ask.tsx               # Fullscreen 3D Globe Voice/Text Query Portal
├── board.tsx             # tldraw Investigation Whiteboard & Evidence Canvas
├── dossier.tsx           # Person 360 Suspect Catalog & Risk Explorer
├── profile.$personId.tsx # In-depth Suspect Dossier (3-angle photos, crimes, bank links)
├── network.tsx           # @xyflow Crime Network & Hawala Money Trail Graph
├── map.tsx               # Geospatial Leaflet Crime Heatmap & Station Bounds
├── trends.tsx            # Temporal Crime Analytics & Historical Trends
├── forecast.tsx          # Predictive Crime Forecasts & Seasonal Analytics
├── vision.tsx            # Tactical Vision HUD & Surveillance Map
├── ops-predictive.tsx    # Predictive Patrol Deployment
├── ops-dispatch.tsx      # Emergency Dispatch & Green Corridor Sync
├── ops-camera.tsx        # CCTV Incident & Object Threat Review
├── reports.tsx           # Structured Court-Ready Report Generator
├── documents.tsx         # Bilingual FIR Document Translator & SHA-256 Seal
├── audit.tsx             # Cryptographic SHA-256 Hash-Chained Audit Explorer
├── admin.tsx             # Access Control, Roles & Clearance Management
├── transcripts.tsx       # Audio Logs & Bilingual Call Transcripts
├── news.tsx              # Localized OSINT Crime News Stream
├── login.tsx             # Officer Login & Quick Role Switcher
└── about.tsx             # Interactive 32-Chapter System Architecture Handbook
```

---

## 🎨 Themes & Neobrutalist Design System

Satyam supports **13 switchable themes** accessible from the top navbar:
- **Core Modes:** Dark Terminal (`default`), Light Blueprint, Midnight Cyberpunk, High-Contrast Solar, Tactical Emerald, Amber CRT.
- **Police HUD Accents:** KSP Khaki, Crimson Alert, Sapphire Command, Cyber Violet.

Themes are configured via CSS variables and `data-theme` attributes on `<html>`.

---

## 🧪 Code Quality & Build

```bash
# Check code with ESLint
bun run lint

# Format codebase with Prettier
bun run format

# Production bundle build
bun run build

# Preview production build locally
bun run preview
```
