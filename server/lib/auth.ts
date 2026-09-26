import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../db';
import { members, sessions } from '../schema';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'family_session';
export const SESSION_DAYS = 400;

export type MemberRow = typeof members.$inferSelect;
export type AuthEnv = { Variables: { me: MemberRow | null } };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split('$');
  if (!salt || !key) return false;
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), 32);
  const expected = Buffer.from(key, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function opsTokenMatches(given: string): boolean {
  const expected = process.env.OPS_TOKEN;
  if (!expected || expected.length < 32) return false;
  const a = Buffer.from(sha256(given));
  const b = Buffer.from(sha256(expected));
  return timingSafeEqual(a, b);
}

export async function createSession(db: Db, memberId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), memberId, expiresAt });
  return token;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Loads the signed-in member (or null) into c.var.me. */
export function loadMember(db: Db) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    let me: MemberRow | null = null;
    const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (bearer && opsTokenMatches(bearer)) {
      // The ops container (Claude in Tiago's operator session) acts as the parent named in OPS_MEMBER.
      const [row] = await db.select().from(members).where(eq(members.name, process.env.OPS_MEMBER || 'Tiago'));
      me = row ?? null;
    } else if (token) {
      const [row] = await db
        .select({ member: members })
        .from(sessions)
        .innerJoin(members, eq(members.id, sessions.memberId))
        .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
      me = row?.member ?? null;
    }
    c.set('me', me);
    await next();
  });
}

/** Everyone can look; only parents change things. */
export const requireParent = createMiddleware<AuthEnv>(async (c, next) => {
  const me = c.get('me');
  if (!me) return c.json({ error: 'Sign in as a parent to make changes' }, 401);
  if (me.role !== 'parent') return c.json({ error: 'Only parents can make changes' }, 403);
  await next();
});
