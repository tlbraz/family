import { createHash, timingSafeEqual } from 'node:crypto';
import { inArray, like } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';
import { refreshJellyfin } from './arr';
import { esc, sendTelegram, sendTelegramPhoto } from './telegram';
import { details, posterUrl, tmdbEnabled } from './tmdb';

// "It's ready on Jellyfin": Radarr and Sonarr call POST /api/hooks/arr?token=ARR_WEBHOOK_TOKEN after each import
// (Settings → Connect → Webhook, "On File Import"). We ask Jellyfin to rescan, wait a couple of minutes (so the scan
// is done, and episodes arriving together go out as one message), then tell the family on Telegram, once per file.

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time check of the ?token= Radarr/Sonarr send. Off (always false) until ARR_WEBHOOK_TOKEN is set. */
export function hookTokenMatches(given: string | undefined): boolean {
  const expected = process.env.ARR_WEBHOOK_TOKEN;
  if (!expected || !given) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

export interface Episode { season: number; episode: number }

/** One import (or several of the same series, merged). */
export interface Arrival {
  batch: string; // what merges: "movie:12" / "series:7"
  kind: 'movie' | 'tv';
  title: string;
  year: number | null;
  tmdbId: number | null;
  poster: string | null; // from Radarr/Sonarr, if TMDB isn't set up
  episodes: Episode[];
  keys: string[]; // remembered in settings so a file is announced once
  upgrade: boolean; // Radarr/Sonarr replaced a file: only worth a message if this title was never announced
  titleKey: string; // prefix of this title's keys ("was it ever announced?")
}

interface Image { coverType?: string; remoteUrl?: string }
interface Hook {
  eventType?: string;
  isUpgrade?: boolean;
  movie?: { id?: number; title?: string; year?: number; tmdbId?: number; images?: Image[] };
  remoteMovie?: { tmdbId?: number; title?: string; year?: number };
  movieFile?: { id?: number; relativePath?: string };
  series?: { id?: number; title?: string; year?: number; tvdbId?: number; tmdbId?: number; images?: Image[] };
  episodes?: { seasonNumber?: number; episodeNumber?: number }[];
  episodeFile?: { id?: number; relativePath?: string };
}

const posterIn = (images: Image[] | undefined) => images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;

/**
 * What a Radarr/Sonarr webhook means for us: a test, a new film or episodes, or nothing (grabs, renames…).
 * Upgrades come back flagged: a file replacing one we announced stays quiet, but a title whose old copy was removed
 * and fetched again (10 Oct 2026: the 4K re-downloads, which Radarr reports as upgrades) still gets its message.
 */
export function parseArrHook(body: unknown): Arrival | 'test' | null {
  const h = (body && typeof body === 'object' ? body : {}) as Hook;
  if (h.eventType === 'Test') return 'test';
  if (h.eventType !== 'Download') return null;
  const upgrade = !!h.isUpgrade;
  if (h.movie) {
    const id = h.movie.id ?? h.movie.tmdbId;
    const tmdbId = h.movie.tmdbId ?? h.remoteMovie?.tmdbId ?? null;
    if (!h.movie.title || id === undefined) return null;
    return {
      batch: `movie:${id}`,
      kind: 'movie',
      title: h.movie.title,
      year: h.movie.year ?? h.remoteMovie?.year ?? null,
      tmdbId: tmdbId || null,
      poster: posterIn(h.movie.images),
      episodes: [],
      keys: [`arrived:movie:${tmdbId || id}:${h.movieFile?.id ?? h.movieFile?.relativePath ?? ''}`],
      upgrade,
      titleKey: `arrived:movie:${tmdbId || id}:`,
    };
  }
  if (h.series) {
    const id = h.series.id ?? h.series.tvdbId;
    if (!h.series.title || id === undefined) return null;
    const episodes = (h.episodes ?? [])
      .filter((e) => e.seasonNumber !== undefined && e.episodeNumber !== undefined)
      .map((e) => ({ season: e.seasonNumber!, episode: e.episodeNumber! }));
    return {
      batch: `series:${id}`,
      kind: 'tv',
      title: h.series.title,
      year: h.series.year ?? null,
      tmdbId: h.series.tmdbId || null,
      poster: posterIn(h.series.images),
      episodes,
      keys: [`arrived:series:${h.series.tvdbId ?? id}:${h.episodeFile?.id ?? episodes.map((e) => `${e.season}x${e.episode}`).join(',')}`],
      upgrade,
      titleKey: `arrived:series:${h.series.tvdbId ?? id}:`,
    };
  }
  return null;
}

/** Two arrivals of the same series become one, episodes in order without repeats. */
export function mergeArrivals(a: Arrival, b: Arrival): Arrival {
  const eps = new Map([...a.episodes, ...b.episodes].map((e) => [`${e.season}x${e.episode}`, e]));
  return {
    ...a,
    poster: a.poster ?? b.poster,
    episodes: [...eps.values()].sort((x, y) => x.season - y.season || x.episode - y.episode),
    keys: [...new Set([...a.keys, ...b.keys])],
    upgrade: a.upgrade && b.upgrade,
  };
}

const code = (e: Episode) => `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}`;

/** "S02E05–E08" for a run in one season, else the list (the first few). */
function episodeRange(eps: Episode[]): string {
  const first = eps[0]!;
  const last = eps.at(-1)!;
  const run = eps.every((e, i) => e.season === first.season && e.episode === first.episode + i);
  if (run) return `${code(first)}–E${String(last.episode).padStart(2, '0')}`;
  return eps.length > 5 ? `${eps.slice(0, 4).map(code).join(', ')}…` : eps.map(code).join(', ');
}

/** The Telegram text (HTML). */
export function arrivalMessage(a: Arrival): string {
  if (a.kind === 'movie') return `🎬 <b>${esc(a.title)}${a.year ? ` (${a.year})` : ''}</b> is ready on Jellyfin`;
  if (a.episodes.length === 0) return `📺 <b>${esc(a.title)}</b>: new episodes are ready on Jellyfin`;
  if (a.episodes.length === 1) return `📺 <b>${esc(a.title)}</b> ${code(a.episodes[0]!)} is ready`;
  return `📺 <b>${esc(a.title)}</b>: ${a.episodes.length} new episodes are ready (${episodeRange(a.episodes)})`;
}

/**
 * Holds arrivals for `quietMs` after the last one of the same film/series (episodes of a season come in one after
 * another), but never longer than `maxMs`, then hands each batch to `flush`.
 */
export function arrivalBatcher(flush: (a: Arrival) => void, quietMs = 2 * 60_000, maxMs = 10 * 60_000) {
  const pending = new Map<string, { arrival: Arrival; timer: ReturnType<typeof setTimeout>; since: number }>();
  const send = (batch: string) => {
    const p = pending.get(batch);
    pending.delete(batch);
    if (p) flush(p.arrival);
  };
  return {
    add(a: Arrival) {
      const p = pending.get(a.batch);
      if (p) clearTimeout(p.timer);
      const arrival = p ? mergeArrivals(p.arrival, a) : a;
      const since = p?.since ?? Date.now();
      const wait = Math.max(0, Math.min(quietMs, since + maxMs - Date.now()));
      pending.set(a.batch, { arrival, since, timer: setTimeout(() => send(a.batch), wait) });
    },
    get size() {
      return pending.size;
    },
  };
}

// ---- Wiring ------------------------------------------------------------------------------------

async function seenKeys(db: Db, keys: string[]) {
  if (!keys.length) return new Set<string>();
  const rows = await db.select({ key: settings.key }).from(settings).where(inArray(settings.key, keys));
  return new Set(rows.map((r) => r.key));
}

/** Sends one batch (unless every file in it was announced already) and remembers its files. */
async function announce(db: Db, a: Arrival) {
  const seen = await seenKeys(db, a.keys);
  const fresh = a.keys.filter((k) => !seen.has(k));
  if (!fresh.length) return;
  if (a.upgrade && (await db.select({ key: settings.key }).from(settings).where(like(settings.key, `${a.titleKey}%`)).limit(1)).length) {
    console.log(`arrival: ${a.title} is an upgrade of something already announced — no message`);
    return;
  }
  let poster = a.poster;
  if (a.tmdbId && tmdbEnabled()) poster = posterUrl((await details(a.kind, a.tmdbId).catch(() => null))?.poster_path) ?? poster;
  const text = arrivalMessage(a);
  const sent = poster ? await sendTelegramPhoto(poster, text) : await sendTelegram(text);
  if (sent) await db.insert(settings).values(fresh.map((key) => ({ key, value: new Date().toISOString() }))).onConflictDoNothing();
  console.log(`arrival: ${a.title}${a.episodes.length ? ` (${a.episodes.length} episode(s))` : ''} ${sent ? 'announced' : 'NOT sent (Telegram refused or no recipients)'}`);
}

let lastRefresh = 0;

/** The webhook's work (after it has answered): rescan Jellyfin (at most every 30 s) and queue the message. */
export function arrivals(db: Db) {
  const batcher = arrivalBatcher((a) => void announce(db, a).catch((e: Error) => console.error('arrival message:', e.message)));
  return async (a: Arrival) => {
    if (Date.now() - lastRefresh > 30_000) {
      lastRefresh = Date.now();
      await refreshJellyfin().catch((e: Error) => console.error('jellyfin refresh:', e.message));
    }
    batcher.add(a);
  };
}
