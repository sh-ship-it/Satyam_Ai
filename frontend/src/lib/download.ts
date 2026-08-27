/**
 * Save a Blob to the officer's disk.
 *
 * WHY THIS EXISTS
 * Six screens had hand-rolled copies of this, and five of them shared two bugs
 * that silently produce "nothing happened" instead of an error:
 *
 *   1. The anchor was never added to the document. A detached <a>.click() is
 *      ignored outright by Firefox and by Chrome under some settings, so the
 *      download simply never starts.
 *   2. URL.revokeObjectURL was called synchronously on the next line. The download
 *      is asynchronous — revoking in the same tick can invalidate the URL before
 *      the browser has read it, which cancels the transfer that just succeeded.
 *
 * That is what made the AES-256 encrypt flow look broken: the request returned 200
 * with a valid PDF, and clicking Download did nothing at all.
 *
 * The revoke is deferred rather than dropped — skipping it leaks the blob (a 20 MB
 * PDF stays in memory for the life of the tab).
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 1s is comfortably past the point the browser has taken ownership of the bytes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
