import { Link } from "@tanstack/react-router";
import { Shield, Palette, Languages } from "lucide-react";
import { ThemePicker } from "./ThemePicker";
import { useI18n } from "@/lib/i18n";

export function NB({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
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
  const { lang, setLang, t } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b-2 border-foreground bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground nb-shadow-sm">
            <Shield className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight">Satyam</div>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[10px] font-bold">
                {t("AI Digital Forensics")}
              </div>
              <span className="text-[10px] font-bold text-foreground/70">
                {t("build by Teen Titans")}
              </span>
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-bold md:flex">
          <Link to="/about" className="hover:underline underline-offset-4">
            {t("About")}
          </Link>
          <a href="#features" className="hover:underline underline-offset-4">
            {t("Features")}
          </a>
          <ThemePicker buttonClass="flex items-center gap-2 text-sm font-bold text-foreground hover:underline underline-offset-4 bg-transparent border-0 p-0 cursor-pointer" />
          <Link to="/login" className="hover:underline underline-offset-4">
            {t("Login")}
          </Link>
          <button
            onClick={() => setLang(lang === "EN" ? "KN" : "EN")}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1.5 text-xs font-bold text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
          >
            <Languages className="h-3.5 w-3.5" />
            <span className={lang === "EN" ? "text-foreground" : "opacity-40"}>EN</span>
            <span className="opacity-30">|</span>
            <span className={`font-kn ${lang === "KN" ? "text-foreground" : "opacity-40"}`}>
              ಕನ್ನಡ
            </span>
          </button>
          {/* → /login, not /console. Every public entry point goes through sign-in,
              so a visitor always lands on the form rather than on a shell that has
              no session and fails its first API call. */}
          <Link
            to="/login"
            className="rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-primary-foreground nb-shadow transition hover:translate-x-[3px] hover:translate-y-[3px]"
          >
            {t("Open Console")}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  const { t } = useI18n();
  return (
    <div>
      <h4 className="text-base font-extrabold">{t(title)}</h4>
      <ul className="mt-4 space-y-3 text-sm">
        {links.map((l) => (
          <li key={l}>
            <a
              href="#"
              className="text-background/75 hover:text-background hover:underline underline-offset-4"
            >
              {t(l)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  const { t } = useI18n();
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
                {t("AI Digital Forensics")}
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-background/70">
            {t(
              "An investigator-grade platform unifying evidence triage, link analysis, geospatial intelligence, and court-ready reporting.",
            )}
          </p>
        </div>

        <FooterCol title="Product" links={product} />
        <FooterCol title="Support" links={support} />
      </div>
      <div className="border-t-2 border-background/20">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-xs text-background/60">
          <span>{t("© 2026 Satyam. All rights reserved.")}</span>
          <span>{t("build by Teen Titans")}</span>
        </div>
      </div>
    </footer>
  );
}
