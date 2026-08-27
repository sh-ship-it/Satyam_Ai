/**
 * Self-check for the Indic language list behind the Document Translation marquee.
 *
 *   node --experimental-strip-types scripts/check-languages.mjs
 *
 * The claim worth pinning is not the styling, it is the DATA. This list sits under
 * a translation tool, so a wrong `live` flag advertises a capability the backend
 * does not have, and a duplicate code silently renders the same chip twice.
 */
import assert from "node:assert/strict";

const { SARVAM_LANGUAGES } = await import("../src/lib/languages.ts");

// The 23 in the Sarvam picker, transcribed from it.
const EXPECTED = [
  "hi-IN",
  "bn-IN",
  "ta-IN",
  "te-IN",
  "mr-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "as-IN",
  "ur-IN",
  "sa-IN",
  "ne-IN",
  "doi-IN",
  "brx-IN",
  "pa-IN",
  "od-IN",
  "kok-IN",
  "mai-IN",
  "sd-IN",
  "ks-IN",
  "mni-IN",
  "sat-IN",
  "en-IN",
];

const codes = SARVAM_LANGUAGES.map((l) => l.code);
assert.deepEqual(codes, EXPECTED, "codes and their order must match the picker");
assert.equal(new Set(codes).size, codes.length, "a duplicate code renders a chip twice");

for (const l of SARVAM_LANGUAGES) {
  assert.ok(l.native.trim(), `${l.code} needs an endonym`);
  assert.ok(l.english.trim(), `${l.code} needs an English name`);
  assert.match(l.code, /^[a-z]{2,3}-IN$/, `${l.code} is not a well-formed tag`);
}

// Only the two the backend actually wires may be marked live. If translation ever
// grows past en/kn this assertion should be UPDATED, not deleted — that is the
// point of it.
const live = SARVAM_LANGUAGES.filter((l) => l.live).map((l) => l.code);
assert.deepEqual(live, ["kn-IN", "en-IN"], "only wired languages may be marked live");

// Every non-English entry should be in its own script, not transliterated Latin —
// a Latin-only endonym means the wrong string was pasted in.
for (const l of SARVAM_LANGUAGES) {
  if (l.code === "en-IN") continue;
  assert.ok(
    /[^\u0000-\u024F]/u.test(l.native),
    `${l.code} endonym "${l.native}" looks like Latin text, not its own script`,
  );
}

// Kannada is the screen's default target, so its absence would be a real bug.
const kn = SARVAM_LANGUAGES.find((l) => l.code === "kn-IN");
assert.equal(kn.native, "ಕನ್ನಡ");
assert.equal(kn.live, true);

console.log(`check-languages: PASS (${SARVAM_LANGUAGES.length} languages, ${live.length} live)`);
