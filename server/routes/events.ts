import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db';
import { type AuthEnv, requireParent } from '../lib/auth';
import { eventValues, getEvent, listOccurrences, setParticipants } from '../lib/calendar';
import { events } from '../schema';
import { EventInputSchema, RangeSchema, problem } from './validation';

export interface EventHooks {
  changed: (id: string) => void; // e.g. push to Google
  removed: (googleId: string) => void;
}

export function eventRoutes(db: Db, hooks: EventHooks) {
  const r = new Hono<AuthEnv>();

  r.get('/calendar', async (c) => {
    const range = RangeSchema.safeParse(c.req.query());
    if (!range.success) return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400);
    const days = (Date.parse(range.data.to) - Date.parse(range.data.from)) / 86_400_000;
    if (days < 1 || days > 62) return c.json({ error: 'Ask for 1 to 62 days at a time' }, 400);
    return c.json(await listOccurrences(db, range.data.from, range.data.to));
  });

  r.get('/events/:id', async (c) => {
    const ev = await getEvent(db, c.req.param('id'));
    return ev ? c.json(ev) : c.json({ error: 'Not found' }, 404);
  });

  r.post('/events', requireParent, async (c) => {
    const parsed = EventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const id = randomUUID();
    await db.insert(events).values({ id, ...eventValues(parsed.data), createdBy: c.get('me')!.id });
    await setParticipants(db, id, parsed.data.participants);
    hooks.changed(id);
    return c.json(await getEvent(db, id), 201);
  });

  r.patch('/events/:id', requireParent, async (c) => {
    const id = c.req.param('id');
    const parsed = EventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [row] = await db.update(events).set(eventValues(parsed.data)).where(eq(events.id, id)).returning();
    if (!row) return c.json({ error: 'Not found' }, 404);
    await setParticipants(db, id, parsed.data.participants);
    hooks.changed(id);
    return c.json(await getEvent(db, id));
  });

  // Tick an item on the "bring" list (anyone may do this: kids pack their own bags).
  r.post('/events/:id/bring/:index', async (c) => {
    const [row] = await db.select().from(events).where(eq(events.id, c.req.param('id')));
    const i = Number(c.req.param('index'));
    if (!row || !row.bring[i]) return c.json({ error: 'Not found' }, 404);
    const bring = row.bring.map((b, j) => (j === i ? { ...b, done: !b.done } : b));
    await db.update(events).set({ bring, updatedAt: new Date() }).where(eq(events.id, row.id));
    return c.json({ bring });
  });

  // ?occurrence=<ISO start> removes just that date of a repeating event.
  r.delete('/events/:id', requireParent, async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(events).where(eq(events.id, id));
    if (!row) return c.body(null, 204);
    const occurrence = c.req.query('occurrence');
    if (occurrence && row.rrule) {
      await db.update(events).set({ exdates: [...row.exdates, new Date(occurrence).toISOString()], updatedAt: new Date() }).where(eq(events.id, id));
      hooks.changed(id);
    } else {
      await db.delete(events).where(eq(events.id, id));
      if (row.googleId) hooks.removed(row.googleId);
    }
    return c.body(null, 204);
  });

  return r;
}
