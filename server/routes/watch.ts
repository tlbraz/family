import { Hono } from 'hono';
import type { WatchDetail, WatchHealth, WatchKind, WatchSection } from '../../shared/types';
import type { Db } from '../db';
import type { AuthEnv } from '../lib/auth';
import { requireParent } from '../lib/auth';
import {
  addMovie, addSeries, ArrError, arrEnabled, arrFor, arrHealth, findInJellyfin, jellyfinEnabled, jellyfinLink, myList, playerSessions, playOn,
  removeTitle, type SeriesMonitor, statusLookup, statusOf,
} from '../lib/arr';
import { arrivals, hookTokenMatches, parseArrHook } from '../lib/arrivals';
import { memo } from '../lib/memo';
import { genres, releases, search, TmdbError, tmdbCheck, tmdbEnabled, tmdbIdForTvdb, titleDetail } from '../lib/tmdb';

const KINDS: WatchKind[] = ['movie', 'tv'];
const SECTIONS: WatchSection[] = ['out', 'soon', 'popular'];
const MONITORS: SeriesMonitor[] = ['all', 'latestSeason', 'future'];
const healthCache = memo(4);

/** A friendly message and the right status for a failure from TMDB / Radarr / Sonarr / Jellyfin. */
function fail(e: unknown) {
  const known = e instanceof TmdbError || e instanceof ArrError;
  if (!known) console.error('watch:', (e as Error).message);
  const status = (e as Error).message === 'TMDB has no such title' ? 404 : known && / answered 400/.test((e as Error).message) ? 400 : 503;
  return { error: known ? (e as Error).message : 'Something went wrong. Try again in a moment.', status } as const;
}

