/**
 * Always-on browser wake-word listener ("Satyam…" / "ಸತ್ಯಂ").
 *
 * This is a PURE module (no React). It owns a single continuous
 * SpeechRecognition session that runs quietly in the background. When it hears
 * the wake phrase it calls `onWake()`, which the Shell uses to arm the main
 * voice copilot mic.
 *
 * WHY THIS IS TRICKY (and why all the resilience code below exists):
 *   The Web Speech API's continuous recognizer is NOT actually continuous in
 *   practice. Chrome stops it on its own after a stretch of silence, on tab
 *   focus changes, and after transient network blips — each time firing `onend`
 *   (and sometimes a non-fatal `onerror` first). If we did nothing, the wake
 *   word would silently die after ~30-60s. So the core trick is: whenever the
 *   engine ends *while we still want to be listening*, we transparently restart
 *   it after a tiny delay. The only events that should permanently stop us are
 *   the explicit stop() call and hard permission errors.
 *
 *   We also must not run TWO recognizers at once — Chrome only allows one and
 *   they fight (each kills the other). So while the main copilot mic is open,
 *   the Shell calls pauseWakeWord(); we tear our recognizer down and only bring
 *   it back on resumeWakeWord().
 *
 * SSR-SAFE: every access to `window` is guarded so importing this module on the
 * server is harmless.
 *
 * All SpeechRecognition objects are typed as `any` so we don't need the DOM
 * speech typings (which aren't in the default lib set).
 */

/** Wake phrase (Latin/English). Matches "satyam" or "hey satyam" as words. */
const WAKE_REGEX = /(\bsatyam\b|\bhey satyam\b)/i;
/** Kannada spelling of "Satyam" — matched as a plain substring. */
const WAKE_KANNADA = "ಸತ್ಯಂ";
/** Min gap between two onWake() fires, to avoid machine-gunning the callback. */
const WAKE_DEBOUNCE_MS = 2500;
/** Delay before auto-restarting after onend, to avoid a tight restart loop. */
const RESTART_DELAY_MS = 300;

/** Resolve the platform SpeechRecognition constructor (SSR-safe). */
function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

/** True if this browser exposes a SpeechRecognition constructor. */
export function isWakeWordSupported(): boolean {
  return !!getSpeechRecognitionCtor();
}

// ── Module-level session state ──────────────────────────────────────────────
// There is exactly ONE wake-word session per page, so we keep its handles at
// module scope. pauseWakeWord()/resumeWakeWord() are free functions that act on
// this shared session (the Shell doesn't hold the recognizer instance itself).

/** True between startWakeWord() and the returned stop(). Gates auto-restart. */
let sessionActive = false;
/** True while the copilot mic owns the audio device; we stay silent + torn down. */
let paused = false;
/** The live recognizer instance (or null when not running). */
let recognition: any = null;
/** Pending restart timer, so we can cancel it on stop()/pause(). */
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** Timestamp of the last onWake() fire, for debouncing. */
let lastWakeAt = 0;
/** Config captured from the active startWakeWord() call. */
let activeLang = "en-IN";
let activeOnWake: (() => void) | null = null;

/** Cancel any scheduled auto-restart. */
function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

/** Tear down the current recognizer without ending the logical session. */
function teardownRecognition() {
  clearRestartTimer();
  const r = recognition;
  recognition = null;
  if (!r) return;
  // Detach handlers first so the abort()-triggered onend can't schedule a
  // restart on the instance we're discarding.
  try {
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
  } catch {
    /* ignore */
  }
  try {
    r.abort();
  } catch {
    /* ignore */
  }
}

