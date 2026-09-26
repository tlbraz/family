import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Member } from '../../shared/types';
import type { Db } from '../db';
import { type AuthEnv, type MemberRow, requireParent } from '../lib/auth';
import { members } from '../schema';
import { MemberInputSchema, problem } from './validation';

export const toMember = (m: MemberRow): Member => ({
  id: m.id,
  name: m.name,
  role: m.role,
  color: m.color,
  birthday: m.birthday,
  googleEmail: m.googleEmail,
  hasPassword: !!m.passwordHash,
});

export function memberRoutes(db: Db, onChange: () => void) {
  const r = new Hono<AuthEnv>();

  r.get('/', async (c) => {
    const rows = await db.select().from(members).orderBy(asc(members.sort), asc(members.id));
    return c.json(rows.map(toMember));
  });

  r.post('/', requireParent, async (c) => {
    const parsed = MemberInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [row] = await db.insert(members).values({ ...parsed.data, sort: 99 }).returning();
    onChange();
    return c.json(toMember(row!), 201);
  });

  r.patch('/:id', requireParent, async (c) => {
    const parsed = MemberInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [row] = await db.update(members).set(parsed.data).where(eq(members.id, Number(c.req.param('id')))).returning();
    if (!row) return c.json({ error: 'Not found' }, 404);
    onChange();
    return c.json(toMember(row));
  });

  r.delete('/:id', requireParent, async (c) => {
    const id = Number(c.req.param('id'));
    if (id === c.get('me')!.id) return c.json({ error: "You can't remove yourself" }, 400);
    await db.delete(members).where(eq(members.id, id));
    return c.body(null, 204);
  });

  return r;
}
