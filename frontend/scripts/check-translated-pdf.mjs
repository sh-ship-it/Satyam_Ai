/**
 * Self-check for exportTranslatedDocumentPdf. No test framework — this file IS it.
 *
 *   node --experimental-strip-types scripts/check-translated-pdf.mjs
 *
 * The bug it pins is the one that was actually reported: the download handed back
 * the file that was uploaded instead of the translation. So the assertion that
 * matters is that the printed page contains the translated text and NOT the source
 * text.
 */
import assert from "node:assert/strict";

let written = "";
let printed = false;

globalThis.window = {
  open: () => ({
    document: { write: (h) => (written += h), close: () => {} },
    focus: () => {},
    print: () => (printed = true),
  }),
};
globalThis.setTimeout = (fn) => fn();

const { exportTranslatedDocumentPdf, KANNADA_STACK } = await import("../src/lib/pdf/printView.ts");

const KANNADA = "ಕಳ್ಳತನದ ಪ್ರಕರಣ — ಹದಿನಾಲ್ಕನೇ ತಾರೀಖು";
const SOURCE = "A theft case on the fourteenth.";

exportTranslatedDocumentPdf(KANNADA, {
  filename: "fir101.pdf",
  targetLang: "kn",
  sha256: "a".repeat(64),
  pages: 2,
  provider: "SarvamTranslator",
  sealShort: "7a96 e121 df38 aa35",
  sealAuditId: 179,
});

assert.ok(written.includes(KANNADA), "the page must contain the TRANSLATED text");
assert.ok(!written.includes(SOURCE), "the page must not carry the untranslated source");
assert.ok(
  written.includes(KANNADA_STACK),
  "a Kannada-capable font stack, or glyphs render as tofu",
);
assert.ok(written.includes('charset="utf-8"') || written.includes("charset=utf-8"));
assert.ok(written.includes("a".repeat(64)), "source digest ties the translation to its original");
assert.ok(written.includes("7a96 e121 df38 aa35"), "seal reference is provenance, not decoration");
assert.ok(written.includes("fir101.pdf"));
assert.equal(printed, true, "the print dialog must actually be opened");

// An unsealed source has to say so — silence would imply provenance it lacks.
written = "";
exportTranslatedDocumentPdf("ಪಠ್ಯ", {
  filename: "x.pdf",
  targetLang: "kn",
  sha256: "b".repeat(64),
  pages: 0,
  provider: "SarvamTranslator",
});
assert.ok(written.includes("was not sealed"), "an unsealed source must be flagged on the page");
assert.ok(!written.includes("Sealed to audit chain"), "no seal row when there is no seal");

// Text from a document is untrusted input: it must not become live markup.
written = "";
exportTranslatedDocumentPdf('<script>alert(1)</script> & "quoted"', {
  filename: "<b>x</b>.pdf",
  targetLang: "en",
  sha256: "c".repeat(64),
  pages: 1,
  provider: "p",
});
assert.ok(!written.includes("<script>"), "document text must be escaped, not injected");
assert.ok(written.includes("&lt;script&gt;"));
assert.ok(!written.includes("<b>x</b>.pdf"), "the filename is escaped too");

console.log("check-translated-pdf: PASS");
