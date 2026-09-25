import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { notes } from './schema';
import type { Health, Note } from '../shared/types';
import pkg from '../package.json';

const MAX_NOTE = 280;
const MAX_NOTES = 50;

export function createApp(db: Db) {
  const api = new Hono();

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

  api.get('/notes', async (c) => {
    const rows = await db.select().from(notes).orderBy(desc(notes.createdAt)).limit(MAX_NOTES);
    return c.json(rows.map(toNote));
  });

  api.post('/notes', async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const author = typeof body?.author === 'string' ? body.author.trim().slice(0, 40) || null : null;
    if (!text || text.length > MAX_NOTE) {
      return c.json({ error: `Note must be 1–${MAX_NOTE} characters` }, 400);
    }
    const [row] = await db.insert(notes).values({ text, author }).returning();
    return c.json(toNote(row!), 201);
  });

  api.delete('/notes/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    await db.delete(notes).where(eq(notes.id, id));
    return c.body(null, 204);
  });

  return new Hono().route('/api', api);
}

function toNote(row: typeof notes.$inferSelect): Note {
  return { id: row.id, text: row.text, author: row.author, createdAt: row.createdAt.toISOString() };
}
