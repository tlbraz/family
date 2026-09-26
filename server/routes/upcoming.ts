import { Hono } from 'hono';
import type { Db } from '../db';
import type { AuthEnv } from '../lib/auth';
import { listOccurrences } from '../lib/calendar';
import { members } from '../schema';
import { addDays, dateKey } from '../lib/time';

// A short "what's next" list for the home.lan dashboard (Homepage customapi, dynamic-list):
// [{ title: "Swimming · Matilde", when: "Today 16:30" }, …]. Read-only, like the calendar itself.

function whenLabel(start: Date, allDay: boolean, now: Date): string {
  const days = Math.round((new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const day = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  return allDay ? day : `${day} ${start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function upcomingRoutes(db: Db) {
  const r = new Hono<AuthEnv>();
  r.get('/', async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 5) || 5, 1), 20);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const items = await listOccurrences(db, dateKey(today), dateKey(addDays(today, 14)));
    const names = new Map((await db.select().from(members)).map((m) => [m.id, m.name]));
    const list = items
      .filter((o) => (o.kind === 'event' || o.kind === 'birthday') && new Date(o.end) > now)
      .slice(0, limit)
      .map((o) => {
        const who = o.kind === 'birthday' ? '' : o.participants.map((id) => names.get(id)).filter((n): n is string => !!n && !o.title.includes(n)).join(', ');
        const start = new Date(o.start);
        return { title: who ? `${o.title} · ${who}` : o.title, when: start < now && !o.allDay ? 'Now' : whenLabel(start, o.allDay, now) };
      });
    return c.json(list.length ? list : [{ title: 'Nothing planned in the next 2 weeks', when: '' }]);
  });
  return r;
}
