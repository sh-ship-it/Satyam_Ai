import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Radio, RefreshCw, Tv, Volume2, VolumeX } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useI18n } from "@/lib/i18n";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NEWS FEED — live Karnataka news television
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A viewing screen, deliberately not a data screen. There is no backend route,
 * no database table, no polling and no caching: each channel is a YouTube live
 * embed rendered straight into an iframe. That keeps it free (no API key, no
 * quota) and, more importantly, keeps real-world reporting about real people out
 * of a database whose every other row is synthetic.
 *
 * WHY EMBEDS AND NOT AN RSS/ARTICLE FEED
 * The 24/7 simulcast every Kannada news channel runs on YouTube is reachable via
 * `/embed/live_stream?channel=<id>`, which resolves whichever broadcast is live
 * at load time. So a hardcoded channel id keeps working across stream restarts,
 * which a hardcoded video id would not.
 *
 * CHANNEL IDS ARE VERIFIED, NOT GUESSED
 * Every id below was resolved from the channel's own `@handle` page canonical
 * link and then confirmed against `youtube.com/feeds/videos.xml?channel_id=…`,
 * which echoes the channel title. All ten also report `playableInEmbed: true`.
 * A wrong id fails silently as a dead player, so if a channel is ever replaced,
 * re-verify both ways rather than pasting an id from a search result.
 *
 * ONE PLAYER AT A TIME
 * Only the selected channel is mounted. Ten simultaneous live HLS players would
 * saturate the network and the decoder for no benefit — nobody watches ten.
 *
 * Uses `youtube-nocookie.com` (privacy-enhanced mode) so no tracking cookie is
 * set before playback, which is the appropriate default inside a police tool.
 */

type Channel = {
  slug: string;
  /** Proper noun — never translated, per the app's i18n rule. */
  name: string;
  /** YouTube channel id. Verified; see the header note before changing one. */
  id: string;
  broadcaster: string;
};

const CHANNELS: Channel[] = [
  { slug: "tv9", name: "TV9 Kannada", id: "UC8dnBi4WUErqYQHZ4PfsLTg", broadcaster: "TV9 Network" },
  { slug: "publictv", name: "Public TV", id: "UCl-OodciBGZ0k8K8rBZGe4w", broadcaster: "Public TV" },
  {
    slug: "suvarna",
    name: "Asianet Suvarna News",
    id: "UCjElJyiXmQXnWmceQ1JyKrA",
    broadcaster: "Asianet",
  },
  {
    slug: "news18",
    name: "News18 Kannada",
    id: "UCa-vioGhe2btBcZneaPonKA",
    broadcaster: "Network18",
  },
  {
    slug: "powertv",
    name: "Power TV News",
    id: "UC-Yz1K9QH3VQuEL5qzLptJQ",
    broadcaster: "Power TV",
  },
  {
    slug: "republic",
    name: "Republic Kannada",
    id: "UCJHrhOU9TPxBfyZ4regtDNQ",
    broadcaster: "Republic Media",
  },
  {
    slug: "newsfirst",
    name: "NewsFirst Kannada",
    id: "UCFRlIV1mX-traJb5fd7S3nw",
    broadcaster: "NewsFirst",
  },
  { slug: "tv5", name: "TV5 Kannada", id: "UCpzsmNuUEmod64DGgBDPO-Q", broadcaster: "TV5" },
  {
    slug: "vistara",
    name: "Vistara News",
    id: "UChl-MciRVsq6RPyhaIMceOg",
    broadcaster: "Vistara",
  },
  {
    slug: "news1",
    name: "News 1 Kannada",
    id: "UCqvtaBINBx7k6pQBR5CKYzw",
    broadcaster: "News 1",
  },
];

const DEFAULT_SLUG = CHANNELS[0].slug;

type Search = { ch?: string };

