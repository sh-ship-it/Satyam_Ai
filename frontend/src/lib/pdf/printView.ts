/**
 * Print-to-PDF plumbing, shared by the conversation export and the translated
 * document export.
 *
 * WHY THE BROWSER AND NOT A PDF LIBRARY
 * Kannada is a complex script: `ಕ` + `್` + `ನ` must be composed into a single
 * conjunct glyph, which needs OpenType GSUB/GPOS shaping. A PDF written by
 * reportlab or plain pypdf has no shaper, so Kannada comes out as a row of
 * disconnected letters with the vowel marks in the wrong places — technically a
 * PDF, and unusable as a police document. The browser already has a shaper and the
 * system Kannada fonts, and every print dialog offers "Save as PDF", so routing
 * through print gives correct output with no dependency and no font to ship.
 *
 * The cost, stated plainly: this opens a print dialog instead of dropping a file in
 * the downloads folder. That is the tradeoff for text that is actually legible.
 */

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Kannada-capable stack. Noto Sans Kannada if the system has it, then the fonts
 * Windows ships (Tunga, Nirmala UI) — without one of these the browser falls back
 * to a font with no Kannada glyphs and renders tofu boxes.
 */
export const KANNADA_STACK =
  "'Noto Sans Kannada', 'Nirmala UI', Tunga, 'Segoe UI', Arial, sans-serif";

export function openPrint(title: string, inner: string, bodyFont?: string): void {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Allow pop-ups to export a PDF.");
    return;
  }
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    body { font-family: ${bodyFont || "'Segoe UI', Arial, sans-serif"}; max-width: 760px; margin: 0 auto; padding: 0; color: #0f172a; }
    @media print { body { max-width: 100%; } }
  </style>
</head>
<body>
  <div style="border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:20px">
    <div style="font-size:22px;font-weight:800;color:#4f46e5">Satyam — KSP Crime Intelligence</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">
      ${esc(title)} · generated ${esc(new Date().toLocaleString())} · Synthetic data only
    </div>
  </div>
  ${inner}
  <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center">
    CONFIDENTIAL — Karnataka State Police · Satyam Intelligence System · Datathon 2026
  </div>
</body>
</html>`);
  w.document.close();
  w.focus();
  // The document must have laid out before print() or the dialog previews a blank
  // page; 300ms is what the conversation export has used in practice.
  setTimeout(() => w.print(), 300);
}

/** Metadata worth carrying onto a page that may end up in a case file. */
export type TranslatedDocMeta = {
  filename: string;
  targetLang: "en" | "kn";
  sha256: string;
  pages: number;
  provider: string;
  /** Present once the digest has been appended to the audit chain. */
  sealShort?: string | null;
  sealAuditId?: number | null;
};

/**
 * The translated text as a print-ready page.
 *
 * The digest and seal reference are on the page deliberately: a translation is a
 * derived document, and without a pointer back to the sealed original it is just
 * unattributed text.
 */
export function exportTranslatedDocumentPdf(text: string, meta: TranslatedDocMeta): void {
  const langName = meta.targetLang === "kn" ? "Kannada (ಕನ್ನಡ)" : "English";
  const rows: [string, string][] = [
    ["Source file", meta.filename],
    ["Translated to", langName],
    ["Translated by", meta.provider],
    ["SHA-256 of source", meta.sha256],
  ];
  if (meta.pages) rows.push(["Pages", String(meta.pages)]);
  if (meta.sealShort) {
    rows.push(["Sealed to audit chain", `${meta.sealShort} · entry #${meta.sealAuditId ?? "?"}`]);
  }

  openPrint(
    `${meta.filename} — ${langName} translation`,
    `<table style="width:100%;border-collapse:collapse;font-size:10.5px;color:#475569;margin-bottom:16px">
      ${rows
        .map(
          ([k, v]) =>
            `<tr>
              <td style="padding:2px 10px 2px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(k)}</td>
              <td style="padding:2px 0;word-break:break-all;font-family:${k.startsWith("SHA") ? "monospace" : "inherit"}">${esc(v)}</td>
            </tr>`,
        )
        .join("")}
    </table>
    <div style="font-size:13px;line-height:1.85;white-space:pre-wrap;color:#0f172a">${esc(text)}</div>
    ${
      meta.sealShort
        ? ""
        : `<p style="margin-top:18px;font-size:10px;color:#b45309">
             This translation's source was not sealed to the audit chain, so no later
             alteration of the original can be proven.
           </p>`
    }`,
    KANNADA_STACK,
  );
}
