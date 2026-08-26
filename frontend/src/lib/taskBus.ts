/**
 * Feedback loop for voice screen actions.
 *
 * WHY THIS EXISTS
 * `Shell.runScreenAgent` used to speak the planner's own `speak` line the moment
 * it dispatched `satyam:run-task`, so the officer heard "Setting the horizon to
 * 14 days" whether or not any screen was listening, whether or not the action
 * name was one that screen handles, and whether or not the parameter survived
 * validation. Every screen's handler is an if/else chain that silently falls off
 * the end on an unknown action, so the failure was invisible from the outside:
 * the confirmation was the plan being read back, not the result.
 *
 * Two events close the loop:
 *   satyam:screen-ready  — a screen announces its run-task listener is live, so
 *                          the Shell can dispatch on the ack instead of guessing
 *                          how long navigation takes.
 *   satyam:task-result   — what actually applied, so the spoken confirmation can
 *                          be the truth.
 *
 * Same window event-bus convention the rest of the app already uses (see
 * WAR_ROOM_EVENT in components/WarRoomMode.tsx), so there is no new machinery.
 */

export const SCREEN_READY_EVENT = "satyam:screen-ready";
export const TASK_RESULT_EVENT = "satyam:task-result";

export type TaskResult = {
  route: string;
  /** Action names that ran. */
  applied: string[];
  /** Action names that were rejected: wrong screen, unknown, or bad params. */
  skipped: string[];
};

/**
 * Coerce an LLM-supplied flag, or `undefined` when it is not a clear yes/no.
 *
 * `Boolean("no")` and `Boolean("false")` are both `true`, so a plain cast turned
 * every spoken "switch OFF the heatmap" into a switch-on. Params reach the screens
 * as whatever the model wrote, which for a boolean is usually a word.
 */
export function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v !== 0 : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "enable", "enabled", "show", "shown"].includes(s))
    return true;
  if (["0", "false", "no", "n", "off", "disable", "disabled", "hide", "hidden"].includes(s))
    return false;
  return undefined;
}

/** Tell the Shell this screen's `satyam:run-task` listener is attached. */
export function announceScreenReady(route: string): void {
  window.dispatchEvent(new CustomEvent(SCREEN_READY_EVENT, { detail: { route } }));
}

/**
 * Run a plan's actions for `route` and report what happened.
 *
 * `handle` returns `false` (or nothing, after an `else return false`) to mark an
 * action as skipped; any other return counts as applied. Returning a value is
 * cheaper than making every screen build its own tally, and it keeps each
 * handler the same if/else chain it already was.
 *
 * Note the report fires even when there are zero actions: "nothing to do" is a
 * result the Shell needs, otherwise it cannot tell an empty plan apart from a
 * screen that never received the event.
 */
export function runActions(
  route: string | readonly string[],
  detail: unknown,
  handle: (action: string, params: Record<string, unknown>) => boolean | void,
): TaskResult {
  // Forecast answers to both "/forecast" and the older "/trends", so a screen may
  // own more than one route name. The first is the canonical one for the report.
  const owned: readonly string[] = typeof route === "string" ? [route] : route;
  const raw = (detail as { actions?: unknown } | null)?.actions;
  const actions = Array.isArray(raw) ? raw : [];
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const a of actions) {
    const name = String((a as { action?: unknown })?.action ?? "?");
    const screen = (a as { screen?: unknown })?.screen;
    // An action with no `screen` belongs to the dispatched route: the event is
    // already route-scoped and every listener checks `detail.route` first.
    if (typeof screen === "string" && !owned.includes(screen)) {
      skipped.push(name);
      continue;
    }
    let ok: boolean | void = false;
    try {
      ok = handle(
        name,
        ((a as { params?: Record<string, unknown> })?.params ?? {}) as Record<string, unknown>,
      );
    } catch {
      // A throwing handler is a skip, not a dead turn: the remaining actions
      // still deserve their attempt and the officer still deserves a report.
      ok = false;
    }
    (ok === false ? skipped : applied).push(name);
  }

  // Report the route the plan was DISPATCHED for, not this screen's canonical
  // name, so the Shell can match the result to the plan it is waiting on. They
  // differ for the /trends alias that Forecast also answers to.
  const dispatched = (detail as { route?: unknown } | null)?.route;
  const result: TaskResult = {
    route: typeof dispatched === "string" ? dispatched : owned[0],
    applied,
    skipped,
  };
  window.dispatchEvent(new CustomEvent(TASK_RESULT_EVENT, { detail: result }));
  return result;
}
