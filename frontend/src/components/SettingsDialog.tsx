import { useEffect, useState } from "react";
import {
  X,
  User,
  Bell,
  Lock,
  Monitor,
  Database,
  Check,
  Download,
  Trash2,
  AlertTriangle,
  Cpu,
  CloudCog,
  HardDrive,
  Languages,
  Loader2,
  Sparkles,
  Hand,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { enrichDictWithLLM, enrichDataWithLLM } from "@/lib/i18n";
import { api, type SessionUser } from "@/lib/api/client";
import {
  loadHandsFree,
  saveHandsFree,
  defaultHandsFree,
} from "@/config/handsFreeConfig";
import type { HandsFreeSettings } from "@/input/types";

type Tab = "profile" | "models" | "preferences" | "notifications" | "security" | "data" | "handsfree" | "translation";

// Per-session engine overrides — persisted in localStorage and sent with each chat request.
export type EngineSettings = {
  apiModelEnabled: boolean;
  localModelEnabled: boolean;
  brainEngine: "gemini" | "groq" | "openai" | "local";
  sqlEngine: "gemini" | "qwen3-coder-next" | "local";
  boardEngine: "gemini" | "groq" | "openai";
  voiceBackend: "sarvam" | "google" | "webspeech";
  /** Copilot (top-right) microphone STT engine — independent of the chat voice. */
  copilotStt: "browser" | "sarvam";
  dbSource: "cloud" | "local";
};

const ENGINE_KEY = "satyam.engine-settings";

const defaultEngineSettings: EngineSettings = {
  apiModelEnabled: true,
  localModelEnabled: false,
  brainEngine: "gemini",
  sqlEngine: "gemini",
  boardEngine: "gemini",
  voiceBackend: "sarvam",
  copilotStt: "browser" as const, // lowest-latency live captions; switch to Sarvam for best Kannada
  dbSource: "cloud",
};

export function loadEngineSettings(): EngineSettings {
  if (typeof window === "undefined") return defaultEngineSettings;
  try {
    const raw = localStorage.getItem(ENGINE_KEY);
    if (raw) return { ...defaultEngineSettings, ...JSON.parse(raw) };
  } catch {}
  return defaultEngineSettings;
}

function saveEngineSettings(s: EngineSettings) {
  try {
    localStorage.setItem(ENGINE_KEY, JSON.stringify(s));
  } catch {}
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>("profile");
  const [engines, setEngines] = useState<EngineSettings>(loadEngineSettings);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<import("@/lib/api/client").ModelProviderStatus | null>(null);

  useEffect(() => {
    if (open && tab === "models") {
      api.modelProviders().then(setProviders).catch(() => {});
    }
  }, [open, tab]);

  useEffect(() => {
    if (open) {
      api
        .me()
        .then(setMe)
        .catch(() => {});
    }
  }, [open]);

  const updateEngine = <K extends keyof EngineSettings>(key: K, val: EngineSettings[K]) => {
    setEngines((prev) => {
      const next = { ...prev, [key]: val };
      saveEngineSettings(next);
      return next;
    });
  };

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "profile", label: t("Profile"), icon: User },
    { id: "models", label: t("Models"), icon: Cpu },
    { id: "preferences", label: t("Preferences"), icon: Monitor },
    { id: "notifications", label: t("Notifications"), icon: Bell },
    { id: "security", label: t("Security"), icon: Lock },
    { id: "data", label: t("Data & Privacy"), icon: Database },
    { id: "handsfree", label: t("Hands-free"), icon: Hand },
    { id: "translation", label: t("Translation"), icon: Languages },
  ];

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl flex flex-col rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg max-h-[calc(100vh-2rem)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-foreground bg-header px-5 py-3 text-header-foreground">
          <h2 className="text-lg font-extrabold tracking-tight">{t("Settings")}</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[5px] border-2 border-header-foreground bg-secondary-background text-foreground hover:translate-x-[2px] hover:translate-y-[2px] transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-[200px_1fr] min-h-0 flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="border-r-2 border-foreground bg-background p-3 overflow-y-auto">
            <nav className="flex flex-col gap-1.5">
              {tabs.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-2 rounded-[5px] border-2 px-3 py-2 text-sm font-bold transition ${
                      active
                        ? "border-foreground bg-primary text-primary-foreground nb-shadow-sm"
                        : "border-transparent text-foreground/70 hover:border-foreground hover:bg-secondary-background hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="overflow-y-auto p-6">
            {tab === "profile" && (
              <Section title={t("Profile")} subtitle={t("Your investigator details")}>
                <div className="flex items-center gap-4">
                  <div className="grid h-16 w-16 place-items-center rounded-[5px] border-2 border-foreground bg-primary text-lg font-extrabold text-primary-foreground nb-shadow-sm">
                    {me?.name
                      ? me.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)
                      : "RK"}
                  </div>
                  <div>
                    <div className="text-base font-bold">{me?.name || "R. Kumar"}</div>
                    <div className="text-sm text-foreground/60">
                      {me?.rank || "Inspector"} · {me?.range_name || "KSP Workspace"}
                    </div>
                  </div>
                </div>
                <Field
                  key={me?.name}
                  label={t("Full name")}
                  defaultValue={me?.name || "R. Kumar"}
                />
                <Field
                  key={me?.id}
                  label={t("Email")}
                  defaultValue={me?.id ? `${me.id}@ksp.gov.in` : "r.kumar@ksp.gov.in"}
                />
                <Field
                  key={me?.id ? "badge" : "default"}
                  label={t("Badge ID")}
                  defaultValue={me?.id ? `KSP-${me.id.toUpperCase()}` : "KSP-08842"}
                />
                <Field
                  key={me?.district || me?.range_name}
                  label={t("Station")}
                  defaultValue={me?.district || me?.range_name || "Bengaluru PS"}
                />
              </Section>
            )}

            {tab === "models" && (
              <Section
                title={t("Models & Backend")}
                subtitle={t("Live-switch engines without redeploying")}
              >
                {/* Model backend toggles */}
                <div className="space-y-2">
                  <span className="block text-xs font-bold uppercase tracking-wide">
                    {t("Model backend")}
                  </span>
                  <div className="flex flex-col gap-2">
                    <ModelToggle
                      label={t("API model (cloud)")}
                      description="Gemini, Groq, Sarvam, Ollama Cloud"
                      on={engines.apiModelEnabled}
                      onToggle={(v) => updateEngine("apiModelEnabled", v)}
                    />
                    <ModelToggle
                      label={t("Local model (on-prem)")}
                      description="BGE-M3 embedder + bge-reranker · RTX 4070 · FP16"
                      on={engines.localModelEnabled}
                      onToggle={(v) => updateEngine("localModelEnabled", v)}
                    />
                  </div>
                </div>

                {/* Local models status card */}
                <div className="rounded-[5px] border-2 border-foreground bg-background p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-3.5 w-3.5 text-success shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {t("Downloaded local models")}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      {
                        name: "BGE-M3",
                        path: "models/bge-m3",
                        role: t("Embedder — RAG semantic search"),
                        size: "2.12 GB · FP16 · 1024-dim",
                        always: true,
                      },
                      {
                        name: "bge-reranker-v2-m3",
                        path: "models/bge-reranker-v2-m3",
                        role: t("Reranker — cross-encoder scoring"),
                        size: "2.12 GB · FP16",
                        always: true,
                      },
                    ].map((m) => (
                      <div
                        key={m.name}
                        className="flex items-start justify-between gap-2 rounded-[3px] bg-muted/40 px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold font-mono text-foreground">
                              {m.name}
                            </span>
                            {m.always && (
                              <span className="rounded-[3px] bg-success/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">
                                always on
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{m.role}</div>
                          <div className="text-[10px] font-mono text-muted-foreground/70">
                            {m.size}
                          </div>
                        </div>
                        <div
                          className="h-2 w-2 mt-1 shrink-0 rounded-full bg-success"
                          title="Downloaded"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t(
                      "Both models run on the RTX 4070 (8 GB VRAM) and are always active — they are not switchable.",
                    )}
                  </p>
                </div>

                {/* AI Chat Model — pick which LLM powers the chat */}
                <div className="space-y-2">
                  <div>
                    <span className="block text-xs font-bold uppercase tracking-wide">
                      {t("AI Chat Model")}
                    </span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      {t("Choose the model that powers chat. Keys are set on the server (.env).")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(
                      [
                        { id: "gemini", label: "Gemini 2.5 Flash",    hint: t("Google · multimodal · default"), envKey: "GEMINI_API_KEY",  ok: providers?.gemini_configured },
                        { id: "openai", label: "ChatGPT (OpenAI)",    hint: t("GPT-4o · strong reasoning"),     envKey: "OPENAI_API_KEY",  ok: providers?.openai_configured },
                        { id: "groq",   label: "Groq Llama-3.3-70B",  hint: t("Cloud · fastest"),               envKey: "GROQ_API_KEY",    ok: providers?.groq_configured },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateEngine("brainEngine", m.id as EngineSettings["brainEngine"])}
                        className={
                          "flex items-center justify-between rounded-[5px] border-2 border-foreground px-3 py-2 text-left transition " +
                          (engines.brainEngine === m.id
                            ? "bg-primary text-primary-foreground nb-shadow-sm"
                            : "bg-secondary-background hover:bg-muted")
                        }
                      >
                        <span>
                          <span className="flex items-center gap-1 text-sm font-bold">
                            {engines.brainEngine === m.id && <Check className="h-3 w-3" />}
                            {m.label}
                          </span>
                          <span className="block text-[10px] opacity-70">{m.hint}</span>
                          <span className="block text-[10px] font-mono opacity-60">
                            {t("Uses")} {m.envKey}
                          </span>
                        </span>
                        <span
                          className={
                            "rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase " +
                            (m.ok
                              ? "bg-success/15 text-success"
                              : "bg-destructive/15 text-destructive")
                          }
                        >
                          {m.ok ? t("Configured") : t("No key")}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t("To enable a model, add its API key to the server .env and restart. Your selection is saved on this device and used for every chat.")}
                  </p>
                </div>

                {/* Text-to-SQL engine */}
                <Row label={t("Text-to-SQL engine")}>
                  <div className="flex flex-col items-end gap-0.5">
                    <select
                      value={engines.sqlEngine}
                      onChange={(e) =>
                        updateEngine("sqlEngine", e.target.value as EngineSettings["sqlEngine"])
                      }
                      className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1.5 text-xs font-bold"
                    >
                      <option value="gemini">Gemini 2.5 Flash (cloud)</option>
                      <option value="qwen3-coder-next">qwen3-coder-next (Ollama Cloud)</option>
                      <option value="local">Local LLM (on-prem · GPU)</option>
                    </select>
                    <span className="text-[10px] text-muted-foreground">
                      sqlglot guard applies to all
                    </span>
                  </div>
                </Row>

                {/* Investigation Board AI engine */}
                <Row label={t("Board AI (scene generator)")}>
                  <div className="flex flex-col items-end gap-0.5">
                    <select
                      value={engines.boardEngine}
                      onChange={(e) =>
                        updateEngine("boardEngine", e.target.value as EngineSettings["boardEngine"])
                      }
                      className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1.5 text-xs font-bold"
                    >
                      <option value="gemini">Gemini 2.5 Flash (recommended)</option>
                      <option value="groq">Groq Llama-3.3-70B (fast)</option>
                      <option value="openai">ChatGPT / OpenAI (GPT-4o)</option>
                    </select>
                    <span className="text-[10px] text-muted-foreground">
                      {t("Powers the AI Scene Generator on the Board screen")}
                    </span>
                  </div>
                </Row>

                {/* Voice provider — three-way picker */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">
                    {t("Voice (Text-to-Speech)")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("Which engine speaks replies aloud.")}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        id: "sarvam" as const,
                        label: "Sarvam API",
                        hint: t("Best Kannada (default)"),
                      },
                      {
                        id: "google" as const,
                        label: "Google API",
                        hint: t("Cloud Neural voices"),
                      },
                      {
                        id: "webspeech" as const,
                        label: "Web Speech API",
                        hint: t("Browser, offline"),
                      },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateEngine("voiceBackend", opt.id)}
                        className={
                          "rounded-[5px] border-2 border-foreground px-3 py-2 text-left text-xs font-bold transition hover:translate-x-[2px] hover:translate-y-[2px] " +
                          (engines.voiceBackend === opt.id
                            ? "bg-primary text-primary-foreground nb-shadow-sm"
                            : "bg-secondary-background text-foreground")
                        }
                      >
                        <span className="flex items-center gap-1">
                          {engines.voiceBackend === opt.id && <Check className="h-3 w-3" />}
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block font-normal text-[10px] opacity-70">
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Copilot mic — Speech-to-Text engine (independent of the chat voice/mic) */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">
                    {t("Voice copilot mic (Speech-to-Text)")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Engine for the top-right voice copilot only. Does not affect the chat box mic or the chat voice.",
                    )}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        id: "browser" as const,
                        label: t("Browser"),
                        hint: t("Lowest latency · live captions"),
                      },
                      {
                        id: "sarvam" as const,
                        label: "Sarvam API",
                        hint: t("Best Kannada accuracy"),
                      },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateEngine("copilotStt", opt.id)}
                        className={
                          "rounded-[5px] border-2 border-foreground px-3 py-2 text-left text-xs font-bold transition hover:translate-x-[2px] hover:translate-y-[2px] " +
                          (engines.copilotStt === opt.id
                            ? "bg-primary text-primary-foreground nb-shadow-sm"
                            : "bg-secondary-background text-foreground")
                        }
                      >
                        <span className="flex items-center gap-1">
                          {engines.copilotStt === opt.id && <Check className="h-3 w-3" />}
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block font-normal text-[10px] opacity-70">
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Database source */}
                <div className="space-y-2">
                  <span className="block text-xs font-bold uppercase tracking-wide">
                    Database source
                  </span>
                  <DbSourceRow
                    value={engines.dbSource}
                    onChange={(v) => {
                      updateEngine("dbSource", v);
                      // Notify backend so the active connection switches immediately
                      api.setDbSource(v).catch(() => {
                        /* backend may be down — setting persists for next request */
                      });
                    }}
                  />
                </div>

                <div className="rounded-[5px] border-2 border-foreground bg-background p-3 text-[11px] font-bold text-muted-foreground">
                  {t(
                    "Changes apply to new requests in this session. Reload to reset to server defaults.",
                  )}
                </div>
              </Section>
            )}

            {tab === "preferences" && (
              <Section title={t("Preferences")} subtitle={t("Workspace appearance & language")}>
                <Row label={t("Language")}>
                  <div className="flex gap-2">
                    <Pill active={lang === "EN"} onClick={() => setLang("EN")}>
                      EN
                    </Pill>
                    <Pill active={lang === "KN"} onClick={() => setLang("KN")}>
                      <span className="font-kn">ಕನ್ನಡ</span>
                    </Pill>
                  </div>
                </Row>
                <Row label={t("Default landing")}>
                  <Select options={[t("Console"), t("Map"), t("Network"), t("Reports")]} />
                </Row>
                <Row label={t("Density")}>
                  <Select options={[t("Comfortable"), t("Compact")]} />
                </Row>
                <Row label={t("Time format")}>
                  <Select options={["24-hour", "12-hour"]} />
                </Row>
              </Section>
            )}

            {tab === "notifications" && (
              <Section title={t("Notifications")} subtitle={t("Choose what alerts you receive")}>
                <Toggle label={t("New FIR assignments")} defaultOn />
                <Toggle label={t("Case status updates")} defaultOn />
                <Toggle label={t("Hotspot alerts")} defaultOn />
                <Toggle label={t("Weekly summary email")} />
                <Toggle label={t("Sound on new message")} />
              </Section>
            )}

            {tab === "security" && (
              <Section title={t("Security")} subtitle={t("Protect your account")}>
                <Field label={t("Current password")} type="password" defaultValue="••••••••" />
                <Field label={t("New password")} type="password" placeholder="••••••••" />
                <Toggle label={t("Two-factor authentication (TOTP)")} defaultOn />
                <Toggle label={t("Require MFA on every sign-in")} />
                <div className="rounded-[5px] border-2 border-foreground bg-warning/20 p-3 text-xs font-bold">
                  {t("Last sign-in: today, 09:42 from Bengaluru (Chrome · Windows)")}
                </div>
              </Section>
            )}

            {tab === "data" && (
              <Section title={t("Data & Privacy")} subtitle={t("Manage workspace data")}>
                <Toggle label={t("Allow analytics on query patterns")} defaultOn />
                <Toggle label={t("Share anonymized usage with KSP IT")} />
                <DataActions t={t} />
              </Section>
            )}

            {tab === "handsfree" && (
              <HandsFreePanel t={t} />
            )}

            {tab === "translation" && (
              <TranslationPanel t={t} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm"
          >
            <Check className="h-4 w-4" /> {t("Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}

function HandsFreePanel({ t }: { t: (s: string) => string }) {
  const [s, setS] = useState<HandsFreeSettings>(() => loadHandsFree());

  const update = <K extends keyof HandsFreeSettings>(key: K, val: HandsFreeSettings[K]) => {
    setS((prev) => {
      const next = { ...prev, [key]: val };
      saveHandsFree(next); // persists + dispatches "satyam:handsfree-settings"
      return next;
    });
  };

  const reset = () => {
    setS(defaultHandsFree);
    saveHandsFree(defaultHandsFree);
  };

  return (
    <Section
      title={t("Hands-free control")}
      subtitle={t("Camera gestures, wake word, and presence-aware auto-lock. All processing stays on this device.")}
    >
      <HFToggle
        label={t("Enable hands-free")}
        hint={t("Master switch. Turns the webcam on for gesture and presence features.")}
        on={s.enabled}
        onChange={(v) => update("enabled", v)}
      />

      <div className={s.enabled ? "space-y-3" : "space-y-3 opacity-40 pointer-events-none"}>
        <HFToggle
          label={t("Hand-gesture control")}
          hint={t("Point to move the cursor, pinch to click, swipe to navigate, ✋ to talk, ✊ to go back.")}
          on={s.gestures}
          onChange={(v) => update("gestures", v)}
        />
        <HFToggle
          label={t("Show gesture cursor")}
          hint={t("Display a glowing dot that follows your index finger.")}
          on={s.showCursor}
          onChange={(v) => update("showCursor", v)}
        />
        <HFToggle
          label={t("Wake word (“Satyam”)")}
          hint={t("Say “Satyam” to open the voice copilot without touching the mic.")}
          on={s.wakeWord}
          onChange={(v) => update("wakeWord", v)}
        />
        <HFToggle
          label={t("Presence auto-lock")}
          hint={t("Blur sensitive data and lock the session when no officer is at the camera. Writes an audit entry.")}
          on={s.presenceLock}
          onChange={(v) => update("presenceLock", v)}
        />
        <HFToggle
          label={t("Speak gesture confirmations")}
          hint={t("Read each gesture action aloud, in addition to the on-screen toast.")}
          on={s.speakFeedback}
          onChange={(v) => update("speakFeedback", v)}
        />

        <div className="rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{t("Auto-lock after")}</span>
            <span className="text-sm font-extrabold tabular-nums">{s.absenceSeconds}s</span>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={s.absenceSeconds}
            onChange={(e) => update("absenceSeconds", parseInt(e.target.value, 10))}
            className="mt-2 w-full h-1.5 accent-primary cursor-pointer"
          />
          <p className="mt-1 text-xs text-foreground/60">
            {t("Seconds of no detected face before the session locks.")}
          </p>
        </div>
      </div>

      <button
        onClick={reset}
        className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-1.5 text-xs font-bold nb-shadow-sm transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
      >
        {t("Reset to defaults")}
      </button>
    </Section>
  );
}

function HFToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <div className="min-w-0">
        <div className="text-sm font-bold">{label}</div>
        {hint && <p className="mt-0.5 text-xs text-foreground/60">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`mt-0.5 relative h-6 w-11 shrink-0 rounded-full border-2 border-foreground transition ${
          on ? "bg-primary" : "bg-secondary-background"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full border-2 border-foreground bg-card transition-all ${
            on ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-foreground/60">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  label: string;
  defaultValue?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide">{label}</span>
      <input
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm font-medium nb-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <span className="text-sm font-bold">{label}</span>
      {children}
    </div>
  );
}

function Select({ options }: { options: string[] }) {
  return (
    <select className="rounded-[5px] border-2 border-foreground bg-secondary-background px-2 py-1.5 text-sm font-bold">
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[5px] border-2 border-foreground px-3 py-1 text-xs font-extrabold transition ${
        active
          ? "bg-primary text-primary-foreground nb-shadow-sm"
          : "bg-secondary-background text-foreground/60"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, defaultOn }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="flex items-center justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <span className="text-sm font-bold">{label}</span>
      <button
        onClick={() => setOn(!on)}
        className={`relative h-6 w-11 rounded-[5px] border-2 border-foreground transition ${on ? "bg-primary" : "bg-secondary-background"}`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-[3px] border-2 border-foreground bg-secondary-background transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

const DELETION_KEY = "satyam.account.deletionScheduledAt";
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type Status =
  | { kind: "idle" }
  | { kind: "exporting" }
  | { kind: "exported"; file: string }
  | { kind: "deleting" };

function DbSourceRow({
  value,
  onChange,
}: {
  value: "cloud" | "local";
  onChange: (v: "cloud" | "local") => void;
}) {
  const options: { val: "cloud" | "local"; label: string; sub: string; icon: React.ElementType }[] =
    [
      {
        val: "cloud",
        label: "Neon cloud (PostgreSQL 16)",
        sub: "Deployed link · judges · authentication",
        icon: CloudCog,
      },
      {
        val: "local",
        label: "Local PostgreSQL 17",
        sub: "Full 100k dataset · GPU embeddings · on-prem demo",
        icon: HardDrive,
      },
    ];
  return (
    <div className="flex flex-col gap-2">
      {options.map(({ val, label, sub, icon: Icon }) => {
        const active = value === val;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`flex items-center gap-3 rounded-[5px] border-2 px-3 py-2.5 text-left transition ${
              active
                ? "border-foreground bg-primary/10 nb-shadow-sm"
                : "border-foreground/40 bg-background hover:border-foreground"
            }`}
          >
            <div
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border-2 border-foreground ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary-background text-foreground/60"
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">{label}</div>
              <div className="text-[10px] text-muted-foreground">{sub}</div>
            </div>
            {/* active indicator */}
            <div
              className={`h-3 w-3 shrink-0 rounded-full border-2 border-foreground transition ${
                active ? "bg-primary" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function ModelToggle({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[5px] border-2 border-foreground bg-background px-3 py-2.5 nb-shadow-sm">
      <div>
        <div className="text-sm font-bold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{description}</div>
      </div>
      <button
        onClick={() => onToggle(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-[5px] border-2 border-foreground transition ${on ? "bg-primary" : "bg-secondary-background"}`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-[3px] border-2 border-foreground bg-secondary-background transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "0d 0h 0m 0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function DataActions({ t }: { t: (s: string) => string }) {
  const [confirm, setConfirm] = useState<null | "export" | "delete">(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [typed, setTyped] = useState("");
  const [scheduledAt, setScheduledAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(DELETION_KEY);
    return v ? Number(v) : null;
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (scheduledAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [scheduledAt]);

  const remaining = scheduledAt ? scheduledAt + GRACE_MS - now : 0;

  const doExport = async () => {
    setStatus({ kind: "exporting" });
    const payload = {
      exportedAt: new Date().toISOString(),
      user: { name: "R. Kumar", email: "r.kumar@ksp.gov.in", badge: "KSP-08842" },
      activity: [
        { ts: new Date().toISOString(), action: "signed_in", ip: "10.0.4.21" },
        { ts: new Date().toISOString(), action: "viewed_case", id: "FIR-2026-00421" },
      ],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const file = `satyam-data-${Date.now()}.json`;
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);
    setConfirm(null);
    setStatus({ kind: "exported", file });
  };

  const doDelete = async () => {
    setStatus({ kind: "deleting" });
    await new Promise((r) => setTimeout(r, 600));
    const ts = Date.now();
    window.localStorage.setItem(DELETION_KEY, String(ts));
    setScheduledAt(ts);
    setNow(Date.now());
    setConfirm(null);
    setTyped("");
    setStatus({ kind: "idle" });
  };

  const cancelDeletion = () => {
    window.localStorage.removeItem(DELETION_KEY);
    setScheduledAt(null);
  };

  const finalizeOn = scheduledAt ? new Date(scheduledAt + GRACE_MS) : null;

  return (
    <>
      <button
        onClick={() => {
          setStatus({ kind: "idle" });
          setConfirm("export");
        }}
        className="flex w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-secondary-background px-4 py-2 text-sm font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
      >
        <Download className="h-4 w-4" /> {t("Export my account data")}
      </button>
      <button
        disabled={scheduledAt !== null}
        onClick={() => {
          setStatus({ kind: "idle" });
          setTyped("");
          setConfirm("delete");
        }}
        className="flex w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" /> {t("Delete my account data")}
      </button>

      {status.kind === "exported" && (
        <div className="flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary/20 p-3 text-xs font-bold">
          <Check className="h-4 w-4" /> {t("Export downloaded:")} {status.file}
        </div>
      )}

      {scheduledAt !== null && (
        <div className="space-y-2 rounded-[5px] border-2 border-foreground bg-destructive/15 p-3 nb-shadow-sm">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide">
            <AlertTriangle className="h-4 w-4" /> {t("Deletion scheduled")}
          </div>
          <div className="text-xs font-bold">
            {t("Your account will be permanently deleted in")}{" "}
            <span className="rounded-[3px] border-2 border-foreground bg-background px-1.5 py-0.5 font-mono">
              {formatRemaining(remaining)}
            </span>
          </div>
          {finalizeOn && (
            <div className="text-[11px] font-bold text-foreground/70">
              {t("Finalizes on")} {finalizeOn.toLocaleString()}
            </div>
          )}
          <button
            onClick={cancelDeletion}
            className="mt-1 w-full rounded-[5px] border-2 border-foreground bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Cancel deletion")}
          </button>
        </div>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[5px] border-2 border-foreground bg-secondary-background nb-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b-2 border-foreground bg-header px-4 py-3 text-header-foreground">
              {confirm === "delete" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <h3 className="text-sm font-extrabold uppercase tracking-wide">
                {confirm === "export" ? t("Confirm data export") : t("Confirm account deletion")}
              </h3>
            </div>
            <div className="space-y-3 p-4 text-sm">
              {confirm === "export" ? (
                <p>
                  {t(
                    "A JSON file containing your profile, preferences, and activity log will be downloaded to this device. Continue?",
                  )}
                </p>
              ) : (
                <>
                  <div className="rounded-[5px] border-2 border-foreground bg-destructive/15 p-3 text-xs font-bold">
                    {t(
                      "Your account enters a 7-day grace period. After 7 days it is permanently removed along with cases assigned only to you and your activity logs. You can cancel anytime during the grace period.",
                    )}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide">
                      {t("Type DELETE to confirm")}
                    </span>
                    <input
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm font-bold nb-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t-2 border-foreground bg-background px-4 py-3">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-2 text-xs font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              >
                {t("Cancel")}
              </button>
              {confirm === "export" ? (
                <button
                  onClick={doExport}
                  disabled={status.kind === "exporting"}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />{" "}
                  {status.kind === "exporting" ? t("Preparing…") : t("Download export")}
                </button>
              ) : (
                <button
                  onClick={doDelete}
                  disabled={typed !== "DELETE" || status.kind === "deleting"}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-destructive px-3 py-2 text-xs font-extrabold text-destructive-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />{" "}
                  {status.kind === "deleting" ? t("Scheduling…") : t("Schedule deletion (7 days)")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Translation Panel ─────────────────────────────────────────────────────
const ENRICH_KEY = "satyam.translation.enriched";

function TranslationPanel({ t }: { t: (s: string) => string }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [phase, setPhase] = useState("");           // current phase label
  const [phaseDetail, setPhaseDetail] = useState(""); // detailed step
  const [done, setDone] = useState(0);               // items translated so far
  const [total, setTotal] = useState(0);             // total items in current phase
  const [totalAll, setTotalAll] = useState(0);       // grand total across phases
  const [alreadyDone, setAlreadyDone] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ENRICH_KEY) === "1") setAlreadyDone(true);
    } catch {}
  }, []);

  async function runEnrichment() {
    setStatus("running");
    setDone(0); setTotal(0); setTotalAll(0);
    setPhase("Starting…"); setPhaseDetail("");

    try {
      // Phase 1: UI strings (~271 strings, ~14 batches)
      setPhase("Phase 1/2 — UI labels");
      let grandTotal = 0;
      const uiAdded = await enrichDictWithLLM((msg, n, tot) => {
        setPhaseDetail(msg);
        setDone(n);
        setTotal(tot);
      });
      grandTotal += uiAdded;
      setTotalAll(grandTotal);

      // Phase 2: Synthetic data values (station names, districts, crime types)
      setPhase("Phase 2/2 — Data values (stations, districts, crime types)");
      setDone(0); setTotal(0); setPhaseDetail("Fetching from database…");
      const dataAdded = await enrichDataWithLLM((msg, n, tot) => {
        setPhaseDetail(msg);
        setDone(n);
        setTotal(tot > 0 ? tot : n + 1);
      });
      grandTotal += dataAdded;
      setTotalAll(grandTotal);

      setStatus("done");
      setAlreadyDone(true);
      try { localStorage.setItem(ENRICH_KEY, "1"); } catch {}
    } catch (err) {
      setStatus("error");
      setPhaseDetail(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function resetEnrichment() {
    try {
      localStorage.removeItem(ENRICH_KEY);
      localStorage.removeItem("satyam.translation.llm-cache");
      localStorage.removeItem("satyam.data-translations");
      localStorage.removeItem("satyam.translation.misses");
    } catch {}
    setAlreadyDone(false);
    setStatus("idle");
    setPhase(""); setPhaseDetail("");
    setDone(0); setTotal(0); setTotalAll(0);
  }

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <Section
      title={t("Kannada Translation")}
      subtitle={t("Use Groq Llama-3.1-70B to fill in missing Kannada translations")}
    >
      {/* What this does */}
      <div className="rounded-[5px] border-2 border-foreground bg-primary/5 p-3 text-xs space-y-1.5">
        <div className="font-bold flex items-center gap-1.5">
          <Languages className="h-4 w-4 text-primary" />
          {t("How it works")}
        </div>
        <ul className="space-y-1 text-muted-foreground list-disc list-inside">
          <li>{t("Translates UI labels AND synthetic data values (station names, crime types, districts)")}</li>
          <li>{t("Sends untranslated strings to Groq Llama-3.1-70B in batches")}</li>
          <li>{t("Saves translations to your browser's local storage")}</li>
          <li>{t("Runs only once — uses cached result on every subsequent visit")}</li>
          <li>{t("New screens added later: switch to Kannada, browse those screens, then click Reset + Run")}</li>
        </ul>
      </div>

      {/* Progress block — visible while running */}
      {status === "running" && (
        <div className="space-y-2">
          {/* Phase label */}
          <div className="flex items-center gap-2 text-xs font-bold text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {phase}
          </div>
          {/* Progress bar */}
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden border border-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* Detail + count */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate max-w-[280px]">{phaseDetail}</span>
            <span className="shrink-0 font-mono font-bold">
              {done}/{total > 0 ? total : "?"} · {pct}%
            </span>
          </div>
          {totalAll > 0 && (
            <div className="text-[10px] text-success font-medium">
              ✓ {totalAll} {t("translations saved so far")}
            </div>
          )}
        </div>
      )}

      {/* Done */}
      {status === "done" && (
        <div className="rounded-[5px] border-2 border-success/40 bg-success/10 px-3 py-2 text-xs font-bold text-success flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" />
          {t("Done")} — {totalAll} {t("new translations added and saved to local storage")}
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="rounded-[5px] border-2 border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
          <div>{t("Error")}: {phaseDetail}</div>
          <div className="text-[10px] mt-1 font-normal opacity-80">
            Make sure GROQ_API_KEY is set in backend .env and the server is running.
          </div>
        </div>
      )}

      {/* Already done (idle state after previous run) */}
      {alreadyDone && status === "idle" && (
        <div className="rounded-[5px] border-2 border-success/30 bg-success/5 px-3 py-2 text-xs text-success font-medium flex items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {t("Enrichment already applied. All translations loaded from local storage.")}
        </div>
      )}

      {/* Action buttons — always show Run (even after done), always show Reset if done */}
      <div className="flex gap-2 flex-wrap">
        {status !== "running" && (
          <button
            onClick={runEnrichment}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[2px] hover:translate-y-[2px] hover:nb-shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            {alreadyDone ? t("Re-run enrichment") : t("Run Kannada enrichment")}
          </button>
        )}
        {(alreadyDone || status === "done") && status !== "running" && (
          <button
            onClick={resetEnrichment}
            className="flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-secondary-background px-3 py-2 text-xs font-bold nb-shadow-sm transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          >
            {t("Reset all cached translations")}
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {t("Translations are saved to localStorage and merged with the built-in DICT on every page load. They are never sent anywhere except the backend /settings/translate endpoint.")}
      </p>
    </Section>
  );
}
