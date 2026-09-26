import { Hono } from 'hono';
import { asc, sql } from 'drizzle-orm';
import type { AppConfig, Health } from '../shared/types';
import type { Db } from './db';
import { draftEvent, aiEnabled, type ImageInput } from './lib/ai';
import { type AuthEnv, loadMember, requireParent } from './lib/auth';
import { tomorrowDigest, weekDigest } from './lib/digest';
import { googleEnabled, googleStatus, saveGoogleKey, syncRound } from './lib/google';
import { sendTelegram, telegramEnabled } from './lib/telegram';
import { authRoutes } from './routes/auth';
import { type EventHooks, eventRoutes } from './routes/events';
import { memberRoutes, toMember } from './routes/members';
import { noteRoutes } from './routes/notes';
import { members } from './schema';
import pkg from '../package.json';

export interface AppHooks extends EventHooks {
  membersChanged: () => void;
}

const noop: AppHooks = { changed: () => {}, removed: () => {}, membersChanged: () => {} };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function createApp(db: Db, hooks: AppHooks = noop) {
  const api = new Hono<AuthEnv>();

  api.get('/health', async (c) => {
    let dbUp = true;
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbUp = false;
    }
    const body: Health = {
      ok: dbUp,
      version: pkg.version,
      commit: (process.env.SOURCE_COMMIT || 'dev').slice(0, 7),
      db: dbUp ? 'up' : 'down',
    };
    return c.json(body, dbUp ? 200 : 503);
  });

  api.use('*', loadMember(db));

  api.get('/config', (c) => {
    const me = c.get('me');
    const body: AppConfig = {
      me: me ? toMember(me) : null,
      features: { ai: aiEnabled(), google: googleEnabled(), telegram: telegramEnabled() },
    };
    return c.json(body);
  });

  api.route('/auth', authRoutes(db));
  api.route('/members', memberRoutes(db, hooks.membersChanged));
  api.route('/notes', noteRoutes(db));
  api.route('/', eventRoutes(db, hooks));

  // Photo or sentence → a draft event for the form (nothing is saved here).
  api.post('/ai/event', requireParent, async (c) => {
    if (!aiEnabled()) return c.json({ error: 'Reading photos is not set up yet' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';
    let image: ImageInput | undefined;
    if (body.image) {
      if (!IMAGE_TYPES.includes(body.image.mediaType) || typeof body.image.data !== 'string') {
        return c.json({ error: 'Use a JPEG, PNG or WebP photo' }, 400);
      }
      if (body.image.data.length > 7_000_000) return c.json({ error: 'That photo is too large (max 5 MB)' }, 400);
      image = body.image;
    }
    if (!text && !image) return c.json({ error: 'Type something or add a photo' }, 400);
    const family = await db.select().from(members).orderBy(asc(members.sort));
    try {
      return c.json(await draftEvent({ text: text || undefined, image }, family));
    } catch (e) {
      console.error('ai draft:', (e as Error).message);
      return c.json({ error: (e as Error).message.startsWith("Couldn't") ? (e as Error).message : 'Reading that failed. Try again in a moment.' }, 502);
    }
  });

  api.get('/google', requireParent, async (c) => c.json(await googleStatus(db)));

  // A parent pastes the service account key once; it is checked with Google and kept in the database.
  api.post('/google', requireParent, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.key !== 'string' || body.key.length > 10_000) return c.json({ error: 'Paste the whole key file (JSON)' }, 400);
    try {
      await saveGoogleKey(db, body.key);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg.includes('JSON') ? 'That is not valid JSON — paste the whole file' : `Google did not accept that key: ${msg}` }, 400);
    }
    await syncRound(db);
    return c.json(await googleStatus(db));
  });

  // Send the Telegram digests now (for testing): ?kind=tomorrow|week
  api.post('/digest', requireParent, async (c) => {
    const msg = c.req.query('kind') === 'week' ? await weekDigest(db) : await tomorrowDigest(db);
    if (!msg) return c.json({ sent: false, reason: 'Nothing on tomorrow' });
    return c.json({ sent: await sendTelegram(msg) });
  });

  return new Hono().route('/api', api);
}
