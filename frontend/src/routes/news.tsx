import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Radio, RefreshCw, Tv, Volume2, VolumeX, WifiOff } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useI18n } from "@/lib/i18n";
import { news, type NewsChannel } from "@/lib/api/news";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NEWS FEED — live Karnataka news television
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A viewing screen, not a data screen. No crime data is read and nothing is
 * written to the case database — real reporting about real people has no place
 * in a repository whose every other row is synthetic.
 *
 * WHY THERE IS A BACKEND CALL HERE
 * The first version embedded `youtube.com/embed/live_stream?channel=<id>` and
 * needed no backend at all. That endpoint is dead: it answers 200 with a player
 * shell containing no config, and every player rendered "This video is
 * unavailable". `embed/<videoId>` still works, so the id of the *current*
 * broadcast has to be resolved first, and a browser cannot do that itself
 * because youtube.com sends no CORS headers.
 *
 * So `/api/news/channels` resolves ids server-side and caches them for three
 * minutes. It writes nothing and stores nothing beyond that in-process cache.
 *
 * OFF-AIR IS A REAL STATE, SHOWN AS ONE
 * These channels restart their 24/7 stream several times a day. The backend
 * reports `live: false` when a channel has no current broadcast, and this screen
 * shows an off-air card with a link out rather than mounting an iframe that
 * would render as a YouTube error. Measured at build time: 8 of 10 live.
 */

type Search = { ch?: string };

export const Route = createFileRoute("/news")({
  // The channel rides in the URL so a channel is a shareable link and voice can
  // land on one directly. Only the shape is validated here — the value is
  // matched against the server's channel list before it reaches an iframe src,
  // so an arbitrary string can never become an embed target.
  validateSearch: (search: Record<string, unknown>): Search => ({
    ch: typeof search.ch === "string" && /^[a-z0-9]{1,20}$/.test(search.ch) ? search.ch : undefined,
  }),
  head: () => ({
    meta: [
      { title: "News Feed · Satyam" },
      {
        name: "description",
        content: "Live Karnataka news television channels, streamed for situational awareness.",
      },
    ],
  }),
  component: NewsScreen,
});

function NewsScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { ch } = Route.useSearch();

  const [channels, setChannels] = useState<NewsChannel[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [muted, setMuted] = useState(true);
  const [playerKey, setPlayerKey] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setState((s) => (s === "ready" ? s : "loading"));
    try {
      const r = await news.channels(refresh);
      setChannels(r.channels);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-resolve a little after the server cache expires, so a channel that comes
  // back on air starts working without a manual reload.
  useEffect(() => {
    const id = setInterval(() => void load(), 200_000);
    return () => clearInterval(id);
  }, [load]);

  // Prefer the requested channel, else the first channel that is actually live,
  // else the first one. Landing on an off-air channel by default would look like
  // the screen is broken, which is the whole failure this replaced.
  const active = useMemo(() => {
    if (!channels.length) return null;
    return channels.find((c) => c.slug === ch) ?? channels.find((c) => c.live) ?? channels[0];
  }, [channels, ch]);

  const select = useCallback(
    (slug: string) => {
      navigate({ to: "/news", search: { ch: slug }, replace: true });
    },
    [navigate],
  );

  useEffect(() => setFrameLoading(true), [active?.video_id, muted, playerKey]);

  /* ── Voice actions ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/news") return;
      for (const a of Array.isArray(d.actions) ? d.actions : []) {
        if (a.screen !== "/news") continue;
        const p = a.params || {};
        if (a.action === "set_channel" && p.channel) {
          // Spoken names arrive loosely ("put on public tv"), so match on a
          // normalised substring in both directions rather than equality.
          const q = String(p.channel)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const hit = channels.find((c) => {
            const n = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            return q.length > 1 && (n.includes(q) || q.includes(c.slug));
          });
          if (hit) select(hit.slug);
        } else if (a.action === "next_channel") {
          // Skip off-air channels: "next channel" should land on something watchable.
          const liveList = channels.filter((c) => c.live);
          const pool = liveList.length ? liveList : channels;
          const i = pool.findIndex((c) => c.slug === active?.slug);
          if (pool.length) select(pool[(i + 1 + pool.length) % pool.length].slug);
        } else if (a.action === "mute") setMuted(true);
        else if (a.action === "unmute") setMuted(false);
        else if (a.action === "refresh") void load(true);
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [channels, active?.slug, select, load]);

  const liveCount = channels.filter((c) => c.live).length;

  return (
    <Shell>
      <div className="h-[calc(100vh-3.5rem)] overflow-auto bg-background">
        <div className="mx-auto max-w-[1500px] px-6 py-5">
          {/* ══ Header ══════════════════════════════════════════════════════ */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Tv className="h-4 w-4 text-primary" />
                <h1 className="text-lg font-extrabold tracking-tight text-foreground">
                  {t("News Feed")}
                </h1>
                {liveCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                    {liveCount} {t("LIVE")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("Karnataka news television, streamed live for situational awareness.")}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setMuted((m) => !m)}
                disabled={!active?.live}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-40"
                aria-label={muted ? t("Unmute") : t("Mute")}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {muted ? t("Unmute") : t("Mute")}
              </button>
              <button
                onClick={() => {
                  setPlayerKey((n) => n + 1);
                  void load(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("Reload")}
              </button>
            </div>
          </div>

          {/* ══ Player + channel rail ═══════════════════════════════════════ */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_270px]">
            <div className="min-w-0">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="relative aspect-video w-full bg-black">
                  {state === "failed" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                      <WifiOff className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[12px] font-semibold text-foreground">
                        {t("Could not reach the channel service")}
                      </span>
                      <button
                        onClick={() => void load(true)}
                        className="mt-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                      >
                        {t("Retry")}
                      </button>
                    </div>
                  ) : state === "loading" || !active ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <Radio className="h-5 w-5 animate-pulse text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">
                        {t("Finding live channels…")}
                      </span>
                    </div>
                  ) : !active.live || !active.video_id ? (
                    /* Off air: no iframe at all. Mounting one would show
                       YouTube's own error and read as a broken screen. */
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                      <WifiOff className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[12px] font-semibold text-foreground">
                        {active.name} {t("is off air")}
                      </span>
                      <span className="max-w-sm text-[10.5px] leading-relaxed text-muted-foreground">
                        {t(
                          "This channel is between broadcasts. Pick a channel marked ON AIR, or reload in a moment.",
                        )}
                      </span>
                      <a
                        href={`https://www.youtube.com/channel/${active.channel_id}/live`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("Open on YouTube")}
                      </a>
                    </div>
                  ) : (
                    <>
                      {frameLoading && (
                        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black">
                          <Radio className="h-5 w-5 animate-pulse text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">
                            {t("Tuning in to")} {active.name}…
                          </span>
                        </div>
                      )}
                      <iframe
                        // Keyed on the resolved video id: the embed binds to one
                        // broadcast, so a channel switch must remount, not just
                        // change props.
                        key={`${active.video_id}:${muted ? "m" : "s"}:${playerKey}`}
                        src={
                          `https://www.youtube-nocookie.com/embed/${active.video_id}` +
                          `?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`
                        }
                        title={`${active.name} — ${t("live stream")}`}
                        className="absolute inset-0 h-full w-full"
                        onLoad={() => setFrameLoading(false)}
                        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    </>
                  )}
                </div>

                {active && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-foreground">
                        {active.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {active.broadcaster} · {t("Kannada")}
                      </div>
                    </div>
                    <a
                      href={
                        active.video_id
                          ? `https://www.youtube.com/watch?v=${active.video_id}`
                          : `https://www.youtube.com/channel/${active.channel_id}/live`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("Open on YouTube")}
                    </a>
                  </div>
                )}
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {t(
                  "Third-party live broadcasts embedded for viewing only. Nothing is recorded, downloaded or written to the case database, and no channel content forms part of any case record. Audio starts muted because browsers block autoplay with sound.",
                )}
              </p>
            </div>

            {/* ── Channel list ──────────────────────────────────────────── */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("Channels")}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {state === "ready" ? `${liveCount}/${channels.length}` : "—"}
                </span>
              </div>
              <div className="space-y-1">
                {state === "loading" && channels.length === 0
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-11 animate-pulse rounded-md bg-muted/50" />
                    ))
                  : channels.map((c, i) => {
                      const on = c.slug === active?.slug;
                      return (
                        <button
                          key={c.slug}
                          onClick={() => select(c.slug)}
                          aria-pressed={on}
                          className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
                            on
                              ? "border-primary bg-primary/10"
                              : "border-transparent hover:border-border hover:bg-muted/60"
                          }`}
                        >
                          <span
                            className={`w-4 shrink-0 text-[10px] font-bold tabular-nums ${
                              on ? "text-primary" : "text-muted-foreground"
                            }`}
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-[12px] font-semibold ${
                                on
                                  ? "text-primary"
                                  : c.live
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {c.name}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {c.broadcaster}
                            </span>
                          </span>
                          {c.live ? (
                            <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-destructive">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                              {t("ON AIR")}
                            </span>
                          ) : (
                            <span className="shrink-0 text-[9px] font-semibold text-muted-foreground/70">
                              {t("OFF AIR")}
                            </span>
                          )}
                        </button>
                      );
                    })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
