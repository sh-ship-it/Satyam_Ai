import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  Upload,
  Fingerprint,
  Sparkles,
  Users,
  Network,
  MessageSquare,
  FileText,
  CornerDownRight,
  Code2,
  Palette,
  Database,
  Brain,
  Lock,
  Wrench,
  Server,
  Languages,
  Cpu,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { useState } from "react";

import { GridBg, NB, Header, Footer } from "@/components/LandingShell";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Satyam AI Digital Forensics" },
      {
        name: "description",
        content:
          "Learn how Satyam works: from evidence ingest to court-ready reports. Explore the pipeline and technology stack.",
      },
      { property: "og:title", content: "About — Satyam AI Digital Forensics" },
      {
        property: "og:description",
        content:
          "End-to-end forensic pipeline and technology stack behind the Satyam investigation platform.",
      },
      { property: "og:url", content: "/about" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "About — Satyam AI Digital Forensics" },
      {
        name: "twitter:description",
        content:
          "End-to-end forensic pipeline and technology stack behind the Satyam investigation platform.",
      },
    ],
    links: [{ rel: "canonical", href: "/about" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "About — Satyam AI Digital Forensics",
          description:
            "Learn how Satyam works: from evidence ingest to court-ready reports. Explore the pipeline and technology stack.",
          url: "/about",
          isPartOf: {
            "@type": "WebSite",
            name: "Satyam",
            url: "/",
          },
        }),
      },
    ],
  }),
  component: AboutPage,
});

type PipelineStep = {
  n: string;
  t: string;
  d: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: "primary" | "accent";
};

