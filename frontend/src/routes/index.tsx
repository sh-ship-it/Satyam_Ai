import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useEffect } from "react";
import {
  ArrowRight,
  ChevronDown,
  Shield,
  Palette,
  Play,
  CheckCircle2,
  Fingerprint,
  Search,
  Zap,
  ShieldCheck,
  Users,
  Globe,
  Quote,
  Clock,
  Sparkles,
  Network,
  MapPin,
  FileText,
} from "lucide-react";

import { GridBg, Header, Footer, NB } from "@/components/LandingShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Satyam — AI-Powered Digital Forensics Platform" },
      {
        name: "description",
        content:
          "Investigate cases faster with AI-assisted evidence triage, network link analysis, geospatial mapping, and court-ready forensic reporting.",
      },
      { property: "og:title", content: "Satyam — AI-Powered Digital Forensics Platform" },
      {
        property: "og:description",
        content:
          "Evidence triage, link analysis, geospatial intelligence, and tamper-evident reporting for modern investigators.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <GridBg />
      <Header />
      <Hero />
      <Stats />
      <Features />
      <Testimonials />
      <Footer />
    </div>
  );
}

function Hero() {
  const blobRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      if (blobRef.current) {
        blobRef.current.style.transform = `translateY(${window.scrollY * 0.25}px)`;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="relative overflow-hidden border-b-2 border-foreground bg-background min-h-screen">
      {/* ── Background video ─────────────────────────────────────────── */}
      <video
        className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      {/* ── Overlay to keep text readable over the video ─────────────── */}
      <div className="absolute inset-0 z-0 bg-background/20 pointer-events-none" />

      {/* ── Parallax glow (sits above overlay, below content) ────────── */}
      <div
        ref={blobRef}
        className="pointer-events-none absolute -top-24 -right-24 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-[120px] will-change-transform z-[1]"
        aria-hidden="true"
      />

      {/* ── All hero content — above the video and overlay ───────────── */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-20 pb-24 min-h-screen flex flex-col justify-center">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Left */}
          <div className="animate-fade-in">
            <div
              className="inline-flex animate-fade-in items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground nb-shadow-sm"
              style={{ animationDelay: "0.1s" }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Satyam · AI Investigation Suite
            </div>
            <h1
              className="animate-fade-in mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl"
              style={{ animationDelay: "0.2s" }}
            >
              AI-Powered
              <br />
              Digital Forensics
              <br />
              <span className="bg-primary px-2 text-primary-foreground border-2 border-foreground rounded-[5px] inline-block nb-shadow">
                Platform
              </span>
            </h1>
            <p
              className="animate-fade-in mt-6 max-w-xl text-base leading-relaxed text-foreground/75"
              style={{ animationDelay: "0.3s" }}
            >
              Triage evidence, surface hidden connections across devices and networks, map suspect
              movements, and generate court-ready reports — purpose-built for modern investigators
              and forensic teams.
            </p>

            <div
              className="animate-fade-in mt-8 flex flex-wrap items-center gap-4"
              style={{ animationDelay: "0.4s" }}
            >
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[3px] hover:translate-y-[3px]"
              >
                Launch Investigation <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background px-5 py-3 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px]"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground">
                  <Play className="h-3 w-3 fill-current" />
                </span>
                Watch Demo
              </a>
            </div>

            <div
              className="animate-fade-in mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm font-semibold"
              style={{ animationDelay: "0.5s" }}
            >
              {["Chain-of-Custody", "ISO 27037 Aligned", "Tamper-Evident Logs"].map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5 text-foreground/80">
                  <CheckCircle2 className="h-4 w-4 text-success" /> {b}
                </span>
              ))}
            </div>
          </div>

          {/* Right — investigation mock */}
          <div className="relative animate-fade-in" style={{ animationDelay: "0.4s" }}>
            <NB className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-bold">Active Case · CR-2026-0418</div>
                <span className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-bold nb-shadow-sm">
                  Live Demo
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-[5px] border-2 border-foreground bg-success/15 px-3 py-2.5 nb-shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-success ring-2 ring-foreground" />
                    <span className="text-sm font-bold">Disk Image Triage Complete</span>
                  </div>
                  <span className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-bold text-success">
                    1,284 Artifacts
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-[5px] border-2 border-foreground bg-primary/15 px-3 py-2.5 nb-shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-foreground" />
                    <span className="text-sm font-bold">Network Link Analysis</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-bold">
                    <Clock className="h-3 w-3" /> 1m 42s
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat label="Entities" value="312" valueClass="text-primary" />
                <MiniStat label="Hot Leads" value="14" valueClass="text-success" />
                <MiniStat label="Open Tasks" value="6" valueClass="text-accent-foreground" />
              </div>
            </NB>

            <span className="absolute -top-3 right-6 inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold nb-shadow-sm">
              <Fingerprint className="h-3.5 w-3.5 text-primary" /> Evidence Verified
            </span>
            <span className="absolute -bottom-3 left-6 inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[11px] font-bold nb-shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5 text-success" /> Chain-of-Custody Intact
            </span>
          </div>
        </div>

        {/* ── Scroll-down hint ─────────────────────────────────────────── */}
        <div className="mt-12 flex justify-center animate-bounce">
          <div className="flex flex-col items-center gap-1 opacity-60">
            <span className="text-[10px] font-bold uppercase tracking-widest">Scroll</span>
            <ChevronDown className="h-5 w-5" />
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-3 text-center nb-shadow-sm">
      <div className={`text-lg font-extrabold ${valueClass}`}>{value}</div>
      <div className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Stats() {
  const items = [
    { v: "98.2%", l: "Triage Precision", s: "Across Evidence Types" },
    { v: "4.5M+", l: "Artifacts Processed", s: "Since Launch" },
    { v: "220+", l: "Agencies & Labs", s: "Trust Satyam" },
    { v: "< 3min", l: "Avg. Case Triage", s: "From Ingest to Insight" },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-10">
      <NB className="grid grid-cols-2 divide-foreground md:grid-cols-4 md:divide-x-2">
        {items.map((it, i) => (
          <div
            key={it.v}
            className={`p-6 text-center ${i >= 2 ? "border-t-2 border-foreground md:border-t-0" : ""} ${i === 1 ? "border-t-0 md:border-t-0" : ""}`}
          >
            <div className="text-4xl font-extrabold tracking-tight md:text-5xl">{it.v}</div>
            <div className="mt-1 text-sm font-bold">{it.l}</div>
            <div className="text-xs text-foreground/60">{it.s}</div>
          </div>
        ))}
      </NB>
    </section>
  );
}

function Features() {
  const items = [
    {
      icon: Search,
      tint: "text-primary",
      title: "AI Evidence Triage",
      body: "Automatically classify, deduplicate, and prioritize artifacts from disk images, mobile dumps, and cloud exports.",
    },
    {
      icon: Network,
      tint: "text-success",
      title: "Link & Network Analysis",
      body: "Surface hidden relationships between people, accounts, devices, and transactions on an interactive graph.",
    },
    {
      icon: MapPin,
      tint: "text-warning",
      title: "Geospatial Intelligence",
      body: "Plot suspect movements, cell-site data, and incident hotspots on a tactical investigation map.",
    },
    {
      icon: ShieldCheck,
      tint: "text-primary",
      title: "Chain-of-Custody",
      body: "Tamper-evident audit trails, role-based access, and cryptographic hashes on every artifact.",
    },
    {
      icon: Users,
      tint: "text-destructive",
      title: "Multi-Investigator Console",
      body: "Co-investigate in real time with case drawers, task assignment, and structured peer review.",
    },
    {
      icon: FileText,
      tint: "text-primary",
      title: "Court-Ready Reports",
      body: "Generate signed, exhibit-numbered reports with timelines, citations, and full provenance — in minutes.",
    },
  ];

  return (
    <section id="features" className="mx-auto max-w-7xl px-6 py-20">
      <div className="text-center">
        <span className="inline-block rounded-[5px] border-2 border-foreground bg-primary px-3 py-1 text-xs font-bold text-primary-foreground nb-shadow-sm">
          Core Capabilities
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight md:text-5xl">
          Everything you need to
          <br />
          close cases faster
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base text-foreground/70">
          From first ingest to final exhibit, Satyam unifies triage, link analysis, mapping, and
          reporting in one investigator-grade workspace.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, tint, title, body }) => (
          <NB key={title} className="p-6 transition hover:-translate-x-1 hover:-translate-y-1 hover:nb-shadow">
            <div className="grid h-12 w-12 place-items-center rounded-[5px] border-2 border-foreground bg-background nb-shadow-sm">
              <Icon className={`h-6 w-6 ${tint}`} strokeWidth={2.5} />
            </div>
            <h3 className="mt-5 text-xl font-extrabold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/70">{body}</p>
          </NB>
        ))}
      </div>
    </section>
  );
}