/** Build, wire up, and start a fresh recognizer instance. */
function spinUpRecognition() {
  // Don't run while the session is stopped, while paused (copilot mic owns the
  // device), or if a recognizer is somehow already live.
  if (!sessionActive || paused || recognition) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return;

  let r: any;
  try {
    r = new Ctor();
  } catch {
    return;
  }
  r.lang = activeLang;
  r.continuous = true; // keep listening across utterances…
  r.interimResults = true; // …and surface partials so we catch the word fast.
  try {
    r.maxAlternatives = 1;
  } catch {
    /* some engines reject this — non-fatal */
  }

  // ── onresult: scan every (interim + final) transcript for the wake phrase ──
  r.onresult = (event: any) => {
    if (!sessionActive || paused) return; // ignore late events after stop/pause
    try {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alt = event.results[i][0];
        const transcript: string = (alt?.transcript ?? "").toLowerCase();
        if (!transcript) continue;
        const hit = WAKE_REGEX.test(transcript) || transcript.includes(WAKE_KANNADA);
        if (hit) {
          const now = Date.now();
          // Debounce: a single "Satyam" produces many interim results; only the
          // first within a 2.5s window should actually arm the copilot.
          if (now - lastWakeAt >= WAKE_DEBOUNCE_MS) {
            lastWakeAt = now;
            try {
              activeOnWake?.();
            } catch {
              /* never let a callback error kill the listener */
            }
          }
          break;
        }
      }
    } catch {
      /* malformed event — ignore and keep listening */
    }
  };

  // ── onerror: classify the error and decide whether to keep going ──────────
  r.onerror = (event: any) => {
    const err: string = event?.error || "";
    // Hard permission failures: the user/OS has denied mic access. Retrying is
    // pointless and would spam the console — permanently stop the session.
    if (err === "not-allowed" || err === "service-not-allowed") {
      sessionActive = false;
      teardownRecognition();
      return;
    }
    // Everything else ("no-speech", "aborted", "network", …) is transient. We
    // do nothing here; the engine will also fire onend, where the auto-restart
    // logic takes over.
  };

  // ── onend: the heart of the resilience strategy ───────────────────────────
  // Chrome ends the recognizer for many benign reasons. As long as we still
  // want to listen (session active + not paused), transparently restart after a
  // short delay so the wake word feels permanently on.
  r.onend = () => {
    if (recognition === r) recognition = null;
    if (!sessionActive || paused) return;
    clearRestartTimer();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spinUpRecognition();
    }, RESTART_DELAY_MS);
  };

  recognition = r;
  try {
    r.start();
  } catch {
    // start() throws if called too quickly after a previous stop ("already
    // started"). Treat like an onend: drop this instance and schedule a retry.
    if (recognition === r) recognition = null;
    clearRestartTimer();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spinUpRecognition();
    }, RESTART_DELAY_MS);
  }
}

/**
 * Start the always-on wake-word listener.
 *
 * @returns a stop() function that permanently ends the session and prevents any
 *          further auto-restart. Calling start again creates a new session.
 */
export function startWakeWord(opts: { lang?: string; onWake: () => void }): () => void {
  // No-op (but still return a valid stopper) when unsupported or on the server.
  if (!isWakeWordSupported()) {
    return () => {};
  }

  // If a session is already running, tear it down before starting fresh so we
  // never end up with two recognizers.
  if (sessionActive) {
    teardownRecognition();
  }

  activeLang = opts.lang || "en-IN";
  activeOnWake = opts.onWake;
  sessionActive = true;
  paused = false;
  lastWakeAt = 0;

  spinUpRecognition();

  return function stop() {
    sessionActive = false;
    activeOnWake = null;
    teardownRecognition();
  };
}

/**
 * Pause the wake word while the main copilot mic is actively listening.
 * Two recognizers fight over the audio device, so we fully tear ours down; it
 * will not fire onWake nor auto-restart until resumeWakeWord() is called.
 */
export function pauseWakeWord(): void {
  if (paused) return;
  paused = true;
  teardownRecognition(); // stop the underlying recognition while paused
}

/**
 * Resume the wake word after the copilot mic has been released. Only restarts
 * if a session is still active (i.e. startWakeWord() ran and stop() hasn't).
 */
export function resumeWakeWord(): void {
  if (!paused) return;
  paused = false;
  if (sessionActive) {
    spinUpRecognition(); // bring the recognizer back online
  }
}
