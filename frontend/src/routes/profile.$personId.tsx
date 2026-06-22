import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useRef, useState } from "react";
import {
  Network,
  Clock,
  AlertTriangle,
  ChevronRight,
  Search,
  X,
  User,
  MapPin,
  Calendar,
  FileDown,
  Shield,
  Users,
  Fingerprint,
  TrendingUp,
  Hash,
  Loader2,
  ArrowLeft,
  Printer,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import {
  intelligence,
  type OffenderProfileResponse,
  type PersonTimelineEvent,
  type SearchResult,
  type OffenderListItem,
} from "@/lib/api/intelligence";
import { CaseDrawer } from "@/components/CaseDrawer";

export const Route = createFileRoute("/profile/$personId")({
  head: () => ({ meta: [{ title: "Profile · Satyam" }] }),
  component: ProfileScreen,
});

// ── Risk palette ──────────────────────────────────────────────────────────────
const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-400 text-foreground",
  Low: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
};
const RISK_RING: Record<string, string> = {
  Critical: "ring-2 ring-destructive/40",
  High: "ring-2 ring-orange-400/40",
  Medium: "ring-2 ring-yellow-400/40",
  Low: "ring-2 ring-emerald-400/30",
};

// ── Offender browse dropdown ──────────────────────────────────────────────────
function OffenderPicker({ value, onPick }: { value: number; onPick: (id: number) => void }) {
  const [list, setList] = useState<OffenderListItem[]>([]);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "200", min_offenses: "1" });
    intelligence
      .listOffenders(p)
      .then((r) => setList(r.offenders))
      .catch(() => setList([]));
  }, []);
  return (
    <select
      value={value > 0 ? String(value) : ""}
      onChange={(e) => e.target.value && onPick(Number(e.target.value))}
      className="h-9 rounded-lg border border-input bg-card px-2 text-xs max-w-[200px] focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="">Browse offenders…</option>
      {list.map((o) => (
        <option key={o.person_id} value={o.person_id}>
          {o.display_name} · {o.offense_count} cases{o.district ? ` · ${o.district}` : ""}
        </option>
      ))}
    </select>
  );
}