function Testimonials() {
  const items = [
    {
      q: "Satyam collapsed a two-week triage into an afternoon. The link graph alone broke our case open.",
      i: "AP",
      n: "Insp. Arjun Patel",
      r: "Cyber Crime Cell, State Police",
    },
    {
      q: "Chain-of-custody and tamper-evident logs gave our prosecution airtight exhibits in court.",
      i: "MR",
      n: "Maria Ramos",
      r: "Lead Digital Forensics Examiner",
    },
    {
      q: "The geospatial view and timeline export are exactly what our investigators needed under deadline.",
      i: "JK",
      n: "Dir. Jennifer Kaul",
      r: "Forensics Lab Director",
    },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <div className="text-center">
        <span className="inline-block rounded-[5px] border-2 border-foreground bg-primary px-3 py-1 text-xs font-bold text-primary-foreground nb-shadow-sm">
          Testimonials
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight md:text-5xl">
          Trusted by investigators
          <br />
          and forensic labs
        </h2>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {items.map((t) => (
          <NB key={t.n} className="p-6">
            <Quote className="h-7 w-7" strokeWidth={2.5} />
            <p className="mt-4 text-[15px] leading-relaxed text-foreground/85">"{t.q}"</p>
            <div className="mt-6 flex items-center gap-3 border-t-2 border-foreground pt-4">
              <div className="grid h-11 w-11 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground text-xs font-extrabold nb-shadow-sm">
                {t.i}
              </div>
              <div>
                <div className="text-sm font-extrabold">{t.n}</div>
                <div className="text-xs text-foreground/60">{t.r}</div>
              </div>
            </div>
          </NB>
        ))}
      </div>
    </section>
  );
}
