import { and, asc, desc, eq, isNull, isNotNull, not, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { GroceryList } from '../../shared/types';
import type { Db } from '../db';
import type { AuthEnv } from '../lib/auth';
import { SECTIONS, sectionOf, splitItems } from '../lib/grocery';
import { groceries } from '../schema';

// Anyone may use the list (like fridge notes): kids add their cereal, whoever is at the shop ticks.
// Every change answers with the whole list, so the screen just shows what comes back.
export function groceryRoutes(db: Db) {
  const r = new Hono<AuthEnv>();

  async function list(): Promise<GroceryList> {
    const rows = await db.select().from(groceries).where(isNull(groceries.clearedAt)).orderBy(asc(groceries.createdAt), asc(groceries.id));
    const onList = new Set(rows.map((g) => g.text.toLowerCase()));
    const often = await db
      .select({ text: sql<string>`min(${groceries.text})`, n: sql<number>`count(*)` })
      .from(groceries)
      .where(isNotNull(groceries.clearedAt))
      .groupBy(sql`lower(${groceries.text})`)
      .orderBy(desc(sql`count(*)`), desc(sql`max(${groceries.createdAt})`))
      .limit(24);
    return {
      items: rows.map((g) => ({ id: g.id, text: g.text, section: g.section, done: g.done })),
      sections: [...SECTIONS],
      suggestions: often.map((o) => o.text).filter((t) => !onList.has(t.toLowerCase())).slice(0, 12),
    };
  }

  r.get('/', async (c) => c.json(await list()));

  // "leite, pão e ovos" adds three. Something already on the list isn't added twice (a ticked one comes back).
  r.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const items = splitItems(typeof body?.text === 'string' ? body.text : '');
    if (!items.length) return c.json({ error: 'Type what to buy' }, 400);
    const open = await db.select().from(groceries).where(isNull(groceries.clearedAt));
    for (const text of items) {
      const same = open.find((g) => g.text.toLowerCase() === text.toLowerCase());
      if (same) {
        if (same.done) await db.update(groceries).set({ done: false }).where(eq(groceries.id, same.id));
      } else {
        await db.insert(groceries).values({ text, section: sectionOf(text) });
      }
    }
    return c.json(await list(), 201);
  });

  r.post('/:id/toggle', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    await db.update(groceries).set({ done: not(groceries.done) }).where(eq(groceries.id, id));
    return c.json(await list());
  });

  // Put it in another section (the guess was wrong).
  r.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(id) || !(SECTIONS as readonly string[]).includes(body?.section)) return c.json({ error: 'Pick a section' }, 400);
    await db.update(groceries).set({ section: body.section }).where(eq(groceries.id, id));
    return c.json(await list());
  });

  r.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad id' }, 400);
    await db.delete(groceries).where(eq(groceries.id, id));
    return c.json(await list());
  });

  // Done shopping: ticked items leave the list (and count towards suggestions).
  r.post('/clear', async (c) => {
    await db.update(groceries).set({ clearedAt: new Date() }).where(and(isNull(groceries.clearedAt), eq(groceries.done, true)));
    return c.json(await list());
  });

  return r;
}
