import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/trends` is now part of Early Warning & Forecast.
 *
 * Trend analysis and forecasting asked the same question from opposite ends of
 * the same data — "where has this been" and "where is this going" — and an officer
 * deciding where to put a patrol needs both at once. The two screens also shared a
 * filter bar, a KPI idiom, a refresh control and four separate implementations of a
 * horizontal bar. The content now lives in the Trends and Patterns tabs of
 * `/forecast`.
 *
 * WHY THIS FILE STILL EXISTS
 * Deleting it would regenerate `routeTree.gen.ts` cleanly, but `/trends` is still
 * named by the hands-free gesture ring, the voice screen-agent manifest, this
 * project's own docs, and any link an officer has bookmarked. A redirect keeps all
 * of those working instead of turning them into a 404, and costs one file.
 *
 * `beforeLoad` throws rather than returns — that is how TanStack Router signals a
 * redirect, and throwing means the component below is never reached. `replace`
 * keeps the dead route out of history, so Back does not bounce the officer
 * between the two paths.
 */
export const Route = createFileRoute("/trends")({
  beforeLoad: () => {
    throw redirect({ to: "/forecast", search: { tab: "trends" }, replace: true });
  },
});
