import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Note } from '../../shared/types';
import type { Db } from '../db';
import type { AuthEnv } from '../lib/auth';
import { notes } from '../schema';

const MAX_NOTE = 280;
const MAX_NOTES = 50;

export function noteRoutes(db: Db) {
  const r = new Hono<AuthEnv>();

  r.get('/', async (c) => {
    const rows = await db.select().from(notes).orderBy(desc(notes.createdAt)).limit(MAX_NOTES);
    return c.json(rows.map(toNote));
  });

  r.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const author = typeof body?.author === 'string' ? body.author.trim().slice(0, 40) || null : null;
    if (!text || text.length > MAX_NOTE) {
      return c.json({ error: `Note must be 1–${MAX_NOTE} characters` }, 400);
    }
    const [row] = await db.insert(notes).values({ text, author }).returning();
    return c.json(toNote(row!), 201);
  });

  r.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    await db.delete(notes).where(eq(notes.id, id));
    return c.body(null, 204);
  });

  return r;
}

function toNote(row: typeof notes.$inferSelect): Note {
  return { id: row.id, text: row.text, author: row.author, createdAt: row.createdAt.toISOString() };
}
