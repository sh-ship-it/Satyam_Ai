import { Link } from "@tanstack/react-router";
import { Shield, Palette } from "lucide-react";

export function NB({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow ${className}`}
    >
      {children}
    </div>
  );
}

export function GridBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundImage:
          "linear-gradient(to right, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
        maskImage: "radial-gradient(ellipse at center, black 60%, transparent 100%)",
      }}
    />
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-foreground bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/landing" className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground nb-shadow-sm">
            <Shield className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight">Satyam</div>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-bold">
                AI Digital Forensics
              </div>
              <span className="text-[10px] font-bold text-foreground/70">build by Teen Titans</span>
            </div>
          </div>

        </Link>

        <nav className="hidden items-center gap-7 text-sm font-bold md:flex">
          <Link to="/about" className="hover:underline underline-offset-4">
            About
          </Link>
          <a href="#features" className="hover:underline underline-offset-4">
            Features
          </a>
          <button className="flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1.5 nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px]">
            <Palette className="h-4 w-4" />
            <span className="h-2 w-2 rounded-full bg-primary" />
            Theme
          </button>
          <Link to="/" className="hover:underline underline-offset-4">
            Login
          </Link>
          <Link
            to="/console"
            className="rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-primary-foreground nb-shadow transition hover:translate-x-[3px] hover:translate-y-[3px]"
          >
            Open Console
          </Link>
        </nav>
      </div>
    </header>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="text-base font-extrabold">{title}</h4>
      <ul className="mt-4 space-y-3 text-sm">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="text-background/75 hover:text-background hover:underline underline-offset-4">
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  const product = ["Console", "Network Graph", "Map", "Reports"];
  const support = ["Help Center", "Contact Us", "Privacy Policy", "Terms of Service"];
  return (
    <footer className="mt-10 border-t-2 border-foreground bg-foreground text-background">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[5px] border-2 border-background bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-lg font-extrabold">Satyam</div>
              <div className="mt-0.5 inline-block rounded-[5px] border-2 border-background bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
                AI Digital Forensics
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-background/70">
            An investigator-grade platform unifying evidence triage, link analysis, geospatial
            intelligence, and court-ready reporting.
          </p>
        </div>

        <FooterCol title="Product" links={product} />
        <FooterCol title="Support" links={support} />
      </div>
      <div className="border-t-2 border-background/20">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-xs text-background/60">
          <span>© 2026 Satyam. All rights reserved.</span>
          <span>build by Teen Titans</span>
        </div>
      </div>

    </footer>
  );
}
