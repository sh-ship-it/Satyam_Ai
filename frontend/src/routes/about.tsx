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
    { n: "01", t: "Ingest", Icon: Upload, tone: "primary",
      d: "Upload disk images, mobile dumps, cloud exports, and case files into a single evidence vault." },
    { n: "02", t: "Hash & Custody", Icon: Fingerprint, tone: "accent",
      d: "SHA-256 fingerprint every artifact; sign a chain-of-custody entry with timestamp and investigator identity." },
    { n: "03", t: "AI Triage", Icon: Sparkles, tone: "primary",
      d: "Classify, deduplicate, and rank artifacts by investigative relevance using on-demand AI models." },
    { n: "04", t: "Entity Extraction", Icon: Users, tone: "accent",
      d: "Pull people, accounts, devices, locations, transactions, and communication threads from raw data." },
    { n: "05", t: "Link & Geo Analysis", Icon: Network, tone: "primary",
      d: "Build interactive network graphs and plot movements on a tactical heatmap with a time-slider." },
    { n: "06", t: "Investigator Review", Icon: MessageSquare, tone: "accent",
      d: "Voice + chat console, multi-user task boards, structured peer review, and redaction workflows." },
    { n: "07", t: "Court-Ready Report", Icon: FileText, tone: "primary",
      d: "Generate signed, exhibit-numbered PDFs with full provenance, timeline, and citations." },
  ];

  const stack = [
    { cat: "Frontend", Icon: Code2,
      items: ["React 19", "TanStack Start", "TanStack Router", "Vite 7", "TypeScript", "Tailwind CSS v4"] },
    { cat: "UI & Visualization", Icon: Palette,
      items: ["shadcn/ui", "Lucide Icons", "Leaflet + heatmap", "Neo-brutalist system"] },
    { cat: "Backend & Data", Icon: Database,
      items: ["PostgreSQL 16 + pgvector", "Row-Level Security", "Server Functions (RPC)", "FastAPI (Python)"] },
    { cat: "AI & Intelligence", Icon: Brain,
      items: ["Gemini 2.5 Flash (API lane)", "Bhashini + Groq (fallback)", "Web Speech (STT + TTS)", "Multilingual EN / KN"] },
    { cat: "Security & Auth", Icon: Lock,
      items: ["OIDC + JWT", "Role-based access", "Tamper-evident logs", "SHA-256 hashing"] },
    { cat: "DevOps", Icon: Wrench,
      items: ["Bun runtime", "ESLint + Prettier", "CI build verification", "Zoho Catalyst deploy"] },
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
              End-to-end flow from raw evidence to court-ready exhibit. Click any step to expand details.
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
                {i < pipeline.length - 1 && (
                  <div className="h-0.5 w-6 bg-foreground/40" />
                )}
              </div>
            ))}
          </div>
        </NB>
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
            const tone = i % 2 === 0 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground";
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
