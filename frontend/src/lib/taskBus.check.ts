/**
 * Runnable self-check for taskBus. No framework — the frontend has no test
 * runner and adding one is out of scope.
 *
 *   cd frontend
 *   node --experimental-strip-types src/lib/taskBus.check.ts
 *
 * Exits non-zero on the first failed assertion. What it guards:
 *   - a boolean flag spoken as a word ("no", "off") is not read as `true`,
 *     which is the bug that made "switch off the heatmap" switch it on;
 *   - an unhandled or badly-parameterised action lands in `skipped`, because
 *     that list is the only thing standing between the officer and a spoken
 *     confirmation of something that never happened;
 *   - the result carries the DISPATCHED route, which is how the Shell matches a
 *     result to the plan it is waiting on.
 */
import assert from "node:assert/strict";

// taskBus needs `window.dispatchEvent`; node has EventTarget and CustomEvent
// globally, which is the whole of the surface used here.
(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

const { asBool, runActions, TASK_RESULT_EVENT } = await import("./taskBus.ts");

// ── asBool ───────────────────────────────────────────────────────────────────
for (const yes of [true, 1, "true", "YES", " on ", "enabled", "show"]) {
  assert.equal(asBool(yes), true, `expected truthy for ${JSON.stringify(yes)}`);
}
for (const no of [false, 0, "false", "NO", " off ", "disabled", "hide"]) {
  assert.equal(asBool(no), false, `expected falsey for ${JSON.stringify(no)}`);
}
for (const junk of [undefined, null, "", "maybe", {}, NaN]) {
  assert.equal(asBool(junk), undefined, `expected undefined for ${JSON.stringify(junk)}`);
}

// ── runActions ───────────────────────────────────────────────────────────────
const act = (action: string, screen?: string, params: Record<string, unknown> = {}) => ({
  action,
  screen,
  params,
});

// Applied vs skipped, and an action for another screen never runs here.
{
  const ran: string[] = [];
  const r = runActions(
    "/news",
    { route: "/news", actions: [act("mute", "/news"), act("bogus", "/news"), act("mute", "/map")] },
    (action) => {
      if (action !== "mute") return false;
      ran.push(action);
    },
  );
  assert.deepEqual(ran, ["mute"], "only the handled action should run");
  assert.deepEqual(r.applied, ["mute"]);
  assert.deepEqual(r.skipped, ["bogus", "mute"], "unknown + wrong-screen are both skips");
}

// An action with no explicit screen belongs to the dispatched route.
{
  const r = runActions(
    "/vision",
    { route: "/vision", actions: [act("set_view", undefined)] },
    () => true,
  );
  assert.deepEqual(r.applied, ["set_view"]);
}

// A screen owning two route names accepts both, and reports the dispatched one.
{
  const r = runActions(
    ["/forecast", "/trends"],
    { route: "/trends", actions: [act("refresh", "/trends")] },
    () => true,
  );
  assert.deepEqual(r.applied, ["refresh"]);
  assert.equal(r.route, "/trends", "the Shell matches on the route it dispatched");
}

// A throwing handler is a skip, and it does not abandon the actions after it.
{
  const r = runActions(
    "/board",
    { route: "/board", actions: [act("save", "/board"), act("new", "/board")] },
    (action) => {
      if (action === "save") throw new Error("editor not ready");
      return true;
    },
  );
  assert.deepEqual(r.skipped, ["save"]);
  assert.deepEqual(r.applied, ["new"], "a throw must not swallow the rest of the plan");
}

// An empty plan still reports, or the Shell cannot tell it apart from a screen
// that never received the event.
{
  let heard: unknown = null;
  const onResult = (e: Event) => {
    heard = (e as CustomEvent).detail;
  };
  window.addEventListener(TASK_RESULT_EVENT, onResult);
  runActions("/reports", { route: "/reports", actions: [] }, () => true);
  window.removeEventListener(TASK_RESULT_EVENT, onResult);
  assert.deepEqual(heard, { route: "/reports", applied: [], skipped: [] });
}

console.log("taskBus.check: all assertions passed");
