import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db';
import { type AuthEnv, requireParent } from '../lib/auth';
import { addReading, bpLog, bpSettingsOf, readingsBetween } from '../lib/bp';
import { bpReport } from '../lib/bp-report';
import { parseDateKey, addDays } from '../lib/time';
import { bpReadings, bpSettings, members } from '../schema';
import { BpInputSchema, BpSettingsSchema, RangeSchema, problem } from './validation';

/** Blood pressure, per adult, under /api/bp/:memberId. Health data: every route is for signed-in parents only. */
export function bpRoutes(db: Db) {
  const r = new Hono<AuthEnv>();
  r.use('*', requireParent);

  const adult = async (id: number) => {
    if (!Number.isInteger(id)) return null;
    const [m] = await db.select().from(members).where(eq(members.id, id));
    return m?.role === 'parent' ? m : null;
  };

  r.get('/:id', async (c) => {
    const m = await adult(Number(c.req.param('id')));
    return m ? c.json(await bpLog(db, m.id)) : c.json({ error: 'Not found' }, 404);
  });

  r.put('/:id/settings', async (c) => {
    const m = await adult(Number(c.req.param('id')));
    if (!m) return c.json({ error: 'Not found' }, 404);
    const parsed = BpSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    // Turning it off keeps the readings; they come back if it's turned on again.
    if (!parsed.data.tracking) await db.delete(bpSettings).where(eq(bpSettings.memberId, m.id));
    else {
      const telegramId = parsed.data.telegramId;
      await db.insert(bpSettings).values({ memberId: m.id, telegramId }).onConflictDoUpdate({ target: bpSettings.memberId, set: { telegramId } });
    }
    return c.json(await bpLog(db, m.id));
  });

  r.post('/:id', async (c) => {
    const m = await adult(Number(c.req.param('id')));
    if (!m || !(await bpSettingsOf(db, m.id))) return c.json({ error: 'Blood pressure is not turned on for them' }, 404);
    const parsed = BpInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    return c.json(await addReading(db, m.id, parsed.data), 201);
  });

  r.delete('/:id/readings/:reading', async (c) => {
    const id = Number(c.req.param('id'));
    const reading = Number(c.req.param('reading'));
    if (!Number.isInteger(id) || !Number.isInteger(reading)) return c.json({ error: 'Bad id' }, 400);
    await db.delete(bpReadings).where(and(eq(bpReadings.id, reading), eq(bpReadings.memberId, id)));
    return c.body(null, 204);
  });

  // The doctor report: a printable page. ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive).
  r.get('/:id/report', async (c) => {
    const m = await adult(Number(c.req.param('id')));
    if (!m) return c.json({ error: 'Not found' }, 404);
    const range = RangeSchema.safeParse(c.req.query());
    if (!range.success || range.data.from > range.data.to) return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400);
    const from = parseDateKey(range.data.from);
    const to = addDays(parseDateKey(range.data.to), 1);
    const readings = await readingsBetween(db, m.id, from, to);
    c.header('cache-control', 'no-store');
    return c.html(bpReport({ name: m.name, from: range.data.from, to: range.data.to, readings, now: new Date() }));
  });

  return r;
}
