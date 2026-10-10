import { eq } from 'drizzle-orm';
import type { WatchKind, WatchListItem, WatchSession, WatchStatus } from '../../shared/types';
import type { Db } from '../db';
import { settings } from '../schema';
import { memo } from './memo';
import { dateKey, pad } from './time';

// Radarr (films), Sonarr (series) and Jellyfin (where we watch) behind the Entertainment tab.
//   RADARR_URL, RADARR_API_KEY, RADARR_PROFILE_ID (default 4, "HD-1080p")
//   SONARR_URL, SONARR_API_KEY, SONARR_PROFILE_ID (default 4)
//   JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_PUBLIC_URL (links in the browser; default JELLYFIN_URL)
// Root folders are read from Radarr/Sonarr. Keys stay on the server.

type Fetch = typeof fetch;
export type Arr = 'radarr' | 'sonarr';
const NAME: Record<Arr, string> = { radarr: 'Radarr', sonarr: 'Sonarr' };
const env = (a: Arr, what: 'URL' | 'API_KEY' | 'PROFILE_ID') => process.env[`${a.toUpperCase()}_${what}`];
export const arrEnabled = (a: Arr) => !!(env(a, 'URL') && env(a, 'API_KEY'));
export const arrFor = (kind: WatchKind): Arr => (kind === 'movie' ? 'radarr' : 'sonarr');
export const jellyfinEnabled = () => !!(process.env.JELLYFIN_URL && process.env.JELLYFIN_API_KEY);
const base = (url: string) => url.replace(/\/+$/, '');
const cache = memo(200);

export class ArrError extends Error {}

/** "fetch failed" says nothing: name the service, the address and the reason. */
const unreachable = (name: string, url: string) => (e: Error & { cause?: { code?: string; message?: string } }) => {
  throw new ArrError(`Can't reach ${name} at ${url} (${e.cause?.code ?? e.cause?.message ?? e.message})`);
};

async function failure(name: string, res: Response): Promise<never> {
  const detail = await res.text().catch(() => '');
  const msg = (() => {
    try {
      const j = JSON.parse(detail) as { message?: string; errorMessage?: string }[] | { message?: string };
      return Array.isArray(j) ? j.map((x) => x.errorMessage ?? x.message).filter(Boolean).join('; ') : (j.message ?? '');
    } catch {
      return '';
    }
  })();
  const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : '';
  throw new ArrError(`${name} answered ${res.status}${hint}${msg ? `: ${msg.slice(0, 200)}` : ''}`);
}

