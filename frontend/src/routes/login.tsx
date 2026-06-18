import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Shield,
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  Eye,
  EyeOff,
  ArrowLeft,
  Activity,
  Fingerprint,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";


export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · Satyam" },
      { name: "description", content: "Secure sign-in to the Satyam digital forensics workspace." },
    ],
  }),
  component: Login,
});

function Login() {
  const t = useT();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Grid background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* Main split layout */}
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-32px)] max-w-7xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:px-12">
        {/* LEFT: Brand */}
        <div className="flex flex-col">
          <div className="mb-8 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-primary-foreground nb-shadow-sm">
              <Activity className="h-7 w-7" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">Satyam</h2>
              <span className="mt-1 inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-0.5 text-[11px] font-bold nb-shadow-sm">
                {t("AI Digital Forensics")}
              </span>
            </div>
          </div>

          <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            {t("Welcome back, Investigator.")}
          </h1>
          <p className="mt-5 max-w-md text-base text-foreground/70 md:text-lg">
            {t("Access your secure forensics workspace and continue transforming evidence into court-ready intelligence.")}
          </p>

          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap gap-8">
            <TrustBadge icon={<ShieldCheck className="h-7 w-7 text-success" strokeWidth={2.5} />} label={t("Chain-of-Custody")} />
            <TrustBadge icon={<Fingerprint className="h-7 w-7 text-primary" strokeWidth={2.5} />} label={t("Forensically Sound")} />
            <TrustBadge icon={<Lock className="h-7 w-7 text-destructive" strokeWidth={2.5} />} label={t("Secure Login")} />
          </div>
        </div>

        {/* RIGHT: Sign-in card */}
        <div className="flex flex-col items-center lg:items-end">
          <div className="w-full max-w-md rounded-[5px] border-2 border-foreground bg-secondary-background p-7 nb-shadow-lg">
            <div className="mb-6 text-center">
              <h3 className="text-2xl font-extrabold tracking-tight">{t("Sign in to your account")}</h3>
              <p className="mt-1 text-sm text-foreground/60">{t("Access your forensics workspace")}</p>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                setLoading(true);
                const data = new FormData(e.currentTarget);
                const email = String(data.get("email") || "").trim();
                const password = String(data.get("password") || "").trim();
                if (!email) { setError(t("Please enter your email address.")); setLoading(false); return; }
                const username = email.includes("@") ? email.split("@")[0] : email;
                try {
                  await api.login(username, password);
                  navigate({ to: "/console" });
                } catch (err: any) {
                  const status = err?.status;
                  const msg = err?.body?.detail || err?.message || "";
                  if (status === 404 || msg.includes("Account not found")) {
                    setError(t("No account found for this email. Please create an account first."));
                  } else if (status === 401 || msg.includes("Invalid password") || msg.includes("Invalid credentials")) {
                    setError(t("Invalid email or password. Please try again."));
                  } else if (msg) {
                    setError(msg);
                  } else {
                    // Backend unreachable — offline demo fallback
                    navigate({ to: "/console" });
                  }
                } finally {
                  setLoading(false);
                }
              }}
              className="space-y-4"
            >
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide">{t("Email address")}</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder={t("your.name@ksp.gov.in")}
                    className="h-11 w-full rounded-[5px] border-2 border-foreground bg-background pl-9 pr-3 text-sm font-medium placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide">{t("Password")}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                  <input
                    type={showPw ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    placeholder={t("Enter your password")}
                    className="h-11 w-full rounded-[5px] border-2 border-foreground bg-background pl-9 pr-10 text-sm font-medium placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
                  />
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] p-1.5 text-foreground/60 hover:text-foreground"
                    aria-label="Toggle password visibility">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember me + Forgot */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <button type="button" onClick={() => setRemember((r) => !r)}
                    className={`grid h-5 w-5 place-items-center rounded-[5px] border-2 border-foreground transition ${remember ? "bg-primary text-primary-foreground" : "bg-background"}`}
                    aria-pressed={remember}>
                    {remember && <span className="text-[12px] font-extrabold leading-none">✓</span>}
                  </button>
                  {t("Remember me")}
                </label>
                <a href="#" className="text-sm font-bold underline-offset-4 hover:underline">{t("Forgot password?")}</a>
              </div>

              {/* Error banner */}
              {error && (
                <div className="rounded-[5px] border-2 border-destructive bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive flex items-start gap-2">
                  <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {error}
                    {error.includes("create an account") && (
                      <> {" "}<button type="button" onClick={() => { setError(null); setShowCreate(true); }}
                        className="underline underline-offset-2 hover:no-underline cursor-pointer">{t("Create account")}</button></>
                    )}
                  </span>
                </div>
              )}

              {/* Sign in button */}
              <button type="submit" disabled={loading}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-primary text-sm font-extrabold uppercase tracking-wide text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:opacity-60 disabled:cursor-not-allowed">
                {loading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : <Shield className="h-4 w-4" />}
                {loading ? t("Signing in…") : t("Sign in")}
              </button>

              {/* SSO */}
              <button type="button" onClick={() => navigate({ to: "/console" })}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none">
                <KeyRound className="h-4 w-4" />
                {t("Sign in with SSO (OIDC)")}
              </button>

              <p className="pt-2 text-center text-sm text-foreground/70">
                {t("Don't have an account?")}{" "}
                <button type="button" onClick={() => { setError(null); setShowCreate(true); }}
                  className="font-bold underline-offset-4 hover:underline cursor-pointer">
                  {t("Create account")}
                </button>
              </p>
            </form>
          </div>

          <Link to="/" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-foreground/70 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t("Back to home")}
          </Link>
        </div>
      </div>

      <CreateAccountDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          navigate({ to: "/console" });
        }}
      />
    </div>
  );
}

function TrustBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid h-12 w-12 place-items-center rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-sm">
        {icon}
      </div>
      <span className="text-xs font-bold">{label}</span>
    </div>
  );
}
