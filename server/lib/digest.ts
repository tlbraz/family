import { and, asc, eq, lt } from 'drizzle-orm';
import type { Occurrence, Task } from '../../shared/types';
import type { Db } from '../db';
import { toTask } from '../routes/tasks';
import { members, settings, tasks } from '../schema';
import { listOccurrences } from './calendar';
import { esc, sendTelegram, telegramEnabled } from './telegram';
import { addDays, dateKey, parseDateKey } from './time';

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://family.home.tbraz.pt';

const TYPE_EMOJI: Record<string, string> = {
  medical: '🩺', sports: '⚽', school: '🎒', party: '🎉', family: '🏠', work: '💼', holiday: '🌴', other: '📌', birthday: '🎂',
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayName = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

async function names(db: Db) {
  const rows = await db.select().from(members);
  return new Map(rows.map((m) => [m.id, m.name]));
}

function line(o: Occurrence, who: Map<number, string>): string {
  const people = o.participants.map((id) => who.get(id)).filter(Boolean).join(', ');
  const time = o.allDay ? 'all day' : hhmm(o.start);
  let s = `${TYPE_EMOJI[o.type] ?? '📌'} <b>${time}</b> ${esc(o.title)}`;
  if (people) s += ` — ${esc(people)}`;
  const todo = o.bring.filter((b) => !b.done).map((b) => b.text);
  if (todo.length) s += `\n    🎒 Bring: ${esc(todo.join(', '))}`;
  return s;
}

/** Open to-dos due before `to` (YYYY-MM-DD, exclusive), oldest first. */
async function openTasks(db: Db, to: string): Promise<Task[]> {
  const rows = await db.select().from(tasks).where(and(eq(tasks.done, false), lt(tasks.due, to))).orderBy(asc(tasks.due), asc(tasks.id));
  return rows.map(toTask);
}

/** "☐ Sign the permission slip — Gonçalo · due tomorrow", as read on `today` (YYYY-MM-DD). */
export function taskLine(t: Task, today: string, who: Map<number, string>): string {
  const name = t.memberId !== null ? who.get(t.memberId) : undefined;
  const weekday = parseDateKey(t.due).toLocaleDateString('en-GB', { weekday: 'long' });
  const tomorrow = dateKey(addDays(parseDateKey(today), 1));
  const when =
    t.due < today ? `<b>overdue</b> (was ${weekday})` : t.due === today ? '<b>due today</b>' : t.due === tomorrow ? 'due tomorrow' : `due ${weekday}`;
  return `☐ ${esc(t.title)}${name ? ` — ${esc(name)}` : ''} · ${when}`;
}

/** One day's events (plus open to-dos) as a message sent on `today`, or null when there's nothing. */
async function dayDigest(db: Db, day: Date, label: string, today: Date): Promise<string | null> {
  const items = await listOccurrences(db, dateKey(day), dateKey(addDays(day, 1)));
  const real = items.filter((o) => o.kind === 'event' || o.kind === 'birthday');
  // To-dos still open that are late or due in the next few days, so there's time to act.
  const todo = await openTasks(db, dateKey(addDays(today, 4)));
  if (!real.length && !todo.length) return null;
  const who = await names(db);
  const other = items.filter((o) => o.kind === 'holiday' || o.kind === 'school').map((o) => esc(o.title));
  const lines = [`<b>${label} · ${dayName(day)}</b>`, ...other.map((t) => `ℹ️ ${t}`), ...real.map((o) => line(o, who))];
  if (!real.length) lines.push('Nothing planned.');
  if (todo.length) lines.push('', '<b>To do</b>', ...todo.map((t) => taskLine(t, dateKey(today), who)));
  return lines.join('\n');
}

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** The morning message: what's on today and open to-dos. Null when there's nothing. */
export const todayDigest = (db: Db, now = new Date()) => dayDigest(db, startOfDay(now), 'Good morning ☀️ Today', startOfDay(now));

/** The evening message: what happens tomorrow, what to pack, open to-dos. Null when there's nothing. */
export const tomorrowDigest = (db: Db, now = new Date()) => dayDigest(db, addDays(startOfDay(now), 1), 'Tomorrow', startOfDay(now));

/** The Sunday message: the coming week, day by day. */
export async function weekDigest(db: Db, now = new Date()): Promise<string> {
  const monday = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), ((8 - now.getDay()) % 7) || 7);
  const items = await listOccurrences(db, dateKey(monday), dateKey(addDays(monday, 7)));
  const who = await names(db);
  const todo = (await openTasks(db, dateKey(addDays(monday, 7)))).filter((t) => t.due >= dateKey(monday));
  const lines = [`<b>Next week · ${dayName(monday)} – ${dayName(addDays(monday, 6))}</b>`];
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    const today = items.filter((o) => dateKey(new Date(o.start)) <= key && dateKey(new Date(new Date(o.end).getTime() - 1)) >= key);
    const real = today.filter((o) => o.kind === 'event' || o.kind === 'birthday');
    const info = today.filter((o) => o.kind !== 'event' && o.kind !== 'birthday');
    const due = todo.filter((t) => t.due === key);
    if (!real.length && !info.length && !due.length) continue;
    count += real.length + due.length;
    lines.push('', `<b>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })}</b>`);
    for (const o of info) lines.push(`ℹ️ ${esc(o.title)}`);
    for (const o of real) lines.push(line(o, who));
    for (const t of due) lines.push(taskLine(t, key, who).replace(/ · [^·]*$/, ' · due'));
  }
  if (!count) lines.push('', 'Nothing planned yet.');
  lines.push('', `<a href="${PUBLIC_URL}">Open the calendar</a>`);
  return lines.join('\n');
}

async function onceFor(db: Db, key: string, send: () => Promise<boolean>) {
  const [done] = await db.select().from(settings).where(eq(settings.key, key));
  if (done) return;
  if (await send()) await db.insert(settings).values({ key, value: new Date().toISOString() }).onConflictDoNothing();
}

/** Called every minute: 07:30 → today; 20:00 → tomorrow; Sunday 19:00 → the week ahead. */
export async function runDigests(db: Db, now = new Date()) {
  if (!telegramEnabled()) return;
  const today = dateKey(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Only in the morning: a restart later in the day shouldn't send a stale "good morning".
  if (minutes >= 7 * 60 + 30 && now.getHours() < 11) {
    await onceFor(db, `digest:today:${today}`, async () => {
      const msg = await todayDigest(db, now);
      return msg ? sendTelegram(msg) : true;
    });
  }
  if (now.getHours() >= 20) {
    await onceFor(db, `digest:tomorrow:${today}`, async () => {
      const msg = await tomorrowDigest(db, now);
      return msg ? sendTelegram(msg) : true; // nothing on = mark as done, send nothing
    });
  }
  if (now.getDay() === 0 && now.getHours() >= 19) {
    await onceFor(db, `digest:week:${today}`, async () => sendTelegram(await weekDigest(db, now)));
  }
}
