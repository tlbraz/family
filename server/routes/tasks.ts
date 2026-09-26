import { and, asc, eq, gte, lt, not, or } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Task } from '../../shared/types';
import type { Db } from '../db';
import { type AuthEnv, requireParent } from '../lib/auth';
import { tasks } from '../schema';
import { RangeSchema, TaskInputSchema, problem } from './validation';

export function taskRoutes(db: Db) {
  const r = new Hono<AuthEnv>();

  // Tasks due in [from, to), plus anything still open from before (shown as overdue today).
  r.get('/', async (c) => {
    const range = RangeSchema.safeParse(c.req.query());
    if (!range.success) return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400);
    const { from, to } = range.data;
    const rows = await db
      .select()
      .from(tasks)
      .where(and(lt(tasks.due, to), or(gte(tasks.due, from), not(tasks.done))))
      .orderBy(asc(tasks.due), asc(tasks.id));
    return c.json(rows.map(toTask));
  });

  r.post('/', requireParent, async (c) => {
    const parsed = TaskInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [row] = await db.insert(tasks).values(parsed.data).returning();
    return c.json(toTask(row!), 201);
  });

  r.patch('/:id', requireParent, async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    const parsed = TaskInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [row] = await db.update(tasks).set(parsed.data).where(eq(tasks.id, id)).returning();
    return row ? c.json(toTask(row)) : c.json({ error: 'Not found' }, 404);
  });

  // Tick it off (anyone may: kids can mark their own slip as handed in).
  r.post('/:id/done', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    const [row] = await db.update(tasks).set({ done: not(tasks.done) }).where(eq(tasks.id, id)).returning();
    return row ? c.json(toTask(row)) : c.json({ error: 'Not found' }, 404);
  });

  r.delete('/:id', requireParent, async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    await db.delete(tasks).where(eq(tasks.id, id));
    return c.body(null, 204);
  });

  return r;
}

export function toTask(row: typeof tasks.$inferSelect): Task {
  return { id: row.id, title: row.title, due: row.due, memberId: row.memberId, done: row.done };
}
