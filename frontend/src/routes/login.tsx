import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Languages,
  Mic,
  Database,
  FileLock2,
  Network,
  Radar,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { GridScan } from "@/components/GridScan";
import { GhostMascot } from "@/components/GhostMascot";
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card";
import { applyStoredTheme, DARK_STORAGE_KEY } from "@/lib/theme";

/**
 * Prefilled demo credentials, so a judge can open the app in one click.
 *
 * ⚠ THESE ARE VISIBLE TO ANYONE. Vite inlines them into the client bundle, and the
 * password field is prefilled on a public page — so this is not a secret, it is a
 * published shared account. That is the intent for the Datathon build, on a database
 * whose contents are entirely synthetic.
 *
 * Overridable by env so it can be switched off without touching this file:
 *   VITE_DEMO_EMAIL=""  VITE_DEMO_PASSWORD=""
 * Set both blank for any deployment carrying real data — that is the single change
 * needed, and the fields then render empty as normal.
 *
 * Verified against the running backend: POST /auth/login with the derived username
 * `test` and password `test` returns 200 with a token. The username is the part of
 * the email before the @, which is why the account is `test`, not `test@gmail.com`.
 */
const DEMO_EMAIL = (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ?? "test@gmail.com";
const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? "test";

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

  // This route renders neither Shell nor LandingShell, so nothing else on it ever
  // applied the saved theme: a direct hit on /login (a bookmark, a session
  // timeout, a hard refresh) came up on the `:root` defaults regardless of what
  // the officer had picked, and only inherited the right palette when reached by
  // client-side navigation from a page that does mount ThemePicker. GridScan reads
  // its colours from these tokens, so it has to happen here.
  useEffect(() => {
    applyStoredTheme(localStorage.getItem(DARK_STORAGE_KEY) === "1");
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Scanning grid background. Colours are left unset so they resolve from the
          live theme tokens — see GridScan. */}
      <GridScan
        sensitivity={0.55}
        lineThickness={1}
        gridScale={0.1}
        scanOpacity={0.4}
        enablePost
        bloomIntensity={0.6}
        chromaticAberration={0.002}
        noiseIntensity={0.01}
      />

      {/* ── Mascot, as a background layer ──────────────────────────────────────
          Between the grid (z-0) and the content (z-10), centred on the viewport
          rather than inside a column, and `pointer-events-none` so it cannot
          intercept a click meant for the form behind — a decorative layer stealing
          the password field's focus would be a genuine defect, not a cosmetic one.

          Height-driven size (`h-[min(78vh,720px)]` with `w-auto`) because the ghost
          is taller than it is wide: sizing by width would let it run past the top and
          bottom of a short window. The cap stops it becoming absurd on a large
          monitor.

          Opacity 25%: the sign-in form has to stay readable on top of it. Raise it if
          you want the ghost more present — it is one number.

          Hidden below `lg`: stacked to one column the form fills the screen, and a
          full-height character behind live text at that size hurts legibility. */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] hidden select-none items-center justify-center opacity-25 lg:flex"
        aria-hidden
      >
        <GhostMascot className="h-[min(78vh,720px)] w-auto [&>svg]:h-full [&>svg]:w-auto" />
      </div>

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
            {t(
              "Access your secure forensics workspace and continue transforming evidence into court-ready intelligence.",
            )}
          </p>

          {/* Trust badges — each floats toward and away from the viewer on its own
              phase. Extra vertical padding so the forward-most position is not
              clipped by the row's bounds. */}
          {/* One badge per shipped capability. `index` picks a float phase from
              BADGE_FLOAT below, and the modulo there means adding a badge never
              needs a matching timing entry. */}
          <TrustBadgeStyles />
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-5 py-3">
            <TrustBadge
              index={0}
              icon={<ShieldCheck className="h-7 w-7 text-success" strokeWidth={2.5} />}
              label={t("Chain-of-Custody")}
            />
            <TrustBadge
              index={1}
              icon={<Fingerprint className="h-7 w-7 text-primary" strokeWidth={2.5} />}
              label={t("Forensically Sound")}
            />
            <TrustBadge
              index={2}
              icon={<Lock className="h-7 w-7 text-destructive" strokeWidth={2.5} />}
              label={t("Secure Login")}
            />
            <TrustBadge
              index={3}
              icon={<Languages className="h-7 w-7 text-primary" strokeWidth={2.5} />}
              label={t("Kannada + English")}
            />
            <TrustBadge
              index={4}
              icon={<Mic className="h-7 w-7 text-success" strokeWidth={2.5} />}
              label={t("Voice Copilot")}
            />
            <TrustBadge
              index={5}
              icon={<Database className="h-7 w-7 text-primary" strokeWidth={2.5} />}
              label={t("Grounded Text-to-SQL")}
            />
            <TrustBadge
              index={6}
              icon={<FileLock2 className="h-7 w-7 text-destructive" strokeWidth={2.5} />}
              label={t("Document Sealing")}
            />
            <TrustBadge
              index={7}
              icon={<Network className="h-7 w-7 text-primary" strokeWidth={2.5} />}
              label={t("Link + Money Trails")}
            />
            <TrustBadge
              index={8}
              icon={<Radar className="h-7 w-7 text-success" strokeWidth={2.5} />}
              label={t("Hotspot Forecasting")}
            />
          </div>
        </div>

        {/* RIGHT: Sign-in card — frosted glass over the mascot and grid behind it.
            The colour classes are overridden on purpose: GlassCard ships
            `text-white` over a 30% wash for a dark photographic hero, and this page
            is light, so the defaults would render the form invisible.
            tailwind-merge keeps the caller's classes, which is what the override is
            for — see the note in components/ui/glass-card.tsx.

            The 2px border and hard shadow stay so the card still belongs to the
            neobrutalist language used everywhere else in the app; only the fill
            becomes translucent. */}
        <div className="flex flex-col items-center lg:items-end">
          <GlassCard
            className={cn(
              "w-full max-w-md gap-0 rounded-[5px] py-7 text-foreground",
              "border-2 border-foreground bg-secondary-background/55 backdrop-blur-xl nb-shadow-lg",
              // A frosted panel with nothing behind it looks like a bug, and
              // `backdrop-filter` is unsupported in a few engines. This keeps a
              // readable surface either way.
              "supports-[not(backdrop-filter:blur(0px))]:bg-secondary-background",
            )}
          >
            <GlassCardHeader className="mb-6 block px-7 text-center">
              <GlassCardTitle className="text-2xl font-extrabold tracking-tight">
                {t("Sign in to your account")}
              </GlassCardTitle>
              <GlassCardDescription className="mt-1 text-sm text-foreground/60">
                {t("Access your forensics workspace")}
              </GlassCardDescription>
            </GlassCardHeader>

            <GlassCardContent className="px-7">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError(null);
                  setLoading(true);
                  const data = new FormData(e.currentTarget);
                  const email = String(data.get("email") || "").trim();
                  const password = String(data.get("password") || "").trim();
                  if (!email) {
                    setError(t("Please enter your email address."));
                    setLoading(false);
                    return;
                  }
                  const username = email.includes("@") ? email.split("@")[0] : email;
                  try {
                    await api.login(username, password);
                    navigate({ to: "/console" });
                  } catch (err: any) {
                    const status = err?.status;
                    const msg = err?.body?.detail || err?.message || "";
                    if (status === 404 || msg.includes("Account not found")) {
                      setError(
                        t("No account found for this email. Please create an account first."),
                      );
                    } else if (
                      status === 401 ||
                      msg.includes("Invalid password") ||
                      msg.includes("Invalid credentials")
                    ) {
                      setError(t("Invalid email or password. Please try again."));
                    } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
                      setError(t("Backend unreachable — check login and API status."));
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
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide">
                    {t("Email address")}
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      defaultValue={DEMO_EMAIL}
                      placeholder={t("your.name@ksp.gov.in")}
                      className="h-11 w-full rounded-[5px] border-2 border-foreground bg-background pl-9 pr-3 text-sm font-medium placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide">
                    {t("Password")}
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                    <input
                      type={showPw ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      defaultValue={DEMO_PASSWORD}
                      placeholder={t("Enter your password")}
                      className="h-11 w-full rounded-[5px] border-2 border-foreground bg-background pl-9 pr-10 text-sm font-medium placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] p-1.5 text-foreground/60 hover:text-foreground"
                      aria-label="Toggle password visibility"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember me + Forgot */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => setRemember((r) => !r)}
                      className={`grid h-5 w-5 place-items-center rounded-[5px] border-2 border-foreground transition ${remember ? "bg-primary text-primary-foreground" : "bg-background"}`}
                      aria-pressed={remember}
                    >
                      {remember && (
                        <span className="text-[12px] font-extrabold leading-none">✓</span>
                      )}
                    </button>
                    {t("Remember me")}
                  </label>
                  <a href="#" className="text-sm font-bold underline-offset-4 hover:underline">
                    {t("Forgot password?")}
                  </a>
                </div>

                {/* Error banner */}
                {error && (
                  <div className="rounded-[5px] border-2 border-destructive bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive flex items-start gap-2">
                    <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      {error}
                      {error.includes("create an account") && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => {
                              setError(null);
                              setShowCreate(true);
                            }}
                            className="underline underline-offset-2 hover:no-underline cursor-pointer"
                          >
                            {t("Create account")}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )}

                {/* Sign in button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-primary text-sm font-extrabold uppercase tracking-wide text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                  {loading ? t("Signing in…") : t("Sign in")}
                </button>

                {/* SSO — an OIDC placeholder; no identity provider is wired.
                    It used to navigate straight to /console with NO token, which is
                    an auth bypass in shape and broken in practice: the console has
                    no session, its first API call 401s, and Shell bounces the user
                    back to this page. It now completes the same demo sign-in as the
                    button above, so you always leave here holding a real token. */}
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    setError(null);
                    setLoading(true);
                    try {
                      const username = DEMO_EMAIL.includes("@")
                        ? DEMO_EMAIL.split("@")[0]
                        : DEMO_EMAIL;
                      await api.login(username, DEMO_PASSWORD);
                      navigate({ to: "/console" });
                    } catch {
                      setError(t("Single sign-on is not configured. Use the form above."));
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  {t("Sign in with SSO (OIDC)")}
                </button>

                <p className="pt-2 text-center text-sm text-foreground/70">
                  {t("Don't have an account?")}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setShowCreate(true);
                    }}
                    className="font-bold underline-offset-4 hover:underline cursor-pointer"
                  >
                    {t("Create account")}
                  </button>
                </p>
              </form>
            </GlassCardContent>
          </GlassCard>

          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-foreground/70 hover:text-foreground"
          >
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

/**
 * Per-badge float timings.
 *
 * Deliberately fixed rather than randomised: this route is server-rendered, and
 * calling Math.random() during render makes the SSR markup disagree with the first
 * client render, which React reports as a hydration mismatch and recovers from by
 * throwing the whole tree away.
 *
 * The three durations are mutually indivisible and each starts at a negative
 * offset, so the badges drift out of phase and read as independent — then drift
 * back into alignment every so often and pop together. That gives both behaviours
 * asked for without a scheduler or any per-frame JavaScript.
 */
const BADGE_FLOAT = [
  { duration: "3.1s", delay: "-0.2s" },
  { duration: "4.3s", delay: "-1.7s" },
  { duration: "3.7s", delay: "-2.9s" },
  { duration: "4.9s", delay: "-0.9s" },
  { duration: "3.3s", delay: "-2.1s" },
];

function TrustBadge({
  icon,
  label,
  index = 0,
}: {
  icon: React.ReactNode;
  label: string;
  /** Position in the row — selects this badge's float phase. */
  index?: number;
}) {
  const f = BADGE_FLOAT[index % BADGE_FLOAT.length];
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="tb-float grid h-12 w-12 place-items-center rounded-[5px] border-2 border-foreground bg-secondary-background"
        style={{ animationDuration: f.duration, animationDelay: f.delay }}
      >
        {icon}
      </div>
      <span className="text-xs font-bold">{label}</span>
    </div>
  );
}

/**
 * Depth animation for the trust badges.
 *
 * `perspective()` is applied inside each element's own transform rather than on a
 * shared parent, so the badges do not need a common 3D context and the row keeps
 * its normal flex layout. The hard offset shadow grows as the box comes forward
 * and collapses as it sinks back, which is what actually sells the depth — a
 * scale change alone reads as a zoom rather than movement toward the viewer.
 *
 * Hover pauses the cycle and holds the box out front, so the icon is legible and
 * steady at the moment someone is looking straight at it.
 */
function TrustBadgeStyles() {
  return (
    <style>{`
      .tb-float {
        animation-name: tbFloat;
        animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
        animation-iteration-count: infinite;
        transform-style: preserve-3d;
        will-change: transform, box-shadow;
      }
      @keyframes tbFloat {
        0%, 100% {
          transform: perspective(600px) translateZ(-70px) scale(0.9) rotateX(7deg);
          box-shadow: 1px 1px 0 0 var(--border);
        }
        50% {
          transform: perspective(600px) translateZ(60px) scale(1.1) rotateX(-5deg);
          box-shadow: 7px 8px 0 0 var(--border);
        }
      }
      .tb-float:hover {
        animation-play-state: paused;
        transform: perspective(600px) translateZ(75px) scale(1.14) rotateX(0deg);
        box-shadow: 8px 9px 0 0 var(--border);
        transition: transform .25s ease-out, box-shadow .25s ease-out;
      }
      /* Reduced motion: soften, do not freeze.
         The vestibular problem with this effect is the depth travel — 130px of
         translateZ plus a tilt reads as the element lunging at the viewer. That is
         removed here, along with the rotation and the perspective. What remains is
         a slow, small scale-and-shadow breathe, which carries the same "these are
         alive" intent without any apparent movement through space.
         An earlier version set animation:none here, which meant anyone with OS
         animations disabled — including on this project's own dev machine — saw a
         completely static row and reasonably concluded the feature was broken. */
      @media (prefers-reduced-motion: reduce) {
        @keyframes tbFloat {
          0%, 100% { transform: scale(0.97); box-shadow: 3px 3px 0 0 var(--border); }
          50%      { transform: scale(1.03); box-shadow: 5px 5px 0 0 var(--border); }
        }
        .tb-float {
          /* Slow it right down and drop the per-badge phase offsets so the row
             reads as one calm pulse rather than three competing ones. */
          animation-duration: 6s !important;
          animation-delay: 0s !important;
        }
        .tb-float:hover {
          transform: scale(1.05);
          box-shadow: 5px 5px 0 0 var(--border);
        }
      }
    `}</style>
  );
}