function AboutPage() {
  const pipeline: PipelineStep[] = [
    {
      n: "01",
      t: "Ingest",
      Icon: Upload,
      tone: "primary",
      d: "Upload disk images, mobile dumps, cloud exports, and case files into a single evidence vault.",
    },
    {
      n: "02",
      t: "Hash & Custody",
      Icon: Fingerprint,
      tone: "accent",
      d: "SHA-256 fingerprint every artifact; sign a chain-of-custody entry with timestamp and investigator identity.",
    },
    {
      n: "03",
      t: "AI Triage",
      Icon: Sparkles,
      tone: "primary",
      d: "Classify, deduplicate, and rank artifacts by investigative relevance using on-demand AI models.",
    },
    {
      n: "04",
      t: "Entity Extraction",
      Icon: Users,
      tone: "accent",
      d: "Pull people, accounts, devices, locations, transactions, and communication threads from raw data.",
    },
    {
      n: "05",
      t: "Link & Geo Analysis",
      Icon: Network,
      tone: "primary",
      d: "Build interactive network graphs and plot movements on a tactical heatmap with a time-slider.",
    },
    {
      n: "06",
      t: "Investigator Review",
      Icon: MessageSquare,
      tone: "accent",
      d: "Voice + chat console, multi-user task boards, structured peer review, and redaction workflows.",
    },
    {
      n: "07",
      t: "Court-Ready Report",
      Icon: FileText,
      tone: "primary",
      d: "Generate signed, exhibit-numbered PDFs with full provenance, timeline, and citations.",
    },
  ];

  const stack = [
    {
      cat: "Frontend Core",
      Icon: Code2,
      items: [
        "React 19",
        "TanStack Start (SSR)",
        "TanStack Router",
        "Vite 7",
        "TypeScript",
        "Bun Runtime",
      ],
    },
    {
      cat: "UI & Visualization",
      Icon: Palette,
      items: [
        "Tailwind CSS v4",
        "React Flow (Canvas)",
        "Leaflet Maps",
        "Leaflet.heat (Hotspots)",
        "Lucide Icons",
        "Neo-Brutalist System",
      ],
    },
    {
      cat: "Backend & Server",
      Icon: Server,
      items: [
        "Python 3.11+",
        "FastAPI (Async)",
        "Uvicorn (ASGI)",
        "SQLAlchemy ORM",
        "asyncpg (Driver)",
        "Pydantic v2 Schemas",
        "httpx (Async Client)",
        "structlog",
      ],
    },
    {
      cat: "Database & Cache",
      Icon: Layers,
      items: [
        "PostgreSQL 16/17",
        "pgvector (halfvec/vector)",
        "Redis Session Cache",
        "Redis PubSub Locks",
        "SQLGlot Parser Guard",
        "Postgres Advisory Locks",
      ],
    },
    {
      cat: "AI Models & Engines",
      Icon: Cpu,
      items: [
        "Gemini 2.5 Flash",
        "OpenAI ChatGPT",
        "Groq Llama-3.3-70B",
        "Ollama Cloud (Qwen)",
        "Local BGE-M3 (FP16)",
        "bge-reranker-v2-m3",
        "YOLOv8s Weapon Detect",
        "sentence-transformers",
        "FlagEmbedding",
      ],
    },
    {
      cat: "Voice & Language",
      Icon: Languages,
      items: [
        "Sarvam Bulbul v3 (TTS)",
        "Sarvam Saaras v3 (STT)",
        "Sarvam Mayura v1 (MT)",
        "Bhashini API (Govt)",
        "Browser Web Speech API",
      ],
    },
    {
      cat: "Security & Integrity",
      Icon: ShieldCheck,
      items: [
        "SHA-256 Hash-Chaining",
        "Tamper-Evident Audit",
        "4-Tier PII Masking (L1-L4)",
        "Row-Level Security (RLS)",
        "PyJWT Auth Tokens",
        "KSP Rank RBAC/ABAC",
      ],
    },
    {
      cat: "DevOps & Infra",
      Icon: Wrench,
      items: [
        "Docker & Compose",
        "Zoho Catalyst Deploy",
        "OpenCV Image Processing",
        "ESLint & Prettier",
        "CI Build Verification",
      ],
    },
  ];

  const [openStep, setOpenStep] = useState<string | null>("01");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <GridBg />
      <Header />

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground nb-shadow-sm">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
            About Satyam
          </div>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
            Built for investigators,
            <br />
            <span className="mt-2 inline-block rounded-[5px] border-2 border-foreground bg-primary px-2 text-primary-foreground nb-shadow">
              engineered for evidence
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-foreground/75">
            Satyam unifies AI triage, link analysis, geospatial intelligence, and tamper-evident
            reporting on a modern edge-native stack — multilingual, voice-enabled, and built to keep
            investigators in control of their case.
          </p>
        </div>
      </section>

      {/* Pipeline */}
      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider nb-shadow-sm">
              Workflow
            </div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
              Working Pipeline
            </h2>
            <p className="mt-2 max-w-xl text-sm text-foreground/70">
              End-to-end flow from raw evidence to court-ready exhibit. Click any step to expand
              details.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-foreground/70">
            <span className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-foreground" />
            7 stages
            <span className="mx-2 h-3 w-px bg-foreground/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-foreground" />
            Auditable end-to-end
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {pipeline.map((step, i) => {
            const isOpen = openStep === step.n;
            const Icon = step.Icon;
            const badgeBg =
              step.tone === "primary"
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-accent-foreground";
            return (
              <NB
                key={step.n}
                className={`group relative overflow-hidden p-5 transition ${
                  isOpen ? "translate-x-[2px] translate-y-[2px]" : ""
                }`}
              >
                {/* corner step number */}
                <div className="absolute -right-3 -top-3 select-none text-7xl font-black leading-none text-foreground/[0.06]">
                  {step.n}
                </div>

                <div className="flex items-start gap-3">
                  <div
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-[5px] border-2 border-foreground ${badgeBg} nb-shadow-sm`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-[4px] border-2 border-foreground bg-background px-1.5 py-0.5 text-[10px] font-extrabold">
                        STEP {step.n}
                      </span>
                      {i < pipeline.length - 1 && (
                        <span className="hidden items-center gap-1 text-[10px] font-bold text-foreground/55 md:inline-flex">
                          <CornerDownRight className="h-3 w-3" strokeWidth={2.5} />
                          {pipeline[i + 1].t}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-lg font-extrabold leading-tight tracking-tight">
                      {step.t}
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenStep(isOpen ? null : step.n)}
                  className="mt-4 flex w-full items-center justify-between rounded-[5px] border-2 border-foreground bg-background px-3 py-2 text-xs font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px]"
                  aria-expanded={isOpen}
                >
                  {isOpen ? "Hide details" : "View details"}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    strokeWidth={2.5}
                  />
                </button>

                {isOpen && (
                  <p className="mt-3 rounded-[5px] border-2 border-dashed border-foreground/40 bg-background/60 p-3 text-sm leading-relaxed text-foreground/80">
                    {step.d}
                  </p>
                )}
              </NB>
            );
          })}
        </div>

        {/* horizontal flow strip */}
        <NB className="mt-8 hidden p-4 lg:block">
          <div className="flex items-center gap-2 overflow-x-auto">
            {pipeline.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <button
                  onClick={() => setOpenStep(s.n)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-[5px] border-2 border-foreground px-2.5 py-1.5 text-xs font-extrabold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] ${
                    openStep === s.n
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary-background"
                  }`}
                >
                  <span className="font-black opacity-70">{s.n}</span>
                  {s.t}
                </button>
                {i < pipeline.length - 1 && <div className="h-0.5 w-6 bg-foreground/40" />}
              </div>
            ))}
          </div>
        </NB>
      </section>

      {/* System Architecture & Pipelines */}
      <section className="mx-auto max-w-7xl px-6 pb-14">
        <div>
          <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider nb-shadow-sm">
            Architecture
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            System Architecture & Data Flows
          </h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/70">
            A comprehensive blueprint of the Satyam bilingual voice-enabled forensics platform.
          </p>
        </div>

        {/* System Diagram Grid */}
        <div className="mt-8 grid gap-8 lg:grid-cols-12 items-stretch">
          {/* System Diagram */}
          <NB className="lg:col-span-7 p-6 flex flex-col justify-between">
            <h3 className="text-lg font-extrabold mb-6 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              Bilingual Forensic System Blueprint
            </h3>

            {/* Visual Diagram Representation */}
            <div className="flex flex-col gap-6 items-center">
              {/* Browser Box */}
              <div className="w-full max-w-md rounded-[8px] border-2 border-foreground bg-card p-4 nb-shadow-sm text-center relative group hover:scale-[1.01] transition-all">
                <div className="absolute -top-3 left-4 rounded-[4px] border-2 border-foreground bg-accent px-2 py-0.5 text-[8px] font-extrabold text-accent-foreground uppercase">
                  Client Tier
                </div>
                <h4 className="font-extrabold text-sm mb-2 text-primary">Officer's Browser Workspace</h4>
                <div className="grid grid-cols-3 gap-1.5 text-[9px] font-bold uppercase tracking-wider">
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Console</div>
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Network</div>
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Board</div>
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Forecast</div>
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Dossier</div>
                  <div className="p-1 rounded bg-muted/30 border border-foreground/15">Admin</div>
                </div>
              </div>

              {/* Connecting Arrow */}
              <div className="flex flex-col items-center py-1">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-background border border-foreground/10 px-2.5 py-1 rounded-full nb-shadow-sm">
                  HTTPS / REST / SSE / WebSockets
                </div>
                <svg className="h-8 w-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>

              {/* Backend Box */}
              <div className="w-full max-w-md rounded-[8px] border-2 border-foreground bg-card p-4 nb-shadow-sm text-center relative group hover:scale-[1.01] transition-all">
                <div className="absolute -top-3 left-4 rounded-[4px] border-2 border-foreground bg-primary px-2 py-0.5 text-[8px] font-extrabold text-primary-foreground uppercase">
                  Application Tier
                </div>
                <h4 className="font-extrabold text-sm mb-2 text-[#6dff52]">FastAPI Async Backend</h4>
                <p className="text-[10px] text-muted-foreground mb-3 font-semibold">
                  Intents Router • Progressive NL→SQL • SSE Spoken Summary • RLS Enforcement
                </p>
                <div className="flex gap-2 justify-center text-[8px] font-extrabold uppercase">
                  <span className="px-2 py-1 bg-muted/40 border border-foreground/15 rounded">/chat (SSE)</span>
                  <span className="px-2 py-1 bg-muted/40 border border-foreground/15 rounded">/cases</span>
                  <span className="px-2 py-1 bg-muted/40 border border-foreground/15 rounded">/network</span>
                  <span className="px-2 py-1 bg-muted/40 border border-foreground/15 rounded">/ops</span>
                </div>
              </div>

              {/* Split Arrows */}
              <div className="w-full max-w-md flex justify-between px-16 -my-2">
                <div className="flex flex-col items-center">
                  <svg className="h-8 w-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                <div className="flex flex-col items-center">
                  <svg className="h-8 w-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>

              {/* Bottom Row Boxes */}
              <div className="w-full grid grid-cols-2 gap-4">
                {/* Secure Storage */}
                <div className="rounded-[8px] border-2 border-foreground bg-card p-3 nb-shadow-sm text-center relative group hover:scale-[1.01] transition-all">
                  <div className="absolute -top-3 left-4 rounded-[4px] border-2 border-foreground bg-secondary-background px-1.5 py-0.5 text-[8px] font-extrabold uppercase">
                    Data Tier
                  </div>
                  <h5 className="font-extrabold text-[11px] mb-1.5 text-[#ff9a3a] uppercase tracking-wide">Secure Storage</h5>
                  <ul className="text-[10px] text-muted-foreground font-semibold space-y-1.5 text-left list-disc list-inside">
                    <li>PostgreSQL 16 + pgvector</li>
                    <li>Row-Level Security (RLS)</li>
                    <li>Hash-Chained Audit Log</li>
                    <li>Redis Conversation State</li>
                  </ul>
                </div>

                {/* AI / Model Layer */}
                <div className="rounded-[8px] border-2 border-foreground bg-card p-3 nb-shadow-sm text-center relative group hover:scale-[1.01] transition-all">
                  <div className="absolute -top-3 left-4 rounded-[4px] border-2 border-foreground bg-secondary-background px-1.5 py-0.5 text-[8px] font-extrabold uppercase">
                    Model Tier
                  </div>
                  <h5 className="font-extrabold text-[11px] mb-1.5 text-accent uppercase tracking-wide">AI & Model Engines</h5>
                  <ul className="text-[10px] text-muted-foreground font-semibold space-y-1.5 text-left list-disc list-inside">
                    <li>Gemini 2.5 & Groq Llama</li>
                    <li>Sarvam Bulbul & Saaras</li>
                    <li>Local BGE-M3 Embedder</li>
                    <li>Subprocess YOLOv8s</li>
                  </ul>
                </div>
              </div>
            </div>
          </NB>

          {/* Core Data Pipelines */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Text-to-SQL Pipeline */}
            <NB className="p-5 flex-1 relative overflow-hidden">
              <div className="absolute -right-2 -top-2 select-none text-5xl font-black leading-none text-foreground/[0.04] uppercase">
                SQL
              </div>
              <h4 className="text-sm font-extrabold text-primary flex items-center gap-1.5 mb-3 uppercase tracking-wide">
                <Database className="h-4 w-4" />
                Grounded Text-to-SQL Pipeline
              </h4>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed font-semibold">
                How plain-text English/Kannada questions are translated into secure database queries.
              </p>
              <div className="space-y-3 font-mono text-[9px]">
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-primary">01</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Natural Language Query</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">"Show me vehicle thefts in Mysuru this year"</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-primary">02</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Conversational memory + Broadening</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Merges last 6 turns. If 0 rows return, relax filters (relax=0..3).</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-primary">03</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">sqlglot Security Guard</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Validates single SELECT, restricts to 6-table allow-list, forces auto-LIMIT.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-primary">04</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Row-Level Security (RLS)</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Restricts rows at the PG engine level via GUC session claims.</p>
                  </div>
                </div>
              </div>
            </NB>

            {/* Bilingual Voice Pipeline */}
            <NB className="p-5 flex-1 relative overflow-hidden">
              <div className="absolute -right-2 -top-2 select-none text-5xl font-black leading-none text-foreground/[0.04] uppercase">
                Voice
              </div>
              <h4 className="text-sm font-extrabold text-accent flex items-center gap-1.5 mb-3 uppercase tracking-wide">
                <Brain className="h-4 w-4" />
                Bilingual STT/TTS Pipeline
              </h4>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed font-semibold">
                Bilingual voice processing with automatic language detection and spoken summaries.
              </p>
              <div className="space-y-3 font-mono text-[9px]">
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-accent">01</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Speech Ingest & Transcription</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Capture mic, transcribe via Browser Web Speech or Sarvam Saaras v3.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-accent">02</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Voice Screen Command Router</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Extracts navigation intents (e.g., "open network") or directs query to chat.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-accent">03</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">Spoken Summary Generation</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">LLM outputs a 2-3 sentence [SPEAK] block, or backend builds it from rows.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1.5 rounded border border-foreground/10 bg-muted/10">
                  <span className="font-extrabold text-accent">04</span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-foreground">SSE Stream & Neural Speech</span>
                    <p className="text-[8px] text-muted-foreground font-sans mt-0.5">Streams speak event separate from UI table. Plays via Bulbul v3 TTS.</p>
                  </div>
                </div>
              </div>
            </NB>
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div>
          <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider nb-shadow-sm">
            Under the hood
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Technology Stack
          </h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/70">
            The complete toolset powering the Satyam platform.
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {stack.map((group, i) => {
            const Icon = group.Icon;
            const tone =
              i % 2 === 0
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-accent-foreground";
            return (
              <NB key={group.cat} className="p-5">
                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-10 w-10 place-items-center rounded-[5px] border-2 border-foreground ${tone} nb-shadow-sm`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-base font-extrabold tracking-tight">{group.cat}</h3>
                </div>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {group.items.map((it) => (
                    <li
                      key={it}
                      className="rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1 text-xs font-bold nb-shadow-sm"
                    >
                      {it}
                    </li>
                  ))}
                </ul>
              </NB>
            );
          })}
        </div>
      </section>

      <Footer />
    </div>
  );
}
