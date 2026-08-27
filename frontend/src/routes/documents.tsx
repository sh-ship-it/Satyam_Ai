import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileScan,
  FileText,
  Fingerprint,
  Languages,
  Loader2,
  ScanLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { useI18n } from "@/lib/i18n";
import { announceScreenReady, runActions } from "@/lib/taskBus";
import { documents, type TranslateDocResult, type VerifyResult } from "@/lib/api/documents";
import { saveBlob } from "@/lib/download";
import { exportTranslatedDocumentPdf } from "@/lib/pdf/printView";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENT TRANSLATION — upload · translate · seal · download
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Four capabilities on one screen, in the order an officer would use them.
 *
 * SEAL IS THE INTEGRITY CLAIM, AND IT IS THE ONE THIS SCREEN MAKES
 * Sealing appends the file's SHA-256 to the tamper-evident ledger Satyam already
 * maintains in `core/audit.py` — not a second chain bolted on beside it. It proves
 * the document was not altered after that moment.
 *
 * There is deliberately NO encryption here. An AES-256 PDF password was built and
 * then removed at the user's request. Worth keeping straight if it is ever
 * revisited: a password gives CONFIDENTIALITY (stops a reader, proves nothing about
 * tampering) and is a different guarantee from integrity, not a stronger version of
 * it. For a document that may reach a court, integrity is the claim that carries.
 *
 * WHAT LEAVES THE SCREEN IS THE TRANSLATION, NOT THE UPLOAD
 * The officer already has the file they uploaded, so the download buttons carry the
 * translated text. The PDF is composed by the browser and saved from its print
 * dialog because Kannada conjuncts need OpenType shaping, which a server-side PDF
 * writer does not do — see lib/pdf/printView.ts.
 *
 * NOTHING IS STORED SERVER-SIDE
 * The backend holds no uploads. Bytes live in the request; the audit row keeps only
 * the digest, filename and note. That keeps real case content out of a repository
 * whose data is synthetic, and off the Neon storage budget (~427 MB of 512 MB).
 *
 * ANIMATION IS STATE, NOT DECORATION
 * Each animated element reports something real: the scan line runs only while the
 * server is actually working, and stage ticks land as each stage completes.
 * A spinner that keeps moving after a request has failed teaches officers to
 * distrust the UI, so every motion here is tied to a state transition.
 */

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Document Translation · Satyam" },
      {
        name: "description",
        content:
          "Translate police documents to Kannada, seal them to the tamper-evident audit chain, and download the translation.",
      },
    ],
  }),
  component: DocumentsScreen,
});

/* Keyframes live with the component that owns them. Tailwind ships pulse/ping/spin
   but not a scan sweep or a progress-bar hatch. */
const CSS = `
@keyframes doc-scan {
  0%   { transform: translateY(-110%); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translateY(510%); opacity: 0; }
}
@keyframes doc-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes doc-ring {
  0%   { transform: scale(.7); opacity: .8; }
  100% { transform: scale(2.1); opacity: 0; }
}
@keyframes doc-bar { 0% { background-position: 0 0 } 100% { background-position: 34px 0 } }
/* currentColor, not hsl(var(--primary)): the theme tokens are not guaranteed to be
   raw HSL triplets across all 13 themes, and a malformed gradient renders as a
   blank strip. Inheriting the element's own colour works under every theme. */
.doc-scan   { animation: doc-scan 1.5s cubic-bezier(.4,0,.6,1) infinite; }
.doc-rise   { animation: doc-rise .28s ease-out both; }
.doc-ring   { animation: doc-ring 1.5s ease-out infinite; }
.doc-bar {
  background-image: repeating-linear-gradient(115deg,
    currentColor 0 8px, transparent 8px 17px);
  background-size: 34px 100%;
  animation: doc-bar .7s linear infinite;
  opacity: .8;
}
@media (prefers-reduced-motion: reduce) {
  .doc-scan, .doc-ring, .doc-bar { animation: none !important; }
}
`;

type Stage = "idle" | "reading" | "extracting" | "translating" | "done" | "failed";

const FLOW: { key: Stage; label: string; icon: typeof Upload }[] = [
  { key: "reading", label: "Reading file", icon: Upload },
  { key: "extracting", label: "Extracting text", icon: FileScan },
  { key: "translating", label: "Translating", icon: Languages },
];