/** A request to Radarr's or Sonarr's v3 API, with the key. */
export async function arrFetch<T>(a: Arr, path: string, init: RequestInit = {}, get: Fetch = fetch): Promise<T> {
  if (!arrEnabled(a)) throw new ArrError(`${NAME[a]} is not set up`);
  const url = base(env(a, 'URL')!);
  const res = await get(`${url}/api/v3${path}`, {
    ...init,
    headers: { 'X-Api-Key': env(a, 'API_KEY')!, Accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  }).catch(unreachable(NAME[a], url));
  if (!res.ok) await failure(NAME[a], res);
  return (res.status === 204 || res.headers.get('content-length') === '0' ? undefined : await res.json().catch(() => undefined)) as T;
}

/** A request to Jellyfin. Our Jellyfin only takes the key in this header (not X-Emby-Token or ?api_key=). */
export async function jellyfinFetch<T>(path: string, init: RequestInit = {}, get: Fetch = fetch): Promise<T> {
  if (!jellyfinEnabled()) throw new ArrError('Jellyfin is not set up');
  const url = base(process.env.JELLYFIN_URL!);
  const res = await get(`${url}${path}`, {
    ...init,
    headers: { Authorization: `MediaBrowser Token="${process.env.JELLYFIN_API_KEY}"`, Accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  }).catch(unreachable('Jellyfin', url));
  if (!res.ok) await failure('Jellyfin', res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- What Radarr / Sonarr send (the parts we use) ----------------------------------------------

interface Image { coverType: string; remoteUrl?: string; url?: string }
export interface RadarrMovie {
  id: number;
  tmdbId: number;
  title: string;
  year?: number;
  monitored: boolean;
  hasFile: boolean;
  digitalRelease?: string;
  physicalRelease?: string;
  added?: string;
  movieFile?: { dateAdded?: string };
  images?: Image[];
}
export interface SonarrSeries {
  id: number;
  tvdbId: number;
  tmdbId?: number;
  title: string;
  year?: number;
  monitored: boolean;
  nextAiring?: string;
  previousAiring?: string;
  added?: string;
  images?: Image[];
  statistics?: { episodeFileCount?: number; episodeCount?: number; totalEpisodeCount?: number };
}
export interface QueueRecord {
  movieId?: number;
  seriesId?: number;
  size?: number;
  sizeleft?: number;
  estimatedCompletionTime?: string;
  status?: string;
  trackedDownloadState?: string;
  episode?: { seasonNumber: number; episodeNumber: number };
}
interface HistoryRecord {
  date: string;
  movieId?: number;
  seriesId?: number;
  movie?: RadarrMovie;
  series?: SonarrSeries;
  episode?: { seasonNumber: number; episodeNumber: number };
}

export const posterOf = (images: Image[] | undefined) => {
  const p = images?.find((i) => i.coverType === 'poster');
  return p?.remoteUrl ?? null;
};

// ---- Status (pure, tested) ---------------------------------------------------------------------

const shortDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "ETA 21:30" today, "ETA Sat 21:30" later. */
export function etaText(iso: string | undefined, now: Date): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime()) || t.getTime() < now.getTime()) return null;
  const time = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return dateKey(t) === dateKey(now) ? `ETA ${time}` : `ETA ${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

/** Progress of one or more downloads (by bytes), 0..1. */
function progressOf(q: QueueRecord[]) {
  const size = q.reduce((s, r) => s + (r.size ?? 0), 0);
  const left = q.reduce((s, r) => s + (r.sizeleft ?? 0), 0);
  return size > 0 ? Math.round(Math.max(0, Math.min(1, 1 - left / size)) * 1000) / 1000 : 0;
}

function downloading(q: QueueRecord[], arrId: number, now: Date, what = ''): WatchStatus {
  const progress = progressOf(q);
  const eta = q.map((r) => r.estimatedCompletionTime).filter(Boolean).sort().at(-1);
  const stuck = q.every((r) => r.trackedDownloadState === 'importPending' || r.trackedDownloadState === 'importBlocked');
  const text = stuck ? `Downloaded${what} · waiting to import` : [`Downloading${what} ${Math.round(progress * 100)} %`, etaText(eta, now)].filter(Boolean).join(' · ');
  return { state: 'downloading', arrId, text, progress };
}

const NONE: WatchStatus = { state: 'none', arrId: null, text: 'Not in the library' };

/** Where a film stands: downloading (from the queue), in the library, wanted, or not added / not monitored. */
export function movieStatus(m: RadarrMovie | undefined, queue: QueueRecord[], now: Date): WatchStatus {
  if (!m) return NONE;
  const q = queue.filter((r) => r.movieId === m.id);
  if (q.length) return downloading(q, m.id, now);
  if (m.hasFile) return { state: 'library', arrId: m.id, text: 'In library' };
  if (!m.monitored) return { ...NONE, arrId: m.id };
  const out = m.digitalRelease ?? m.physicalRelease;
  const text = !out ? 'Wanted — no digital date yet' : out.slice(0, 10) > dateKey(now) ? `Wanted — out on ${shortDate(out)}` : 'Wanted — looking for a copy';
  return { state: 'wanted', arrId: m.id, text };
}

/** Where a series stands. "In library" once it has episodes; downloading wins while new ones come in. */
export function seriesStatus(s: SonarrSeries | undefined, queue: QueueRecord[], now: Date): WatchStatus {
  if (!s) return NONE;
  const q = queue.filter((r) => r.seriesId === s.id);
  if (q.length) return downloading(q, s.id, now, q.length > 1 ? ` ${q.length} episodes` : '');
  const have = s.statistics?.episodeFileCount ?? 0;
  const aired = s.statistics?.episodeCount ?? 0; // monitored episodes that have aired
  if (have > 0) return { state: 'library', arrId: s.id, text: have < aired ? `In library · ${have} of ${aired} episodes` : 'In library' };
  if (!s.monitored) return { ...NONE, arrId: s.id };
  const text = s.nextAiring && s.nextAiring.slice(0, 10) >= dateKey(now) ? `Wanted — next episode on ${shortDate(s.nextAiring)}` : 'Wanted — looking for episodes';
  return { state: 'wanted', arrId: s.id, text };
}

// ---- The library (kept a minute) ---------------------------------------------------------------

interface Library { movies: RadarrMovie[]; series: SonarrSeries[]; movieQueue: QueueRecord[]; seriesQueue: QueueRecord[] }
const queueOf = (a: Arr, extra: string) => arrFetch<{ records: QueueRecord[] }>(a, `/queue?page=1&pageSize=200${extra}`).then((r) => r.records ?? []);

/** Everything in Radarr and Sonarr, with their queues. Parts that don't answer are empty. */
export function library(): Promise<Library> {
  return cache.get('library', 60_000, async () => {
    const or = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [movies, movieQueue, series, seriesQueue] = await Promise.all([
      arrEnabled('radarr') ? or(arrFetch<RadarrMovie[]>('radarr', '/movie')) : [],
      arrEnabled('radarr') ? or(queueOf('radarr', '&includeUnknownMovieItems=false')) : [],
      arrEnabled('sonarr') ? or(arrFetch<SonarrSeries[]>('sonarr', '/series')) : [],
      arrEnabled('sonarr') ? or(queueOf('sonarr', '&includeUnknownSeriesItems=false&includeEpisode=true')) : [],
    ]);
    return { movies, series, movieQueue, seriesQueue };
  });
}
export const forgetLibrary = () => cache.forget('library');

/** A status lookup for the cards: by TMDB id (null for a kind whose *arr isn't set up). */
export async function statusLookup(now = new Date()) {
  const lib = await library();
  const movies = new Map(lib.movies.map((m) => [m.tmdbId, m]));
  const series = new Map(lib.series.filter((s) => s.tmdbId).map((s) => [s.tmdbId!, s]));
  return (kind: WatchKind, id: number): WatchStatus | null => {
    if (!arrEnabled(arrFor(kind))) return null;
    return kind === 'movie' ? movieStatus(movies.get(id), lib.movieQueue, now) : seriesStatus(series.get(id), lib.seriesQueue, now);
  };
}

/** The status of one title; series are also matched by TVDB id (older Sonarr data may lack TMDB ids). */
export async function statusOf(kind: WatchKind, id: number, tvdbId: number | null, now = new Date()): Promise<WatchStatus | null> {
  if (!arrEnabled(arrFor(kind))) return null;
  const lib = await library();
  if (kind === 'movie') return movieStatus(lib.movies.find((m) => m.tmdbId === id), lib.movieQueue, now);
  return seriesStatus(lib.series.find((s) => s.tmdbId === id || (tvdbId && s.tvdbId === tvdbId)), lib.seriesQueue, now);
}

// ---- Get it / Want it / Delete -----------------------------------------------------------------

export type SeriesMonitor = 'all' | 'latestSeason' | 'future';

async function rootFolder(a: Arr): Promise<string> {
  const folders = await arrFetch<{ path: string; accessible?: boolean }[]>(a, '/rootfolder');
  const f = folders.find((x) => x.accessible !== false) ?? folders[0];
  if (!f) throw new ArrError(`${NAME[a]} has no root folder`);
  return f.path;
}
const profile = (a: Arr) => Number(env(a, 'PROFILE_ID') || 4);

/** Adds a film to Radarr (or, if it's there, monitors it). `search`: look for it now; otherwise it comes when out. */
export async function addMovie(tmdbId: number, search: boolean) {
  const [existing] = await arrFetch<RadarrMovie[]>('radarr', `/movie?tmdbId=${tmdbId}`);
  if (existing) {
    if (!existing.monitored) {
      const full = await arrFetch<Record<string, unknown>>('radarr', `/movie/${existing.id}`);
      await arrFetch('radarr', `/movie/${existing.id}`, { method: 'PUT', body: JSON.stringify({ ...full, monitored: true }) });
    }
    if (search) await arrFetch('radarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [existing.id] }) });
  } else {
    const found = await arrFetch<Record<string, unknown>>('radarr', `/movie/lookup/tmdb?tmdbId=${tmdbId}`);
    if (!found?.tmdbId) throw new ArrError('Radarr could not find that film');
    await arrFetch('radarr', '/movie', {
      method: 'POST',
      body: JSON.stringify({
        ...found,
        qualityProfileId: profile('radarr'),
        rootFolderPath: await rootFolder('radarr'),
        monitored: true,
        minimumAvailability: 'released',
        addOptions: { searchForMovie: search, monitor: 'movieOnly' },
      }),
    });
  }
  forgetLibrary();
}

/** Adds a series to Sonarr (or changes what's monitored if it's there). Searches unless only future episodes are wanted. */
export async function addSeries(tvdbId: number, monitor: SeriesMonitor, search: boolean) {
  const [existing] = await arrFetch<SonarrSeries[]>('sonarr', `/series?tvdbId=${tvdbId}`);
  if (existing) {
    await arrFetch('sonarr', '/seasonpass', { method: 'POST', body: JSON.stringify({ series: [{ id: existing.id, monitored: true }], monitoringOptions: { monitor } }) });
    if (search) await arrFetch('sonarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'SeriesSearch', seriesId: existing.id }) });
  } else {
    const [found] = await arrFetch<Record<string, unknown>[]>('sonarr', `/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`);
    if (!found?.tvdbId) throw new ArrError('Sonarr could not find that series');
    await arrFetch('sonarr', '/series', {
      method: 'POST',
      body: JSON.stringify({
        ...found,
        qualityProfileId: profile('sonarr'),
        rootFolderPath: await rootFolder('sonarr'),
        monitored: true,
        seasonFolder: true,
        seriesType: found.seriesType ?? 'standard',
        addOptions: { monitor, searchForMissingEpisodes: search, searchForCutoffUnmetEpisodes: false },
      }),
    });
  }
  forgetLibrary();
}

/** Removes a film or series and its files, then tells Jellyfin. */
export async function removeTitle(kind: WatchKind, arrId: number) {
  const a = arrFor(kind);
  await arrFetch(a, `/${kind === 'movie' ? 'movie' : 'series'}/${arrId}?deleteFiles=true&addImportExclusion=false`, { method: 'DELETE' });
  forgetLibrary();
  await refreshJellyfin().catch(() => {});
}

// ---- Jellyfin ----------------------------------------------------------------------------------

interface JfItem { Id: string; Name: string; Type: string; ProviderIds?: Record<string, string> }
const publicJellyfin = () => base(process.env.JELLYFIN_PUBLIC_URL || process.env.JELLYFIN_URL!);
export const jellyfinLink = (id: string) => `${publicJellyfin()}/web/#/details?id=${id}`;

/** The film or series on Jellyfin, by its TMDB (or TVDB) id. Checked against the ids, in case the filter is ignored. */
export async function findInJellyfin(kind: WatchKind, tmdbId: number, tvdbId: number | null): Promise<JfItem | null> {
  if (!jellyfinEnabled()) return null;
  const type = kind === 'movie' ? 'Movie' : 'Series';
  const tries: [string, number][] = [['Tmdb', tmdbId], ...(tvdbId ? ([['Tvdb', tvdbId]] as [string, number][]) : [])];
  for (const [provider, id] of tries) {
    const r = await jellyfinFetch<{ Items: JfItem[] }>(`/Items?AnyProviderIdEquals=${provider.toLowerCase()}.${id}&Recursive=true&IncludeItemTypes=${type}&Fields=ProviderIds&Limit=10`);
    const hit = r.Items.find((i) => Object.entries(i.ProviderIds ?? {}).some(([k, v]) => k.toLowerCase() === provider.toLowerCase() && v === String(id)));
    if (hit) return hit;
  }
  return null;
}

interface JfSession { Id: string; UserId?: string; DeviceName?: string; Client?: string; SupportsRemoteControl?: boolean; LastActivityDate?: string }

/** Players we can start something on (the TV shows up while Jellyfin is open on it). */
export async function playerSessions(): Promise<(WatchSession & { userId: string | null })[]> {
  const list = await jellyfinFetch<JfSession[]>('/Sessions?ActiveWithinSeconds=1800');
  return list
    .filter((s) => s.SupportsRemoteControl)
    .sort((a, b) => (b.LastActivityDate ?? '').localeCompare(a.LastActivityDate ?? ''))
    .map((s) => ({ id: s.Id, name: [s.DeviceName, s.Client && s.Client !== s.DeviceName ? `(${s.Client})` : ''].filter(Boolean).join(' '), userId: s.UserId ?? null }));
}

/** Starts the film (or the next episode of the series for that player's user) on a player. */
export async function playOn(sessionId: string, item: JfItem) {
  const session = (await playerSessions()).find((s) => s.id === sessionId);
  if (!session) throw new ArrError('That player is gone. Open Jellyfin on the TV and try again');
  let play = item.Id;
  if (item.Type === 'Series') {
    const user = session.userId ? `&UserId=${session.userId}` : '';
    const next = session.userId ? await jellyfinFetch<{ Items: JfItem[] }>(`/Shows/NextUp?SeriesId=${item.Id}${user}&Limit=1`).catch(() => ({ Items: [] })) : { Items: [] };
    const first = next.Items[0] ?? (await jellyfinFetch<{ Items: JfItem[] }>(`/Items?ParentId=${item.Id}&Recursive=true&IncludeItemTypes=Episode&SortBy=ParentIndexNumber,IndexNumber&SortOrder=Ascending${user}${user ? '&IsPlayed=false' : ''}&Limit=1`)).Items[0];
    if (!first) throw new ArrError('No episodes on Jellyfin yet');
    play = first.Id;
  }
  await jellyfinFetch(`/Sessions/${sessionId}/Playing?playCommand=PlayNow&itemIds=${play}`, { method: 'POST' });
}

/** Asks Jellyfin to look for new files (after an import or a delete). */
export async function refreshJellyfin() {
  if (!jellyfinEnabled()) return;
  await jellyfinFetch('/Library/Refresh', { method: 'POST' });
}

// ---- My list -----------------------------------------------------------------------------------

const ep = (e: { seasonNumber: number; episodeNumber: number }) => `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}`;

/** Downloading, wanted and recently added, from Radarr and Sonarr. `tmdbOf` finds TMDB ids Sonarr doesn't have. */
export async function myList(tmdbOf: (tvdbId: number) => Promise<number | null>, now = new Date()) {
  const lib = await library();
  const today = dateKey(now);
  const movieById = new Map(lib.movies.map((m) => [m.id, m]));
  const seriesById = new Map(lib.series.map((s) => [s.id, s]));
  const seriesTmdb = async (s: SonarrSeries) => s.tmdbId || (await tmdbOf(s.tvdbId).catch(() => null));
  const movieRow = (m: RadarrMovie, sub: string, at: string | null, progress?: number): WatchListItem => ({ kind: 'movie', id: m.tmdbId, title: m.title, year: m.year ?? null, poster: posterOf(m.images), sub, at, progress });
  const seriesRow = async (s: SonarrSeries, sub: string, at: string | null, progress?: number): Promise<WatchListItem> => ({ kind: 'tv', id: await seriesTmdb(s), title: s.title, year: s.year ?? null, poster: posterOf(s.images), sub, at, progress });

  const downloading: WatchListItem[] = [];
  for (const m of new Set(lib.movieQueue.map((q) => q.movieId))) {
    const movie = m !== undefined ? movieById.get(m) : undefined;
    if (movie) {
      const st = movieStatus(movie, lib.movieQueue, now);
      downloading.push(movieRow(movie, st.text, null, st.progress));
    }
  }
  for (const id of new Set(lib.seriesQueue.map((q) => q.seriesId))) {
    const s = id !== undefined ? seriesById.get(id) : undefined;
    if (!s) continue;
    const st = seriesStatus(s, lib.seriesQueue, now);
    const eps = lib.seriesQueue.filter((q) => q.seriesId === id && q.episode).map((q) => ep(q.episode!));
    downloading.push(await seriesRow(s, `${eps.length ? `${eps.slice(0, 3).join(', ')}${eps.length > 3 ? '…' : ''} · ` : ''}${st.text}`, null, st.progress));
  }

  const queued = new Set(lib.movieQueue.map((q) => q.movieId));
  const wantedMovies = lib.movies
    .filter((m) => m.monitored && !m.hasFile && !queued.has(m.id))
    .map((m) => ({ m, out: (m.digitalRelease ?? m.physicalRelease ?? '').slice(0, 10) }))
    .sort((a, b) => (a.out || '9999').localeCompare(b.out || '9999'))
    .map(({ m, out }) => movieRow(m, !out ? 'No digital date yet' : out > today ? `Out on ${shortDate(out)}` : `Out since ${shortDate(out)} · looking for a copy`, out || null));
  const wantedSeries = await Promise.all(
    lib.series
      .filter((s) => s.monitored && !(s.statistics?.episodeFileCount ?? 0) && !lib.seriesQueue.some((q) => q.seriesId === s.id))
      .map((s) => seriesRow(s, s.nextAiring ? `Next episode on ${shortDate(s.nextAiring)}` : 'Looking for episodes', s.nextAiring ?? null)),
  );
  const wanted = [...wantedMovies, ...wantedSeries].sort((a, b) => (a.at ?? '9999').localeCompare(b.at ?? '9999'));

  // Recently imported, newest first: one row per film, and per series (its latest episodes).
  const history = (a: Arr, include: string) =>
    arrEnabled(a) ? arrFetch<{ records: HistoryRecord[] }>(a, `/history?page=1&pageSize=60&sortKey=date&sortDirection=descending&eventType=3${include}`).then((r) => r.records ?? []).catch(() => []) : Promise.resolve([]);
  const [mh, sh] = await Promise.all([history('radarr', '&includeMovie=true'), history('sonarr', '&includeSeries=true&includeEpisode=true')]);
  const recent: WatchListItem[] = [];
  const seenMovies = new Set<number>();
  for (const r of mh) {
    const m = r.movie ?? (r.movieId ? movieById.get(r.movieId) : undefined);
    if (!m || seenMovies.has(m.id) || !movieById.get(m.id)?.hasFile) continue;
    seenMovies.add(m.id);
    recent.push(movieRow(m, `Added ${shortDate(r.date)}`, r.date));
  }
  const bySeries = new Map<number, HistoryRecord[]>();
  for (const r of sh) if (r.seriesId && seriesById.has(r.seriesId)) bySeries.set(r.seriesId, [...(bySeries.get(r.seriesId) ?? []), r]);
  for (const [id, records] of bySeries) {
    const eps = [...new Set(records.filter((r) => r.episode).map((r) => ep(r.episode!)))];
    const what = eps.length > 2 ? `${eps.length} episodes` : eps.join(', ');
    recent.push(await seriesRow(seriesById.get(id)!, `${what ? `${what} · ` : ''}added ${shortDate(records[0]!.date)}`, records[0]!.date));
  }
  recent.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return { downloading, wanted, recent: recent.slice(0, 20) };
}

// ---- Wanted films that are out: search once a day ----------------------------------------------

const SEARCHED_KEY = 'watch:searched'; // Radarr movie id → the day we last asked Radarr to search for it

/** Monitored films without a file whose digital date has passed and weren't searched today. */
export function dueForSearch(movies: RadarrMovie[], searched: Record<string, string>, today: string): number[] {
  return movies
    .filter((m) => m.monitored && !m.hasFile && m.digitalRelease && m.digitalRelease.slice(0, 10) <= today && searched[m.id] !== today)
    .map((m) => m.id);
}

/**
 * RSS only catches new uploads, so a wanted film that came out a while ago can be missed: from 10:00, ask Radarr
 * to search for each one, at most once a day.
 */
export async function runWantedSearch(db: Db, now = new Date()) {
  if (!arrEnabled('radarr') || now.getHours() < 10) return;
  const today = dateKey(now);
  const [row] = await db.select().from(settings).where(eq(settings.key, SEARCHED_KEY));
  const searched = row ? (JSON.parse(row.value) as Record<string, string>) : {};
  const movies = await arrFetch<RadarrMovie[]>('radarr', '/movie');
  const due = dueForSearch(movies, searched, today);
  if (!due.length) return;
  await arrFetch('radarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: due }) });
  const wanted = new Set(movies.filter((m) => m.monitored && !m.hasFile).map((m) => String(m.id)));
  const next = Object.fromEntries([...Object.entries(searched).filter(([id]) => wanted.has(id)), ...due.map((id) => [String(id), today])]);
  const value = JSON.stringify(next);
  await db.insert(settings).values({ key: SEARCHED_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

// ---- Health ------------------------------------------------------------------------------------

/** Problems with Radarr/Sonarr/Jellyfin for the health line, and what answered fine. */
export async function arrHealth(): Promise<{ problems: string[]; ok: string[] }> {
  const problems: string[] = [];
  const ok: string[] = [];
  const missing = [...(['radarr', 'sonarr'] as Arr[]).filter((a) => !arrEnabled(a)).map((a) => NAME[a]), ...(jellyfinEnabled() ? [] : ['Jellyfin'])];
  if (missing.length) problems.push(`${missing.join(', ')} not set up`);
  await Promise.all([
    ...(['radarr', 'sonarr'] as Arr[]).filter(arrEnabled).map(async (a) => {
      try {
        const issues = await arrFetch<{ type: string; message: string }[]>(a, '/health');
        const bad = issues.filter((i) => i.type === 'warning' || i.type === 'error');
        for (const i of bad) problems.push(`${NAME[a]}: ${i.message}`);
        if (!bad.length) ok.push(NAME[a]);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }),
    (async () => {
      if (!jellyfinEnabled()) return;
      try {
        await jellyfinFetch('/System/Info');
        ok.push('Jellyfin');
      } catch (e) {
        problems.push((e as Error).message);
      }
    })(),
  ]);
  return { problems, ok };
}
