/**
 * Self-check for lib/download.ts. No test framework — this file IS the check.
 *
 *   node --experimental-strip-types scripts/check-download.mjs
 *
 * It pins the two mistakes that made the AES-256 download silently do nothing:
 * the anchor must be IN the document when click() fires, and the object URL must
 * still be valid at that moment (the old code revoked it on the very next line).
 */
import assert from "node:assert/strict";

const log = [];
let revoked = null;
let anchor = null;

globalThis.URL = {
  ...URL,
  createObjectURL: () => "blob:fake",
  revokeObjectURL: (u) => (revoked = u),
};
globalThis.document = {
  body: {
    contains: (el) => log.includes(`append:${el.id}`) && !log.includes(`remove:${el.id}`),
    appendChild: (el) => log.push(`append:${el.id}`),
  },
  createElement: () => {
    anchor = {
      id: "a1",
      href: "",
      download: "",
      rel: "",
      click() {
        log.push("click");
        // The two properties that actually decide whether a download happens.
        assert.equal(
          globalThis.document.body.contains(this),
          true,
          "anchor must be attached to the document when click() fires",
        );
        assert.equal(revoked, null, "object URL must not be revoked before click()");
      },
      remove: () => log.push("remove:a1"),
    };
    return anchor;
  },
};

const timers = [];
globalThis.setTimeout = (fn, ms) => timers.push([fn, ms]);

const { saveBlob } = await import("../src/lib/download.ts");
saveBlob({ size: 9 }, "fir101-encrypted.pdf");

assert.deepEqual(log, ["append:a1", "click", "remove:a1"], "append → click → remove, in order");
assert.equal(anchor.download, "fir101-encrypted.pdf", "the download filename must be set");
assert.equal(anchor.href, "blob:fake");
assert.equal(revoked, null, "revoke must be deferred, not immediate");

// ...but it must still happen, or a 20 MB PDF leaks for the life of the tab.
assert.equal(timers.length, 1, "exactly one deferred revoke");
assert.ok(timers[0][1] >= 1000, "give the browser time to take the bytes");
timers[0][0]();
assert.equal(revoked, "blob:fake", "the object URL is released eventually");

console.log("check-download: PASS");