export const Route = createFileRoute("/news")({
  // The channel rides in the URL so a particular channel is a shareable link and
  // so voice navigation can land directly on one. Validated against the known
  // slugs rather than passed through: the value ends up in an iframe `src`, and
  // accepting an arbitrary string here would let a crafted link embed anything.
  validateSearch: (search: Record<string, unknown>): Search => {
    const ch = typeof search.ch === "string" ? search.ch : undefined;
    return { ch: CHANNELS.some((c) => c.slug === ch) ? ch : undefined };
  },
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

  const active = useMemo(() => CHANNELS.find((c) => c.slug === ch) ?? CHANNELS[0], [ch]);

  // Browsers block autoplay with sound, so the stream has to start muted or it
  // does not start at all. The toggle remounts the player with the flag flipped.
  const [muted, setMuted] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const select = useCallback(
    (slug: string) => {
      navigate({ to: "/news", search: slug === DEFAULT_SLUG ? {} : { ch: slug }, replace: true });
    },
    [navigate],
  );

  // Any change of channel, mute state or manual reload swaps the iframe, so show
  // the placeholder again until the new one reports it has loaded.
  useEffect(() => setLoading(true), [active.slug, muted, reloadKey]);

  /* ── Voice actions ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/news") return;
      for (const a of Array.isArray(d.actions) ? d.actions : []) {
        if (a.screen !== "/news") continue;
        const p = a.params || {};
        if (a.action === "set_channel" && p.channel) {
          // Spoken channel names arrive loosely ("put on public tv"), so match on
          // a normalised substring in both directions rather than equality.
          const q = String(p.channel)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const hit = CHANNELS.find((c) => {
            const n = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            return n.includes(q) || q.includes(c.slug);
          });
          if (hit) select(hit.slug);
        } else if (a.action === "next_channel") {
          const i = CHANNELS.findIndex((c) => c.slug === active.slug);
          select(CHANNELS[(i + 1) % CHANNELS.length].slug);
        } else if (a.action === "mute") setMuted(true);
        else if (a.action === "unmute") setMuted(false);
        else if (a.action === "refresh") setReloadKey((n) => n + 1);
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [active.slug, select]);

  const src =
    `https://www.youtube-nocookie.com/embed/live_stream?channel=${active.id}` +
    `&autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`;

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
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                  {t("LIVE")}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("Karnataka news television, streamed live for situational awareness.")}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setMuted((m) => !m)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                aria-label={muted ? t("Unmute") : t("Mute")}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {muted ? t("Unmute") : t("Mute")}
              </button>
              <button
                onClick={() => setReloadKey((n) => n + 1)}
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
                  {loading && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black">
                      <Radio className="h-5 w-5 animate-pulse text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">
                        {t("Tuning in to")} {active.name}…
                      </span>
                    </div>
                  )}
                  <iframe
                    // Remount on every change: the embed resolves the current live
                    // broadcast at load, so a new src alone would not re-resolve it.
                    key={`${active.slug}:${muted ? "m" : "s"}:${reloadKey}`}
                    src={src}
                    title={`${active.name} — ${t("live stream")}`}
                    className="absolute inset-0 h-full w-full"
                    onLoad={() => setLoading(false)}
                    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>

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
                    href={`https://www.youtube.com/channel/${active.id}/live`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("Open on YouTube")}
                  </a>
                </div>
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {t(
                  "Third-party live broadcasts embedded for viewing only. Nothing is recorded, downloaded or written to the case database, and no channel content forms part of any case record. Audio starts muted because browsers block autoplay with sound. If a player reports it is offline, that channel is between broadcasts — pick another or reload.",
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
                  {CHANNELS.length}
                </span>
              </div>
              <div className="space-y-1">
                {CHANNELS.map((c, i) => {
                  const on = c.slug === active.slug;
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
                            on ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {c.name}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {c.broadcaster}
                        </span>
                      </span>
                      {on && (
                        <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-destructive">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                          {t("ON AIR")}
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
