import type { WatchCard, WatchDetail, WatchGenre, WatchKind, WatchSection, WatchStatus } from '../../shared/types';
import { mapLimit, memo } from './memo';
import { addDays, dateKey } from './time';

// TMDB behind the Entertainment tab: what's out (digitally) and what's coming, with details and trailers.
//   TMDB_TOKEN    the v4 "API Read Access Token" (sent as a Bearer token), or
//   TMDB_API_KEY  the v3 key (sent as ?api_key=)
//   OMDB_API_KEY  optional: IMDb / Rotten Tomatoes / Metacritic ratings from omdbapi.com
// Only digital releases matter (when a film can be watched at home): TMDB release type 4, in the US, which is when
// releases show up online. Answers are kept for 6 hours; images come straight from image.tmdb.org.

type Fetch = typeof fetch;
export const tmdbEnabled = () => !!(process.env.TMDB_TOKEN || process.env.TMDB_API_KEY);
export class TmdbError extends Error {}

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const HOURS_6 = 6 * 3_600_000;
const HOUR = 3_600_000;
const OUT_DAYS = 45; // "Out now": released in the last 45 days
const SOON_DAYS = 90; // "Coming soon": in the next 90 days
const WINDOW_PAGES = 6; // the 120 most popular titles of a window, re-sorted by date
const PAGE = 20;
const DIGITAL = 4;
const cache = memo();
export const forgetTmdb = () => cache.forget();

export const posterUrl = (path: string | null | undefined) => (path ? `${IMG}/w342${path}` : null);
export const backdropUrl = (path: string | null | undefined) => (path ? `${IMG}/w780${path}` : null);

/** A request to TMDB (cached for 6 hours). */
async function tmdb<T>(path: string, params: Record<string, string> = {}, get: Fetch = fetch, ttl = HOURS_6): Promise<T> {
  if (!tmdbEnabled()) throw new TmdbError('TMDB key missing');
  const p = new URLSearchParams({ language: 'en-US', ...params });
  if (!process.env.TMDB_TOKEN) p.set('api_key', process.env.TMDB_API_KEY!);
  return cache.get(`${path}?${p}`, ttl, async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.TMDB_TOKEN) headers.Authorization = `Bearer ${process.env.TMDB_TOKEN}`;
    const res = await get(`${API}${path}?${p}`, { headers }).catch((e: Error & { cause?: { code?: string } }) => {
      throw new TmdbError(`Can't reach TMDB (${e.cause?.code ?? e.message})`);
    });
    if (res.status === 401) throw new TmdbError('TMDB refused the key (check TMDB_TOKEN / TMDB_API_KEY)');
    if (res.status === 404) throw new TmdbError('TMDB has no such title');
    if (!res.ok) throw new TmdbError(`TMDB answered ${res.status}`);
    return (await res.json()) as T;
  });
}

// ---- What TMDB sends (the parts we use) --------------------------------------------------------

export interface TmdbListItem {
  id: number;
  title?: string; // movies
  name?: string; // TV
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  genre_ids?: number[];
  popularity?: number;
}
interface ListPage { page: number; total_pages: number; results: TmdbListItem[] }
export interface SearchItem extends TmdbListItem { media_type?: string }
export interface ReleaseDates { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] }
export interface Video { key: string; site: string; type: string; official?: boolean; iso_639_1?: string; published_at?: string }
interface Credits { cast: { name: string; character?: string; profile_path?: string | null; order?: number }[] }
interface Season { season_number: number; air_date?: string | null; episode_count?: number }
interface Episode { air_date?: string | null; season_number: number; episode_number: number }
interface Details {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  genres?: { id: number; name: string }[];
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  imdb_id?: string | null;
  seasons?: Season[];
  last_episode_to_air?: Episode | null;
  next_episode_to_air?: Episode | null;
  release_dates?: ReleaseDates;
  videos?: { results: Video[] };
  credits?: Credits;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}

// ---- Pure helpers (tested) ---------------------------------------------------------------------

/** The digital release date: the earliest type-4 date in `region` (US), else the earliest anywhere. */
export function digitalDate(rd: ReleaseDates | undefined, region = 'US'): { date: string; region: string } | null {
  const all = (rd?.results ?? []).flatMap((r) =>
    r.release_dates.filter((d) => d.type === DIGITAL && d.release_date).map((d) => ({ date: d.release_date.slice(0, 10), region: r.iso_3166_1 })),
  );
  const earliest = (list: typeof all) => list.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return earliest(all.filter((d) => d.region === region)) ?? earliest(all);
}

