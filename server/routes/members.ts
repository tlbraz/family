import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Member } from '../../shared/types';
import type { Db } from '../db';
import { type AuthEnv, type MemberRow, requireParent } from '../lib/auth';
import { memberPhotos, members } from '../schema';
import { MemberInputSchema, PhotoSchema, problem } from './validation';

export const toMember = (m: MemberRow): Member => ({
  id: m.id,
  name: m.name,
  role: m.role,
  color: m.color,
  birthday: m.birthday,
  googleEmail: m.googleEmail,
  hasPassword: !!m.passwordHash,
  photo: m.photoAt ? `/api/members/${m.id}/photo?v=${m.photoAt.getTime()}` : null,
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

  // The URL carries a version (?v=), so the picture can be cached for good.
  r.get('/:id/photo', async (c) => {
    const [row] = await db.select().from(memberPhotos).where(eq(memberPhotos.memberId, Number(c.req.param('id'))));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.body(Buffer.from(row.data, 'base64'), 200, { 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable' });
  });

  r.put('/:id/photo', requireParent, async (c) => {
    const parsed = PhotoSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: problem(parsed.error) }, 400);
    const [, mime, data] = parsed.data.photo.match(/^data:([^;]+);base64,(.+)$/)!;
    const id = Number(c.req.param('id'));
    const [row] = await db.update(members).set({ photoAt: new Date() }).where(eq(members.id, id)).returning();
    if (!row) return c.json({ error: 'Not found' }, 404);
    await db
      .insert(memberPhotos)
      .values({ memberId: id, mime: mime!, data: data! })
      .onConflictDoUpdate({ target: memberPhotos.memberId, set: { mime: mime!, data: data! } });
    return c.json(toMember(row));
  });

  r.delete('/:id/photo', requireParent, async (c) => {
    const id = Number(c.req.param('id'));
    await db.delete(memberPhotos).where(eq(memberPhotos.memberId, id));
    const [row] = await db.update(members).set({ photoAt: null }).where(eq(members.id, id)).returning();
    if (!row) return c.json({ error: 'Not found' }, 404);
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