// ── Unified Search Bar ────────────────────────────────────────────────────────
function PersonSearch({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setLoading(true);
      intelligence
        .searchPersonsAndCases(q.trim(), 12)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q]);

  function pick(r: SearchResult) {
    setQ("");
    setResults([]);
    setOpen(false);
    onSelect(r);
  }

  return (
    <div className="relative w-full max-w-xl">
      <div
        className={`flex items-center gap-2 rounded-xl border-2 bg-background px-4 py-2.5 transition-all
        ${open ? "border-primary shadow-lg shadow-primary/10" : "border-input"}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search person, FIR number, crime type…")}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setResults([]);
              setOpen(false);
            }}
            className="text-muted-foreground hover:text-foreground transition"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden divide-y divide-border/60">
          {/* persons */}
          {results.filter((r) => r.type === "person").length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 flex items-center gap-1.5">
                <User className="h-3 w-3" /> {t("Persons")}
              </div>
              {results
                .filter((r) => r.type === "person")
                .map((r) => (
                  <button
                    key={`p-${r.id}`}
                    onClick={() => pick(r)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 text-left transition"
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {r.label}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.sub}</div>
                    </div>
                    {r.case_count != null && r.case_count > 0 && (
                      <span className="shrink-0 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold px-2 py-0.5">
                        {r.case_count} {t("cases")}
                      </span>
                    )}
                  </button>
                ))}
            </>
          )}
          {/* cases */}
          {results.filter((r) => r.type === "case").length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 flex items-center gap-1.5">
                <Hash className="h-3 w-3" /> {t("Cases / FIRs")}
              </div>
              {results
                .filter((r) => r.type === "case")
                .map((r) => (
                  <button
                    key={`c-${r.id}`}
                    onClick={() => pick(r)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 text-left transition"
                  >
                    <div className="h-8 w-8 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Hash className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground font-mono truncate">
                        {r.label}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.sub}</div>
                    </div>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {open && results.length === 0 && q.length >= 2 && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border border-border bg-card shadow-xl px-4 py-4 text-sm text-muted-foreground text-center">
          {t("No results for")} "<strong>{q}</strong>"
        </div>
      )}
    </div>
  );
}

// ── PDF print styles injected into head once ─────────────────────────────────
function injectPrintStyles() {
  if (document.getElementById("profile-print-styles")) return;
  const s = document.createElement("style");
  s.id = "profile-print-styles";
  s.textContent = `
    @media print {
      body > *:not(#profile-print-root) { display: none !important; }
      #profile-print-root { display: block !important; position: static !important; }
      .no-print { display: none !important; }
      @page { margin: 18mm 15mm; size: A4; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #111; background: white; }
      h1 { font-size: 16pt; margin-bottom: 4pt; }
      h2 { font-size: 12pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; margin-top: 14pt; }
      table { width: 100%; border-collapse: collapse; margin-top: 6pt; }
      th, td { border: 1px solid #ddd; padding: 4pt 6pt; text-align: left; font-size: 9pt; }
      th { background: #f4f4f4; font-weight: bold; }
      .risk-badge { display: inline-block; padding: 1pt 5pt; border-radius: 3pt; font-weight: bold; font-size: 9pt; }
      .section-card { border: 1px solid #e0e0e0; border-radius: 5pt; padding: 8pt 10pt; margin-bottom: 8pt; break-inside: avoid; }
      .tag { display: inline-block; border: 1px solid #ccc; border-radius: 3pt; padding: 0 4pt; font-size: 8.5pt; margin: 1pt; }
    }
  `;
  document.head.appendChild(s);
}

// ── Main screen ───────────────────────────────────────────────────────────────
function ProfileScreen() {
  const { personId } = Route.useParams();
  const navigate = useNavigate();
  const t = useT();
  const { lang } = useI18n();
  const printRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<OffenderProfileResponse | null>(null);
  const [timeline, setTimeline] = useState<PersonTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [personMeta, setPersonMeta] = useState<{
    name: string;
    gender?: string;
    age?: number;
    district?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "associates" | "mo">(
    "overview",
  );

  const pid = Number(personId);

  useEffect(() => {
    injectPrintStyles();
  }, []);

  useEffect(() => {
    if (!pid || isNaN(pid)) return;
    setLoading(true);
    setError(null);
    Promise.all([intelligence.getPersonProfile(pid), intelligence.getPersonTimeline(pid)])
      .then(([p, tl]) => {
        setProfile(p);
        setTimeline(tl.events);
      })
      .catch((e) =>
        setError(
          e?.status === 403
            ? t("Insufficient clearance to view this profile.")
            : t("Could not load profile."),
        ),
      )
      .finally(() => setLoading(false));
  }, [pid]);

  function handleSearchSelect(r: SearchResult) {
    if (r.type === "person") {
      setPersonMeta({
        name: r.label,
        gender: r.gender ?? undefined,
        age: r.age ?? undefined,
        district: r.district ?? undefined,
      });
      navigate({ to: "/profile/$personId", params: { personId: String(r.id) } });
    } else {
      setDrawerCaseId(r.id);
    }
  }

  function handlePrint() {
    window.print();
  }

  const displayName = profile?.display_name || personMeta?.name || `Person #${pid}`;
  const tabs = [
    { key: "overview", label: t("Overview"), icon: User },
    { key: "history", label: t("Crime History"), icon: Clock },
    { key: "associates", label: t("Associates"), icon: Users },
    { key: "mo", label: t("MO Fingerprint"), icon: Fingerprint },
  ] as const;

  // Group timeline by year for history view
  const historyByYear = timeline.reduce<Record<string, PersonTimelineEvent[]>>((acc, e) => {
    const yr = e.date?.slice(0, 4) || "Unknown";
    (acc[yr] = acc[yr] || []).push(e);
    return acc;
  }, {});

  const totalCases = timeline.length;
  const accusedCases = timeline.filter((e) => e.role === "Accused").length;
  const uniqueCrimes = new Set(timeline.map((e) => e.crime_type).filter(Boolean)).size;

  return (
    <Shell>
      <div
        className="flex flex-col h-full overflow-auto bg-background"
        id="profile-print-root"
        ref={printRef}
      >
        {/* ── Top header with search ───────────────────────────────────── */}
        <div className="border-b border-border bg-card px-6 py-4 no-print">
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <div className="flex items-center gap-3">
              {pid > 0 && (
                <button
                  onClick={() => navigate({ to: "/profile/$personId", params: { personId: "0" } })}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("PS5 · Offender Profile")}
                </div>
                <h1 className="text-lg font-extrabold text-foreground">
                  {pid > 0 ? displayName : t("Search for a person or case")}
                </h1>
              </div>
            </div>
            <PersonSearch onSelect={handleSearchSelect} />
            <OffenderPicker
              value={pid}
              onPick={(id) =>
                navigate({ to: "/profile/$personId", params: { personId: String(id) } })
              }
            />
            {pid > 0 && profile && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate({ to: "/network", search: { person: pid } as any })}
                  className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted transition"
                >
                  <Network className="h-3.5 w-3.5" /> {t("Network")}
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition"
                >
                  <Printer className="h-3.5 w-3.5" /> {t("Download PDF")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {!pid && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-6">
            <div className="p-6 rounded-2xl bg-muted/40 border border-border">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold text-foreground mb-2">
                {t("Find a Person or Case")}
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                {t(
                  "Search by person name, FIR number, crime type, or date. Select a result to view the complete intelligence dossier.",
                )}
              </p>
            </div>
            <div className="w-full max-w-lg">
              <PersonSearch onSelect={handleSearchSelect} />
            </div>
          </div>
        )}

        {/* ── Loading / error ──────────────────────────────────────────── */}
        {pid > 0 && loading && (
          <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("Loading profile…")}</span>
          </div>
        )}
        {pid > 0 && error && (
          <div className="m-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* ── Full profile when loaded ─────────────────────────────────── */}
        {pid > 0 && !loading && profile && (
          <>
            {/* Hero dossier card — printed at top */}
            <div className="mx-6 mt-5 rounded-xl border border-border bg-card overflow-hidden">
              {/* Risk colour bar */}
              <div
                className={`h-1.5 w-full ${
                  profile.risk.label === "Critical"
                    ? "bg-destructive"
                    : profile.risk.label === "High"
                      ? "bg-orange-500"
                      : profile.risk.label === "Medium"
                        ? "bg-yellow-400"
                        : "bg-emerald-500"
                }`}
              />
              <div className="p-5 grid md:grid-cols-[1fr_auto] gap-6">
                {/* Identity */}
                <div className="flex items-start gap-4">
                  <div
                    className={`h-16 w-16 rounded-xl flex items-center justify-center text-2xl font-extrabold bg-primary/10 text-primary shrink-0 ${RISK_RING[profile.risk.label] || ""}`}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-foreground">{displayName}</h2>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {tData("gender", personMeta?.gender || "", lang) || t("Gender unknown")}
                      </span>
                      {personMeta?.age && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {t("Age")} {personMeta.age}
                        </span>
                      )}
                      {personMeta?.district && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {tData("district", personMeta.district, lang)}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[11px]">
                        <Hash className="h-3 w-3" />
                        ID: {pid}
                      </span>
                    </div>
                    {/* Quick stats */}
                    <div className="flex flex-wrap gap-3 mt-3">
                      {[
                        { label: t("Total Cases"), val: totalCases, color: "text-foreground" },
                        { label: t("As Accused"), val: accusedCases, color: "text-destructive" },
                        { label: t("Crime Types"), val: uniqueCrimes, color: "text-orange-500" },
                        {
                          label: t("Associates"),
                          val: profile.known_associates.length,
                          color: "text-primary",
                        },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center min-w-[70px]"
                        >
                          <div className={`text-xl font-extrabold tabular-nums ${s.color}`}>
                            {s.val}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Risk score */}
                <div className="flex flex-col items-center justify-center gap-2 border-l border-border pl-6 min-w-[120px]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("Risk Score")}
                  </div>
                  <div
                    className={`text-5xl font-extrabold tabular-nums ${
                      profile.risk.label === "Critical"
                        ? "text-destructive"
                        : profile.risk.label === "High"
                          ? "text-orange-500"
                          : profile.risk.label === "Medium"
                            ? "text-yellow-500"
                            : "text-emerald-500"
                    }`}
                  >
                    {profile.risk.score}
                  </div>
                  <span
                    className={`rounded-lg px-3 py-1 text-sm font-bold ${RISK_BG[profile.risk.label] || "bg-muted"}`}
                  >
                    {tData("risk_label", profile.risk.label, lang)}
                  </span>
                  <p className="text-[10px] text-muted-foreground text-center max-w-[110px] italic leading-relaxed mt-1">
                    {t("Indicative only. Human review required.")}
                  </p>
                </div>
              </div>
              {/* Ring membership banner */}
              {profile.ring_membership && (
                <div className="border-t border-orange-400/40 bg-orange-500/10 px-5 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                  <span className="text-sm font-bold text-orange-700 dark:text-orange-300">
                    {profile.ring_membership.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {profile.ring_membership.ring_id}
                  </span>
                </div>
              )}
            </div>

            {/* Tab bar */}
            <div className="flex gap-0 border-b border-border bg-card px-6 mt-4 overflow-x-auto no-print">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as typeof activeTab)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    activeTab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="p-6 space-y-5">
              {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
              {activeTab === "overview" && (
                <>
                  {/* Risk breakdown */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 mb-4">
                      <Shield className="h-4 w-4 text-primary" /> {t("Risk Breakdown")}
                    </h3>
                    <div className="space-y-3">
                      {profile.risk.breakdown.map((f) => (
                        <div key={f.factor} className="flex items-center gap-3">
                          <span className="w-32 text-xs text-muted-foreground">{f.factor}</span>
                          <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${(f.score / 30) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs tabular-nums font-bold">
                            {f.score}
                          </span>
                          <span className="w-40 text-[11px] text-muted-foreground truncate">
                            {f.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[10px] text-muted-foreground italic flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t("Decision support only — not predictive policing.")}
                    </p>
                  </div>

                  {/* Recent activity */}
                  {timeline.slice(0, 5).length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 mb-4">
                        <TrendingUp className="h-4 w-4 text-primary" /> {t("Recent Activity")}
                      </h3>
                      <div className="space-y-2">
                        {timeline.slice(0, 5).map((e, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 cursor-pointer"
                            onClick={() => setDrawerCaseId(e.case_id)}
                          >
                            <div className="text-[11px] text-muted-foreground w-20 shrink-0 tabular-nums">
                              {e.date?.slice(0, 10) || "—"}
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                                e.role === "Accused"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {tData("role", e.role, lang)}
                            </span>
                            <span className="text-xs font-medium flex-1 truncate">
                              {tData("crime_type", e.crime_type || "Unknown", lang)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {tData("status", e.status || "", lang)}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </div>
                        ))}
                        {timeline.length > 5 && (
                          <button
                            onClick={() => setActiveTab("history")}
                            className="w-full text-xs text-primary hover:underline pt-1"
                          >
                            {t("View all")} {timeline.length} {t("cases")} →
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── CRIME HISTORY TAB ────────────────────────────────────── */}
              {activeTab === "history" && (
                <div className="space-y-4">
                  {Object.entries(historyByYear)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([year, events]) => (
                      <div
                        key={year}
                        className="rounded-xl border border-border bg-card overflow-hidden"
                      >
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                          <span className="text-sm font-bold text-foreground">{year}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {events.length} {t("cases")}
                          </span>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <tr>
                              <th className="px-4 py-2 text-left font-semibold">{t("Date")}</th>
                              <th className="px-4 py-2 text-left font-semibold">{t("Role")}</th>
                              <th className="px-4 py-2 text-left font-semibold">
                                {t("Crime Type")}
                              </th>
                              <th className="px-4 py-2 text-left font-semibold">{t("Status")}</th>
                              <th className="px-4 py-2 w-8" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {events.map((e, i) => (
                              <tr
                                key={i}
                                className="hover:bg-muted/20 cursor-pointer"
                                onClick={() => setDrawerCaseId(e.case_id)}
                              >
                                <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                                  {e.date?.slice(0, 10) || "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                      e.role === "Accused"
                                        ? "bg-destructive/10 text-destructive"
                                        : e.role === "Victim"
                                          ? "bg-blue-500/10 text-blue-600"
                                          : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {tData("role", e.role, lang)}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 font-medium">
                                  {tData("crime_type", e.crime_type || "Unknown", lang)}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                  {tData("status", e.status || "", lang)}
                                </td>
                                <td className="px-4 py-2.5">
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  {timeline.length === 0 && (
                    <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
                      {t("No crime history found.")}
                    </div>
                  )}
                </div>
              )}

              {/* ── ASSOCIATES TAB ───────────────────────────────────────── */}
              {activeTab === "associates" && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" /> {t("Known Associates")}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {profile.known_associates.length} {t("persons")}
                    </span>
                  </div>
                  {profile.known_associates.length > 0 ? (
                    <div className="divide-y divide-border">
                      {profile.known_associates.map((a, i) => (
                        <div
                          key={a.person_id}
                          className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 cursor-pointer"
                          onClick={() =>
                            navigate({
                              to: "/profile/$personId",
                              params: { personId: String(a.person_id) },
                            })
                          }
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-foreground shrink-0">
                              {i + 1}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-foreground">
                                {t("Person")} #{a.person_id}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {a.shared_case_count} {t("shared cases")}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex gap-1">
                              {Array.from({ length: Math.min(a.shared_case_count, 5) }).map(
                                (_, j) => (
                                  <div key={j} className="h-2 w-2 rounded-full bg-destructive/60" />
                                ),
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      {t("No known associates found.")}
                    </div>
                  )}
                </div>
              )}

              {/* ── MO FINGERPRINT TAB ──────────────────────────────────── */}
              {activeTab === "mo" && (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {[
                      {
                        label: t("Top Crime Types"),
                        items: profile.mo_fingerprint.top_crime_types.map((v) =>
                          tData("crime_type", v, lang),
                        ),
                      },
                      { label: t("Legal Sections"), items: profile.mo_fingerprint.top_sections },
                      {
                        label: t("Motives"),
                        items: profile.mo_fingerprint.top_motives.map((v) =>
                          tData("motive", v, lang),
                        ),
                      },
                      {
                        label: t("Typical Time"),
                        items: profile.mo_fingerprint.time_of_day
                          ? [profile.mo_fingerprint.time_of_day]
                          : [],
                      },
                    ].map((g) => (
                      <div key={g.label} className="rounded-xl border border-border bg-card p-4">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
                          {g.label}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.items.map((item, i) => (
                            <span
                              key={i}
                              className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground"
                            >
                              {item}
                            </span>
                          ))}
                          {g.items.length === 0 && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Print-only full report ───────────────────────────────── */}
            <div
              className="hidden print:block px-8 py-6 text-[11pt]"
              style={{ fontFamily: "Arial, sans-serif" }}
            >
              {/* KSP letterhead */}
              <div
                style={{
                  borderBottom: "3px solid #1a1a2e",
                  paddingBottom: "8pt",
                  marginBottom: "12pt",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "#555",
                  }}
                >
                  Karnataka State Police — Confidential Intelligence Report
                </div>
                <div style={{ fontSize: "18pt", fontWeight: "bold", marginTop: "2pt" }}>
                  Offender Profile Report
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "8pt",
                    color: "#666",
                    marginTop: "6pt",
                  }}
                >
                  <span>Generated: {new Date().toLocaleString()}</span>
                  <span>
                    Ref: KSP/PROFILE/{pid}/{new Date().getFullYear()}
                  </span>
                </div>
              </div>

              {/* Identity block */}
              <h2
                style={{
                  fontSize: "12pt",
                  fontWeight: "bold",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "3pt",
                }}
              >
                1. Subject Identity
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "6pt" }}>
                <tbody>
                  {[
                    ["Full Name", displayName],
                    ["Person ID", String(pid)],
                    ["Gender", tData("gender", personMeta?.gender || "", "EN") || "—"],
                    ["Age", personMeta?.age ? String(personMeta.age) : "—"],
                    ["District", personMeta?.district || "—"],
                    ["Risk Score", `${profile.risk.score} / 99 (${profile.risk.label})`],
                    ["Total Cases", String(totalCases)],
                    ["Cases as Accused", String(accusedCases)],
                    ["Distinct Crime Types", String(uniqueCrimes)],
                    ["Known Associates", String(profile.known_associates.length)],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #eee" }}>
                      <td
                        style={{
                          padding: "3pt 6pt",
                          fontWeight: "bold",
                          width: "35%",
                          fontSize: "9pt",
                          backgroundColor: "#f8f8f8",
                        }}
                      >
                        {k}
                      </td>
                      <td style={{ padding: "3pt 6pt", fontSize: "9pt" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* MO fingerprint */}
              <h2
                style={{
                  fontSize: "12pt",
                  fontWeight: "bold",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "3pt",
                  marginTop: "14pt",
                }}
              >
                2. Modus Operandi (MO) Fingerprint
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "6pt" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f0f0f0" }}>
                    <th
                      style={{
                        padding: "4pt 6pt",
                        fontSize: "9pt",
                        textAlign: "left",
                        border: "1px solid #ddd",
                      }}
                    >
                      Category
                    </th>
                    <th
                      style={{
                        padding: "4pt 6pt",
                        fontSize: "9pt",
                        textAlign: "left",
                        border: "1px solid #ddd",
                      }}
                    >
                      Values
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Crime Types", profile.mo_fingerprint.top_crime_types.join(", ") || "—"],
                    ["IPC/BNS Sections", profile.mo_fingerprint.top_sections.join(", ") || "—"],
                    ["Motives", profile.mo_fingerprint.top_motives.join(", ") || "—"],
                    ["Typical Time", profile.mo_fingerprint.time_of_day || "—"],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #eee" }}>
                      <td
                        style={{
                          padding: "3pt 6pt",
                          fontWeight: "bold",
                          fontSize: "9pt",
                          border: "1px solid #ddd",
                          width: "30%",
                        }}
                      >
                        {k}
                      </td>
                      <td style={{ padding: "3pt 6pt", fontSize: "9pt", border: "1px solid #ddd" }}>
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Full crime history */}
              <h2
                style={{
                  fontSize: "12pt",
                  fontWeight: "bold",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "3pt",
                  marginTop: "14pt",
                }}
              >
                3. Complete Crime History ({timeline.length} records)
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "6pt" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f0f0f0" }}>
                    {["#", "Date", "Role", "Crime Type", "Status", "Case ID"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "4pt 5pt",
                          fontSize: "8pt",
                          textAlign: "left",
                          border: "1px solid #ddd",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((e, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid #eee",
                        backgroundColor: i % 2 === 0 ? "#fff" : "#fafafa",
                      }}
                    >
                      <td style={{ padding: "3pt 5pt", fontSize: "8pt", border: "1px solid #ddd" }}>
                        {i + 1}
                      </td>
                      <td
                        style={{
                          padding: "3pt 5pt",
                          fontSize: "8pt",
                          border: "1px solid #ddd",
                          fontFamily: "monospace",
                        }}
                      >
                        {e.date?.slice(0, 10) || "—"}
                      </td>
                      <td
                        style={{
                          padding: "3pt 5pt",
                          fontSize: "8pt",
                          border: "1px solid #ddd",
                          fontWeight: "bold",
                        }}
                      >
                        {e.role}
                      </td>
                      <td style={{ padding: "3pt 5pt", fontSize: "8pt", border: "1px solid #ddd" }}>
                        {e.crime_type || "—"}
                      </td>
                      <td style={{ padding: "3pt 5pt", fontSize: "8pt", border: "1px solid #ddd" }}>
                        {e.status || "—"}
                      </td>
                      <td
                        style={{
                          padding: "3pt 5pt",
                          fontSize: "8pt",
                          border: "1px solid #ddd",
                          fontFamily: "monospace",
                        }}
                      >
                        {e.case_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Associates */}
              {profile.known_associates.length > 0 && (
                <>
                  <h2
                    style={{
                      fontSize: "12pt",
                      fontWeight: "bold",
                      borderBottom: "1px solid #ccc",
                      paddingBottom: "3pt",
                      marginTop: "14pt",
                    }}
                  >
                    4. Known Associates ({profile.known_associates.length})
                  </h2>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "6pt" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f0f0f0" }}>
                        {["Person ID", "Shared Cases", "Risk Indicator"].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "4pt 5pt",
                              fontSize: "8pt",
                              textAlign: "left",
                              border: "1px solid #ddd",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {profile.known_associates.map((a, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                          <td
                            style={{
                              padding: "3pt 5pt",
                              fontSize: "8pt",
                              border: "1px solid #ddd",
                            }}
                          >
                            #{a.person_id}
                          </td>
                          <td
                            style={{
                              padding: "3pt 5pt",
                              fontSize: "8pt",
                              border: "1px solid #ddd",
                            }}
                          >
                            {a.shared_case_count}
                          </td>
                          <td
                            style={{
                              padding: "3pt 5pt",
                              fontSize: "8pt",
                              border: "1px solid #ddd",
                            }}
                          >
                            {a.shared_case_count >= 3 ? "⚠ High association" : "Moderate"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Footer */}
              <div
                style={{
                  marginTop: "20pt",
                  borderTop: "1px solid #ccc",
                  paddingTop: "8pt",
                  fontSize: "8pt",
                  color: "#777",
                }}
              >
                <strong>CONFIDENTIAL</strong> — This report contains synthetic data for
                demonstration purposes only. All person names, FIR numbers, and incident details are
                computer-generated and do not represent real individuals or events. Prepared by
                Satyam Crime Intelligence System · KSP × Datathon 2026.
              </div>
            </div>
          </>
        )}
      </div>

      <CaseDrawer
        open={drawerCaseId !== null}
        onClose={() => setDrawerCaseId(null)}
        caseId={drawerCaseId ?? undefined}
      />
    </Shell>
  );
}