const label = (season: number) => (season === 1 ? 'New series' : `Season ${season}`);

/**
 * When a series has something new: the latest season premiere on or before today, and the next premiere
 * (or the next episode) after today. Specials (season 0) don't count.
 */
export function seasonAirs(tv: Pick<Details, 'seasons' | 'next_episode_to_air' | 'last_episode_to_air'>, today: string) {
  const seasons = (tv.seasons ?? []).filter((s) => s.season_number > 0 && s.air_date);
  const aired = seasons.filter((s) => s.air_date! <= today).sort((a, b) => b.air_date!.localeCompare(a.air_date!))[0];
  const next = tv.next_episode_to_air;
  const coming = seasons.filter((s) => s.air_date! > today).sort((a, b) => a.air_date!.localeCompare(b.air_date!))[0];
  const premiere =
    next?.air_date && next.episode_number === 1 && next.air_date > today
      ? { date: next.air_date, label: label(next.season_number) }
      : coming
        ? { date: coming.air_date!, label: label(coming.season_number) }
        : null;
  const ep = (e: Episode) => `S${String(e.season_number).padStart(2, '0')}E${String(e.episode_number).padStart(2, '0')}`;
  return {
    premiered: aired ? { date: aired.air_date!, label: label(aired.season_number) } : null,
    premiere,
    nextEpisode: next?.air_date && next.air_date > today ? { date: next.air_date, label: ep(next) } : null,
    lastEpisode: tv.last_episode_to_air?.air_date ? { date: tv.last_episode_to_air.air_date, label: ep(tv.last_episode_to_air) } : null,
  };
}

/** A poster for the grid. */
export function toCard(kind: WatchKind, t: TmdbListItem, when: { date: string | null; label: string | null }, status: WatchStatus | null): WatchCard {
  const first = kind === 'movie' ? t.release_date : t.first_air_date;
  return {
    kind,
    id: t.id,
    title: (kind === 'movie' ? t.title : t.name) ?? t.title ?? t.name ?? '',
    year: first ? Number(first.slice(0, 4)) : null,
    poster: posterUrl(t.poster_path),
    rating: t.vote_average ? Math.round(t.vote_average * 10) / 10 : null,
    date: when.date,
    dateLabel: when.label,
    genres: t.genre_ids ?? [],
    status,
  };
}

