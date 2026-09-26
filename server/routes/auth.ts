import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Db } from '../db';
import { type AuthEnv, SESSION_COOKIE, SESSION_DAYS, createSession, deleteSession, hashPassword, verifyPassword } from '../lib/auth';
import { members } from '../schema';

export function authRoutes(db: Db) {
  const r = new Hono<AuthEnv>();

  // Parents sign in with their own password. The first sign-in sets it.
  r.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const memberId = Number(body.memberId);
    const password = typeof body.password === 'string' ? body.password : '';
    const [m] = await db.select().from(members).where(eq(members.id, memberId));
    if (!m || m.role !== 'parent') return c.json({ error: 'Only parents sign in' }, 400);
    if (!m.passwordHash) {
      if (password.length < 6) return c.json({ error: 'Choose a password of at least 6 characters' }, 400);
      await db.update(members).set({ passwordHash: await hashPassword(password) }).where(eq(members.id, m.id));
    } else if (!(await verifyPassword(password, m.passwordHash))) {
      return c.json({ error: 'Wrong password' }, 401);
    }
    const token = await createSession(db, m.id);
    const secure = c.req.header('x-forwarded-proto') === 'https';
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400 });
    return c.json({ ok: true });
  });

  r.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  return r;
}