/** The Entertainment tab: releases from TMDB, getting them with Radarr/Sonarr, playing them on Jellyfin. Parents only. */
export function watchRoutes() {
  const r = new Hono<AuthEnv>();
  r.use('*', requireParent);

  // Only what's wrong (kept a minute); nothing set up is a problem too, so the line says what's missing.
  r.get('/health', async (c) => {
    const body = await healthCache.get('health', 60_000, async (): Promise<WatchHealth> => {
      const [tmdb, arr] = await Promise.all([tmdbCheck(), arrHealth()]);
      return { problems: [...(tmdb ? [tmdb] : []), ...arr.problems], ok: [...(tmdb ? [] : ['TMDB']), ...arr.ok] };
    });
    return c.json(body);
  });

  r.get('/genres', async (c) => {
    const kind = c.req.query('kind') as WatchKind;
    if (!KINDS.includes(kind)) return c.json({ error: 'Pick films or TV' }, 400);
    if (!tmdbEnabled()) return c.json([]);
    try {
      return c.json(await genres(kind));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  r.get('/releases', async (c) => {
    const kind = c.req.query('kind') as WatchKind;
    const section = c.req.query('section') as WatchSection;
    if (!KINDS.includes(kind) || !SECTIONS.includes(section)) return c.json({ error: 'Pick a list' }, 400);
    const num = (k: string) => (/^\d{1,6}$/.test(c.req.query(k) ?? '') ? Number(c.req.query(k)) : undefined);
    if (!tmdbEnabled()) return c.json({ error: 'TMDB key missing' }, 503);
    try {
      return c.json(await releases({ kind, section, genre: num('genre'), page: Math.min(num('page') ?? 1, 50) || 1 }, await statusLookup()));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // Films and series by name, from the search box.
  r.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    if (q.length < 2) return c.json({ items: [], next: false });
    const page = /^\d{1,2}$/.test(c.req.query('page') ?? '') ? Math.min(Math.max(Number(c.req.query('page')), 1), 20) : 1;
    if (!tmdbEnabled()) return c.json({ error: 'TMDB key missing' }, 503);
    try {
      return c.json(await search(q, page, await statusLookup()));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // One title: TMDB's details with where it stands in Radarr/Sonarr and whether Jellyfin has it.
  async function detail(kind: WatchKind, id: number): Promise<WatchDetail> {
    const { detail, tvdbId } = await titleDetail(kind, id);
    const [status, jf] = await Promise.all([statusOf(kind, id, tvdbId).catch(() => null), findInJellyfin(kind, id, tvdbId).catch(() => null)]);
    return { ...detail, status, jellyfin: jf ? { id: jf.Id, url: jellyfinLink(jf.Id) } : null, can: { arr: arrEnabled(arrFor(kind)), jellyfin: jellyfinEnabled() } };
  }
  const title = '/title/:kind{movie|tv}/:id{[0-9]+}';
  const params = (c: { req: { param: (k: string) => string } }) => ({ kind: c.req.param('kind') as WatchKind, id: Number(c.req.param('id')) });

  r.get(title, async (c) => {
    const { kind, id } = params(c);
    try {
      return c.json(await detail(kind, id));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // Get it (search now) or Want it (comes when it's out). Series: whole / latest season / only new episodes.
  r.post(title, async (c) => {
    const { kind, id } = params(c);
    const b = (await c.req.json().catch(() => ({}))) as { search?: unknown; monitor?: unknown };
    const monitor = (b.monitor ?? 'all') as SeriesMonitor;
    if (typeof b.search !== 'boolean' || (kind === 'tv' && !MONITORS.includes(monitor))) return c.json({ error: 'Pick what to get' }, 400);
    if (!arrEnabled(arrFor(kind))) return c.json({ error: `${kind === 'movie' ? 'Radarr' : 'Sonarr'} is not set up on the server` }, 503);
    try {
      if (kind === 'movie') await addMovie(id, b.search);
      else {
        const { tvdbId } = await titleDetail(kind, id);
        if (!tvdbId) return c.json({ error: 'TMDB has no TVDB id for this series, so Sonarr can’t find it. Add it in Sonarr.' }, 400);
        await addSeries(tvdbId, monitor, b.search && monitor !== 'future');
      }
      return c.json(await detail(kind, id));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // Delete from Radarr/Sonarr with the files, then Jellyfin rescans.
  r.delete(title, async (c) => {
    const { kind, id } = params(c);
    try {
      const { tvdbId } = await titleDetail(kind, id).catch(() => ({ tvdbId: null }));
      const st = await statusOf(kind, id, tvdbId);
      if (!st?.arrId) return c.json({ error: 'It isn’t in the library' }, 404);
      await removeTitle(kind, st.arrId);
      return c.json(await detail(kind, id));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // Players we can start it on (Jellyfin open on the TV), and "play there".
  r.get('/players', async (c) => {
    if (!jellyfinEnabled()) return c.json({ error: 'Jellyfin is not set up on the server' }, 503);
    try {
      return c.json((await playerSessions()).map(({ id, name }) => ({ id, name })));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });
  r.post(`${title}/play`, async (c) => {
    const { kind, id } = params(c);
    const b = (await c.req.json().catch(() => ({}))) as { session?: unknown };
    if (typeof b.session !== 'string' || !/^[\w-]{1,64}$/.test(b.session)) return c.json({ error: 'Pick a player' }, 400);
    try {
      const { tvdbId } = await titleDetail(kind, id).catch(() => ({ tvdbId: null }));
      const item = await findInJellyfin(kind, id, tvdbId);
      if (!item) return c.json({ error: 'It isn’t on Jellyfin yet' }, 404);
      await playOn(b.session, item);
      return c.json({ ok: true });
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  r.get('/list', async (c) => {
    if (!arrEnabled('radarr') && !arrEnabled('sonarr')) return c.json({ error: 'Radarr and Sonarr are not set up on the server' }, 503);
    try {
      return c.json(await myList((tvdb) => (tmdbEnabled() ? tmdbIdForTvdb(tvdb) : Promise.resolve(null))));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  return r;
}

/** Radarr/Sonarr webhooks (not signed in: the shared token in ?token= instead). */
export function hookRoutes(db: Db) {
  const r = new Hono();
  const arrived = arrivals(db);
  r.post('/arr', async (c) => {
    if (!hookTokenMatches(c.req.query('token'))) return c.json({ error: 'Wrong token' }, 401);
    const event = parseArrHook(await c.req.json().catch(() => null));
    if (event && event !== 'test') void arrived(event).catch((e: Error) => console.error('arr hook:', e.message));
    return c.json({ ok: true });
  });
  return r;
}