/** The trailer to show: a YouTube "Trailer", official and English first, newest first. */
export function pickTrailer(videos: Video[] | undefined): string | null {
  const yt = (videos ?? []).filter((v) => v.site === 'YouTube' && v.key);
  const score = (v: Video) => (v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 1 : 0) + (v.official ? 2 : 0) + (!v.iso_639_1 || v.iso_639_1 === 'en' ? 1 : 0);
  const best = [...yt].filter((v) => v.type === 'Trailer' || v.type === 'Teaser').sort((a, b) => score(b) - score(a) || (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0];
  return best?.key ?? null;
}

// ---- Lists -------------------------------------------------------------------------------------

/** One title with everything the cards and the sheet need (one request, kept 6 h; the cast is trimmed). */
export function details(kind: WatchKind, id: number, get: Fetch = fetch): Promise<Details> {
  const append = kind === 'movie' ? 'release_dates,videos,credits,external_ids' : 'videos,credits,external_ids';
  return cache.get(`details:${kind}:${id}`, HOURS_6, async () => {
    const d = await tmdb<Details>(`/${kind}/${id}`, { append_to_response: append, include_video_language: 'en,null' }, get);
    return { ...d, credits: { cast: (d.credits?.cast ?? []).slice(0, 12) } };
  });
}

export function genres(kind: WatchKind, get: Fetch = fetch): Promise<WatchGenre[]> {
  return tmdb<{ genres: WatchGenre[] }>(`/genre/${kind}/list`, {}, get).then((g) => g.genres);
}

/** When to show a title: its digital date (movies) or the season premiere / latest episode (TV). */
async function whenOf(kind: WatchKind, id: number, section: WatchSection, today: string, get: Fetch) {
  const d = await details(kind, id, get).catch(() => null);
  if (!d) return { date: null, label: null };
  if (kind === 'movie') return { date: digitalDate(d.release_dates)?.date ?? null, label: null };
  const a = seasonAirs(d, today);
  // Coming soon / out now: new series and new seasons only (not every weekly episode); popular: the latest episode.
  const pick = section === 'soon' ? a.premiere : section === 'out' ? a.premiered : (a.nextEpisode ?? a.lastEpisode);
  return pick ?? { date: null, label: null };
}

/**
 * A page of releases. "Out now" and "Coming soon" take the most popular titles in the window from TMDB's discover,
 * then sort them by the date that matters (newest / soonest first) and page through that. "Popular" is TMDB's
 * trending of the week (or the most popular of a genre).
 */
export async function releases(
  q: { kind: WatchKind; section: WatchSection; genre?: number; page: number },
  statusOf: (kind: WatchKind, id: number) => WatchStatus | null,
  now = new Date(),
  get: Fetch = fetch,
): Promise<{ items: WatchCard[]; next: boolean }> {
  const today = dateKey(now);
  const genre: Record<string, string> = q.genre ? { with_genres: String(q.genre) } : {};

  if (q.section === 'popular') {
    const page = q.genre
      ? await tmdb<ListPage>(`/discover/${q.kind}`, { sort_by: 'popularity.desc', include_adult: 'false', page: String(q.page), ...genre, ...(q.kind === 'tv' ? { with_type: '2|4' } : {}) }, get)
      : await tmdb<ListPage>(`/trending/${q.kind}/week`, { page: String(q.page) }, get);
    const items = await mapLimit(page.results.filter((t) => t.poster_path), 8, async (t) => toCard(q.kind, t, await whenOf(q.kind, t.id, 'popular', today, get), statusOf(q.kind, t.id)));
    return { items, next: page.page < Math.min(page.total_pages, 50) };
  }

  const window = await cache.get(`window:${q.kind}:${q.section}:${q.genre ?? ''}:${today}`, HOURS_6, async () => {
    const from = q.section === 'out' ? dateKey(addDays(now, -OUT_DAYS)) : dateKey(addDays(now, 1));
    const to = q.section === 'out' ? today : dateKey(addDays(now, SOON_DAYS));
    const params: Record<string, string> =
      q.kind === 'movie'
        ? { with_release_type: String(DIGITAL), region: 'US', 'release_date.gte': from, 'release_date.lte': to }
        : { 'air_date.gte': from, 'air_date.lte': to, with_type: '2|4' }; // scripted and miniseries: no talk shows, news or reality
    if (q.section === 'out') params['vote_count.gte'] = q.kind === 'movie' ? '10' : '3'; // out a while and nobody voted: noise
    const pages = await Promise.all(
      Array.from({ length: WINDOW_PAGES }, (_, i) =>
        tmdb<ListPage>(`/discover/${q.kind}`, { ...params, ...genre, sort_by: 'popularity.desc', include_adult: 'false', page: String(i + 1) }, get).catch((e) => {
          if (i === 0) throw e;
          return { page: i + 1, total_pages: 0, results: [] } as ListPage;
        }),
      ),
    );
    const seen = new Set<number>();
    const titles = pages.flatMap((p) => p.results).filter((t) => t.poster_path && !seen.has(t.id) && seen.add(t.id));
    const dated = await mapLimit(titles, 8, async (t) => ({ t, when: await whenOf(q.kind, t.id, q.section, today, get) }));
    const inWindow = dated.filter(({ when }) => when.date && when.date >= from && when.date <= to);
    return inWindow.sort((a, b) => (q.section === 'out' ? b.when.date!.localeCompare(a.when.date!) : a.when.date!.localeCompare(b.when.date!)));
  });
  const start = (q.page - 1) * PAGE;
  return {
    items: window.slice(start, start + PAGE).map(({ t, when }) => toCard(q.kind, t, when, statusOf(q.kind, t.id))),
    next: window.length > start + PAGE,
  };
}

/** What a search found worth showing: films and series with a poster (TMDB also finds people), in TMDB's order. */
export function searchHits(results: SearchItem[]): { kind: WatchKind; t: SearchItem }[] {
  const seen = new Set<string>();
  return results
    .filter((t) => (t.media_type === 'movie' || t.media_type === 'tv') && t.poster_path)
    .map((t) => ({ kind: t.media_type as WatchKind, t }))
    .filter(({ kind, t }) => !seen.has(`${kind}:${t.id}`) && !!seen.add(`${kind}:${t.id}`));
}

/** Films and series by name (TMDB's multi search, kept an hour), with the same dates and badges as the releases. */
export async function search(
  query: string,
  page: number,
  statusOf: (kind: WatchKind, id: number) => WatchStatus | null,
  now = new Date(),
  get: Fetch = fetch,
): Promise<{ items: WatchCard[]; next: boolean }> {
  const today = dateKey(now);
  const res = await tmdb<{ page: number; total_pages: number; results: SearchItem[] }>('/search/multi', { query, page: String(page), include_adult: 'false' }, get, HOUR);
  const items = await mapLimit(searchHits(res.results), 8, async ({ kind, t }) => toCard(kind, t, await whenOf(kind, t.id, 'popular', today, get), statusOf(kind, t.id)));
  return { items, next: res.page < Math.min(res.total_pages, 20) };
}

// ---- One title ---------------------------------------------------------------------------------

/** OMDb's ratings by IMDb id (kept a day). Nothing when OMDB_API_KEY isn't set or OMDb fails. */
export async function omdbRatings(imdbId: string | null, get: Fetch = fetch): Promise<WatchDetail['ratings']> {
  if (!imdbId || !process.env.OMDB_API_KEY) return [];
  const data = await cache
    .get(`omdb:${imdbId}`, 24 * 3_600_000, async () => {
      const res = await get(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(process.env.OMDB_API_KEY!)}`);
      if (!res.ok) throw new Error(`OMDb answered ${res.status}`);
      return (await res.json()) as { Ratings?: { Source: string; Value: string }[] };
    })
    .catch(() => null);
  return omdbToRatings(data?.Ratings);
}

export function omdbToRatings(list: { Source: string; Value: string }[] | undefined): WatchDetail['ratings'] {
  const names = { 'Internet Movie Database': 'IMDb', 'Rotten Tomatoes': 'Rotten Tomatoes', Metacritic: 'Metacritic' } as const;
  return (list ?? [])
    .filter((r): r is { Source: keyof typeof names; Value: string } => r.Source in names && !!r.Value && r.Value !== 'N/A')
    .map((r) => ({ source: names[r.Source], value: r.Value }));
}

/** The TMDB part of the detail sheet (status, Jellyfin and abilities are added by the caller). */
export async function titleDetail(kind: WatchKind, id: number, now = new Date(), get: Fetch = fetch) {
  const d = await details(kind, id, get);
  const today = dateKey(now);
  const imdbId = d.imdb_id ?? d.external_ids?.imdb_id ?? null;
  const first = kind === 'movie' ? d.release_date : d.first_air_date;
  const digital = kind === 'movie' ? digitalDate(d.release_dates) : null;
  const a = kind === 'tv' ? seasonAirs(d, today) : null;
  const detail: Omit<WatchDetail, 'status' | 'jellyfin' | 'can'> = {
    kind,
    id,
    title: (kind === 'movie' ? d.title : d.name) ?? '',
    year: first ? Number(first.slice(0, 4)) : null,
    poster: posterUrl(d.poster_path),
    backdrop: backdropUrl(d.backdrop_path),
    runtime: kind === 'movie' ? (d.runtime ?? null) : (d.episode_run_time?.[0] ?? null),
    seasons: d.number_of_seasons ?? null,
    genres: (d.genres ?? []).map((g) => g.name),
    overview: d.overview ?? '',
    cast: (d.credits?.cast ?? []).slice(0, 10).map((c) => ({ name: c.name, character: c.character ?? '', photo: c.profile_path ? `${IMG}/w185${c.profile_path}` : null })),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count ?? 0,
    ratings: await omdbRatings(imdbId, get),
    imdbId,
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    digital: digital?.date ?? null,
    digitalRegion: digital?.region ?? null,
    airs: a ? (a.premiere ?? a.nextEpisode ?? a.lastEpisode) : null,
    released: kind === 'movie' ? !!digital && digital.date <= today : !!first && first <= today,
    trailer: pickTrailer(d.videos?.results),
  };
  return { detail, tvdbId: d.external_ids?.tvdb_id ?? null };
}

/** TMDB's id for a series Sonarr knows by its TVDB id (for "My list" rows). */
export async function tmdbIdForTvdb(tvdbId: number, get: Fetch = fetch): Promise<number | null> {
  const r = await tmdb<{ tv_results?: { id: number }[] }>(`/find/${tvdbId}`, { external_source: 'tvdb_id' }, get).catch(() => null);
  return r?.tv_results?.[0]?.id ?? null;
}

/** For the health line: does TMDB answer with our key? */
export async function tmdbCheck(get: Fetch = fetch): Promise<string | null> {
  if (!tmdbEnabled()) return 'TMDB key missing';
  return tmdb('/configuration', {}, get, 60_000).then(() => null, (e: Error) => e.message);
}