const MAX_MB = 20;

function DocumentsScreen() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslateDocResult | null>(null);
  const [target, setTarget] = useState<"kn" | "en">("kn");

  const [sealed, setSealed] = useState<{ short: string; auditId: number } | null>(null);
  const [sealing, setSealing] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  /** Stem of the uploaded name, reused for both translation downloads. */
  const outName = (ext: string) =>
    `${(result?.filename || file?.name || "document").replace(/\.[^.]+$/, "")}-${target}${ext}`;

  /**
   * The translation as a print-ready page. Not a server-generated PDF: Kannada
   * conjuncts need OpenType shaping and a server-side PDF writer has no shaper, so
   * it would emit a legible-looking file full of broken glyphs. The browser shapes
   * it correctly and its print dialog saves it.
   */
  const savePdf = () => {
    if (!result) return;
    exportTranslatedDocumentPdf(result.translated_text, {
      filename: result.filename,
      targetLang: target,
      sha256: result.sha256,
      pages: result.pages,
      provider: result.provider,
      sealShort: sealed?.short ?? null,
      sealAuditId: sealed?.auditId ?? null,
    });
  };

  /**
   * A real one-click file, for when the officer wants the words rather than a
   * document. The BOM is deliberate: without it Excel and Notepad on Windows read
   * UTF-8 Kannada as mojibake, which looks like a translation failure.
   */
  const saveTxt = () => {
    if (!result) return;
    saveBlob(
      new Blob([`\uFEFF${result.translated_text}`], { type: "text/plain;charset=utf-8" }),
      outName(".txt"),
    );
  };

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setResult(null);
    setSealed(null);
    setVerify(null);
  }, []);

  const choose = useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      reset();
      // Checked client-side purely so the officer gets an instant answer; the
      // server enforces the same cap and validates magic bytes, which a browser
      // cannot be trusted to do.
      if (f.size > MAX_MB * 1024 * 1024) {
        setFile(null);
        setError(t("That file is larger than the 20 MB limit."));
        return;
      }
      setFile(f);
    },
    [reset, t],
  );

  const run = useCallback(async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    setSealed(null);
    setVerify(null);
    setStage("reading");
    try {
      // One request does read + extract + translate, so these two stages are
      // shown on a short timer to reflect the server's real order of work rather
      // than pretending to measure it. The final stage flips on the response.
      setTimeout(() => setStage((s) => (s === "reading" ? "extracting" : s)), 380);
      setTimeout(() => setStage((s) => (s === "extracting" ? "translating" : s)), 900);
      const r = await documents.translate(file, target === "kn" ? "en" : "kn", target);
      setResult(r);
      setStage("done");
    } catch (e) {
      setError((e as Error)?.message || t("Something went wrong."));
      setStage("failed");
    }
  }, [file, target, t]);

  const doSeal = useCallback(async () => {
    if (!result) return;
    setSealing(true);
    setError(null);
    try {
      const s = await documents.seal(result.sha256, result.filename, `Kannada translation sealed`);
      setSealed({ short: s.short, auditId: s.audit_id });
    } catch (e) {
      setError((e as Error)?.message || t("Sealing failed."));
    } finally {
      setSealing(false);
    }
  }, [result, t]);

  const doVerify = useCallback(async () => {
    if (!result) return;
    try {
      setVerify(await documents.verify(result.sha256));
    } catch (e) {
      setError((e as Error)?.message || t("Verification failed."));
    }
  }, [result, t]);

  /* ── Voice actions ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/documents") return;
      runActions("/documents", d, (action, p) => {
        if (action === "pick_file") inputRef.current?.click();
        else if (action === "set_target" && p.lang) {
          const l = String(p.lang).toLowerCase().startsWith("kn") ? "kn" : "en";
          setTarget(l);
        } else if (action === "translate") {
          // Only actionable with a file chosen; report a miss otherwise so the
          // copilot says so instead of confirming nothing.
          if (!file) return false;
          void run();
        } else if (action === "seal") {
          if (!result) return false;
          void doSeal();
        } else if (action === "verify") {
          if (!result) return false;
          void doVerify();
        } else if (action === "download") {
          if (!result) return false;
          savePdf();
        } else return false;
      });
    };
    window.addEventListener("satyam:run-task", onTask);
    announceScreenReady("/documents");
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [file, result, run, doSeal, doVerify]);

  const busy = stage === "reading" || stage === "extracting" || stage === "translating";
  const stageIdx = FLOW.findIndex((f) => f.key === stage);

  return (
    <Shell>
      <style>{CSS}</style>
      <div className="h-[calc(100vh-3.5rem)] overflow-auto bg-background">
        <div className="mx-auto max-w-[1500px] px-6 py-5">
          {/* ══ Header ══════════════════════════════════════════════════════ */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h1 className="text-lg font-extrabold tracking-tight text-foreground">
                  {t("Document Translation")}
                </h1>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(
                  "Translate a document to Kannada, seal it to the tamper-evident audit chain, then download the translation.",
                )}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {t("Synthetic / test documents only")}
            </span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[400px_1fr]">
            {/* ══ Left: upload + actions ════════════════════════════════════ */}
            <div className="space-y-3">
              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  choose(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !busy && inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
                }}
                aria-label={t("Choose a document to upload")}
                className={`relative cursor-pointer overflow-hidden rounded-lg border-2 border-dashed p-6 text-center transition ${
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50"
                } ${busy ? "pointer-events-none" : ""}`}
              >
                {/* Scan sweep — visible ONLY while the server is working, so the
                    motion is a status report and not decoration. */}
                {busy && (
                  <span
                    aria-hidden
                    className="doc-scan pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
                  />
                )}
                <div className="relative">
                  <div className="relative mx-auto grid h-12 w-12 place-items-center">
                    {dragging && (
                      <span
                        aria-hidden
                        className="doc-ring absolute inset-0 rounded-full border-2 border-primary"
                      />
                    )}
                    <div
                      className={`grid h-12 w-12 place-items-center rounded-full border-2 transition ${
                        dragging
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      ) : (
                        <Upload className="h-5 w-5" />
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-bold text-foreground">
                    {file ? file.name : t("Drop a PDF here, or click to choose")}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {file
                      ? `${(file.size / 1024).toFixed(0)} KB`
                      : t("PDF or .txt · up to 20 MB · nothing is stored on the server")}
                  </p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,text/plain,.pdf,.txt"
                  className="hidden"
                  onChange={(e) => choose(e.target.files?.[0])}
                />
              </div>

              {/* Target language */}
              <div className="flex items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1">
                <span className="mr-0.5 text-[10px] font-semibold text-muted-foreground">
                  {t("Translate to")}
                </span>
                {(
                  [
                    { v: "kn", label: "ಕನ್ನಡ" },
                    { v: "en", label: "English" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setTarget(o.v)}
                    className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                      target === o.v
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => void run()}
                disabled={!file || busy}
                className="nb-press flex w-full items-center justify-center gap-2 rounded-md border-2 border-foreground bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {busy ? t("Working…") : t("Extract & translate")}
              </button>

              {/* Stage flow — ticks land as each stage completes */}
              {stage !== "idle" && (
                <div className="doc-rise space-y-1.5 rounded-lg border border-border bg-card p-3">
                  {FLOW.map((s, i) => {
                    const active = stage === s.key;
                    const done = stage === "done" || (stageIdx > i && stageIdx !== -1);
                    return (
                      <div key={s.key} className="flex items-center gap-2">
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
                            done
                              ? "border-success bg-success/15 text-success"
                              : active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground/50"
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : active ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <s.icon className="h-3 w-3" />
                          )}
                        </span>
                        <span
                          className={`text-[11px] font-semibold ${
                            done || active ? "text-foreground" : "text-muted-foreground/60"
                          }`}
                        >
                          {t(s.label)}
                        </span>
                      </div>
                    );
                  })}
                  {busy && (
                    <div aria-hidden className="doc-bar mt-1 h-1 rounded-full text-primary" />
                  )}
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="doc-rise flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-[11px] font-semibold text-destructive"
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Integrity + confidentiality */}
              {result && !result.needs_ocr && (
                <div className="doc-rise space-y-2.5 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-1.5">
                    <Fingerprint className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                      {t("Integrity")}
                    </span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {t(
                      "Sealing appends this document's SHA-256 to the hash-chained audit log. It proves the file was not altered — it does not hide the contents.",
                    )}
                  </p>
                  <code className="block break-all rounded bg-muted/60 px-2 py-1 font-mono text-[9.5px] text-foreground/80">
                    {result.sha256}
                  </code>

                  {sealed ? (
                    <div className="flex items-start gap-2 rounded-md bg-success/10 p-2 text-[10px] font-semibold text-success">
                      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t("Sealed to the audit chain")} · #{sealed.auditId}
                        <br />
                        <span className="font-mono">{sealed.short}…</span>
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => void doSeal()}
                      disabled={sealing}
                      className="nb-press flex w-full items-center justify-center gap-2 rounded-md border-2 border-foreground bg-secondary-background px-3 py-1.5 text-[11px] font-bold text-foreground transition disabled:opacity-40"
                    >
                      {sealing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {t("Seal to audit chain")}
                    </button>
                  )}

                  <button
                    onClick={() => void doVerify()}
                    className="w-full rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                  >
                    {t("Verify this document")}
                  </button>

                  {verify && (
                    <div
                      className={`doc-rise rounded-md p-2 text-[10px] font-semibold ${
                        verify.found && verify.link_intact
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {verify.detail}
                    </div>
                  )}

                  {/* ── Take the TRANSLATION away, not the upload ─────────────
                      The officer already has the file they uploaded; handing it
                      back is the one thing these buttons must not do. Both of
                      these carry the translated text. */}
                  <div className="border-t border-border pt-2.5">
                    <div className="flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5 text-primary" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                        {t("Download the translation")}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {target === "kn"
                        ? t("The Kannada text, carrying the source digest and seal reference.")
                        : t("The English text, carrying the source digest and seal reference.")}
                    </p>

                    <button
                      onClick={savePdf}
                      className="nb-press mt-2 flex w-full items-center justify-center gap-2 rounded-md border-2 border-foreground bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground transition"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {t("Translated PDF")}
                    </button>
                    {/* Kannada needs OpenType shaping, which a server-side PDF
                        writer does not do — so the page is composed by the browser
                        and saved from its print dialog. Said out loud here so the
                        dialog is expected rather than surprising. */}
                    <p className="mt-1 text-[9.5px] leading-relaxed text-muted-foreground">
                      {t(
                        "Opens the print dialog — choose \u201cSave as PDF\u201d as the destination.",
                      )}
                    </p>

                    <button
                      onClick={saveTxt}
                      className="nb-press mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("Translated text (.txt)")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ══ Right: text panes ═════════════════════════════════════════ */}
            <div className="min-w-0">
              {result?.needs_ocr ? (
                <div className="doc-rise flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
                  <ScanLine className="h-8 w-8 text-amber-500" />
                  <p className="text-sm font-bold text-foreground">
                    {t("This looks like a scan — no text layer found")}
                  </p>
                  <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
                    {t(
                      "The file opened correctly but carries no selectable text, so there is nothing to translate yet. Scanned and handwritten pages need OCR, which is the next step planned for this screen.",
                    )}
                  </p>
                </div>
              ) : result ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Pane
                    title={t("Original")}
                    body={result.source_text}
                    meta={`${result.pages ? `${result.pages} ${t("pages")} · ` : ""}${result.chars_translated.toLocaleString()} ${t("chars")}`}
                    t={t}
                  />
                  <Pane
                    title={target === "kn" ? t("Kannada translation") : t("English translation")}
                    body={result.translated_text}
                    meta={result.provider}
                    accent
                    t={t}
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
                  <FileText className="h-7 w-7 text-muted-foreground/40" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    {t("The original and its translation will appear here.")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Pane({
  title,
  body,
  meta,
  accent,
  t,
}: {
  title: string;
  body: string;
  meta?: string;
  accent?: boolean;
  t: (s: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section
      className={`doc-rise flex min-h-[300px] flex-col rounded-lg border bg-card p-3 ${
        accent ? "border-primary/40" : "border-border"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-foreground">
            {title}
          </h2>
          {meta && <p className="truncate text-[10px] text-muted-foreground">{meta}</p>}
        </div>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(body).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <CheckCircle2 className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      <div className="max-h-[58vh] flex-1 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2.5 text-[11.5px] leading-relaxed text-foreground">
        {body || t("(empty)")}
      </div>
    </section>
  );
}
