import { Hono } from 'hono';
import { asc, sql } from 'drizzle-orm';
import type { AppConfig, Health, MoneyBudget } from '../shared/types';
import type { Db } from './db';
import { AiError, draftEvent, aiEnabled, type ImageInput } from './lib/ai';
import { type AuthEnv, loadMember, requireParent } from './lib/auth';
import { todayDigest, tomorrowDigest, weekDigest } from './lib/digest';
import { googleEnabled, googleStatus, saveGoogleKey, syncRound } from './lib/google';
import { cleanHoldings, lastValuations, loadHoldings, revalueNow, saveHoldings } from './lib/valuations';
import { budgetsFor, editTransaction, moneyEnabled, moneySnapshot, refreshMoney, ReviewError, reviewTransaction, summarise } from './lib/money';
import { addTelegramChat, removeTelegramChat, sendTelegram, telegramStatus } from './lib/telegram';
import { authRoutes } from './routes/auth';
import { type EventHooks, eventRoutes } from './routes/events';
import { memberRoutes, toMember } from './routes/members';
import { groceryRoutes } from './routes/groceries';
import { noteRoutes } from './routes/notes';
import { shareRoutes } from './routes/share';
import { taskRoutes } from './routes/tasks';
import { bpRoutes } from './routes/bp';
import { bpSettingsOf } from './lib/bp';
import { upcomingRoutes } from './routes/upcoming';
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

  api.get('/config', async (c) => {
    const me = c.get('me');
    const body: AppConfig = {
      me: me ? toMember(me) : null,
      meTracksBp: me?.role === 'parent' && !!(await bpSettingsOf(db, me.id)),
      features: { ai: aiEnabled(), google: googleEnabled(), telegram: !!process.env.TELEGRAM_BOT_TOKEN, money: moneyEnabled() && me?.role === 'parent' },
    };
    return c.json(body);
  });

  api.route('/auth', authRoutes(db));
  api.route('/members', memberRoutes(db, hooks.membersChanged));
  api.route('/notes', noteRoutes(db));
  api.route('/groceries', groceryRoutes(db));
  api.route('/share', shareRoutes());
  api.route('/tasks', taskRoutes(db));
  api.route('/bp', bpRoutes(db));
  api.route('/upcoming', upcomingRoutes(db));
  api.route('/', eventRoutes(db, hooks));

  // Photo or sentence → a draft event for the form (nothing is saved here).
  api.post('/ai/event', requireParent, async (c) => {
    if (!aiEnabled()) return c.json({ error: 'Reading photos is not set up yet' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
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
      if (!(e instanceof AiError)) console.error('ai draft:', (e as Error).message);
      return c.json({ error: e instanceof AiError ? e.message : 'Reading that failed. Try again in a moment.' }, 502);
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

  // The Money tab: a summary of Actual Budget, for parents only (the company budget only for its viewers).
  api.get('/money', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    const budgets = budgetsFor(c.get('me')!.name);
    const budget = (c.req.query('budget') ?? 'family') as MoneyBudget;
    if (!budgets.includes(budget)) return c.json({ error: 'Not available' }, 403);
    const now = new Date();
    const month = /^\d{4}-\d{2}$/.test(c.req.query('month') ?? '') ? c.req.query('month')! : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
      return c.json(summarise(await moneySnapshot(budget), budget, budgets, month, now));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 503);
    }
  });
  // Done reviewing a #review transaction: optionally a new category, and the tag comes out of the notes.
  api.post('/money/review', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { budget?: string; id?: unknown; category?: unknown };
    const budget = (body.budget ?? 'family') as MoneyBudget;
    if (!budgetsFor(c.get('me')!.name).includes(budget)) return c.json({ error: 'Not available' }, 403);
    if (typeof body.id !== 'string' || (body.category !== undefined && typeof body.category !== 'string')) {
      return c.json({ error: 'Pick a transaction' }, 400);
    }
    try {
      await reviewTransaction(budget, body.id, body.category as string | undefined);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, e instanceof ReviewError ? 400 : 503);
    }
  });
  // Change any transaction from the app: its category and/or the #review tag.
  api.post('/money/edit', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { budget?: string; id?: unknown; category?: unknown; review?: unknown; note?: unknown };
    const budget = (body.budget ?? 'family') as MoneyBudget;
    if (!budgetsFor(c.get('me')!.name).includes(budget)) return c.json({ error: 'Not available' }, 403);
    const bad = typeof body.id !== 'string' || (body.category !== undefined && typeof body.category !== 'string') || (body.review !== undefined && typeof body.review !== 'boolean') || (body.note !== undefined && typeof body.note !== 'string');
    if (bad) return c.json({ error: 'Pick a transaction' }, 400);
    try {
      await editTransaction(budget, body.id as string, { category: body.category as string | undefined, review: body.review as boolean | undefined, note: body.note as string | undefined });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, e instanceof ReviewError ? 400 : 503);
    }
  });
  // What the investment accounts hold, for the daily values (edited on the Money tab).
  api.get('/money/holdings', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    const snap = await moneySnapshot('family').catch(() => null);
    const accounts = (snap?.accounts ?? []).filter((a) => a.offBudget).map((a) => a.name);
    return c.json({ holdings: await loadHoldings(db), last: await lastValuations(db), accounts });
  });
  api.put('/money/holdings', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    let holdings;
    try {
      holdings = cleanHoldings(((await c.req.json().catch(() => ({}))) as { holdings?: unknown }).holdings);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    await saveHoldings(db, holdings);
    await revalueNow(db).catch((e: Error) => console.error('valuation:', e.message));
    return c.json({ holdings, last: await lastValuations(db), accounts: [] });
  });
  api.post('/money/refresh', requireParent, async (c) => {
    if (!moneyEnabled()) return c.json({ error: 'Actual Budget is not set up on the server' }, 404);
    await refreshMoney();
    return c.json({ ok: true });
  });

  // Send the Telegram digests now (for testing): ?kind=today|tomorrow|week
  api.post('/digest', requireParent, async (c) => {
    const kind = c.req.query('kind');
    const msg = kind === 'week' ? await weekDigest(db) : kind === 'today' ? await todayDigest(db) : await tomorrowDigest(db);
    if (!msg) return c.json({ sent: false, reason: `Nothing on ${kind === 'today' ? 'today' : 'tomorrow'}` });
    return c.json({ sent: await sendTelegram(msg) });
  });

  // Who gets the Telegram messages. Someone opens the bot and taps Start, then a parent adds them here.
  api.get('/telegram', requireParent, async (c) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) return c.json({ error: 'Telegram is not set up on the server' }, 400);
    return c.json(await telegramStatus());
  });
  api.post('/telegram/chats', requireParent, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id ?? '').trim();
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (!/^-?\d{1,20}$/.test(id) || !name) return c.json({ error: 'Pick someone from the list' }, 400);
    await addTelegramChat(db, { id, name });
    const sent = await sendTelegram(`👋 Hi ${name.replace(/[<>&]/g, '')}! You'll now get the family calendar messages here.`, id);
    return c.json({ ...(await telegramStatus()), sent });
  });
  api.delete('/telegram/chats/:id', requireParent, async (c) => {
    await removeTelegramChat(db, c.req.param('id'));
    return c.json(await telegramStatus());
  });

  return new Hono().route('/api', api);
}
