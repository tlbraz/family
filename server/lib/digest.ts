import { eq } from 'drizzle-orm';
import type { Occurrence } from '../../shared/types';
import type { Db } from '../db';
import { members, settings } from '../schema';
import { listOccurrences } from './calendar';
import { esc, sendTelegram, telegramEnabled } from './telegram';
import { addDays, dateKey } from './time';

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

/** The evening message: what happens tomorrow and what to pack. Null when nothing is on. */
export async function tomorrowDigest(db: Db, now = new Date()): Promise<string | null> {
  const day = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
  const items = await listOccurrences(db, dateKey(day), dateKey(addDays(day, 1)));
  const real = items.filter((o) => o.kind === 'event' || o.kind === 'birthday');
  if (!real.length) return null;
  const who = await names(db);
  const other = items.filter((o) => o.kind === 'holiday' || o.kind === 'school').map((o) => esc(o.title));
  return [`<b>Tomorrow · ${dayName(day)}</b>`, ...other.map((t) => `ℹ️ ${t}`), ...real.map((o) => line(o, who))].join('\n');
}

/** The Sunday message: the coming week, day by day. */
export async function weekDigest(db: Db, now = new Date()): Promise<string> {
  const monday = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), ((8 - now.getDay()) % 7) || 7);
  const items = await listOccurrences(db, dateKey(monday), dateKey(addDays(monday, 7)));
  const who = await names(db);
  const lines = [`<b>Next week · ${dayName(monday)} – ${dayName(addDays(monday, 6))}</b>`];
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    const today = items.filter((o) => dateKey(new Date(o.start)) <= key && dateKey(new Date(new Date(o.end).getTime() - 1)) >= key);
    const real = today.filter((o) => o.kind === 'event' || o.kind === 'birthday');
    const info = today.filter((o) => o.kind !== 'event' && o.kind !== 'birthday');
    if (!real.length && !info.length) continue;
    count += real.length;
    lines.push('', `<b>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })}</b>`);
    for (const o of info) lines.push(`ℹ️ ${esc(o.title)}`);
    for (const o of real) lines.push(line(o, who));
  }
  if (!count) lines.push('', 'Nothing planned yet.');
  lines.push('', '<a href="http://family.lan">family.lan</a>');
  return lines.join('\n');
}

async function onceFor(db: Db, key: string, send: () => Promise<boolean>) {
  const [done] = await db.select().from(settings).where(eq(settings.key, key));
  if (done) return;
  if (await send()) await db.insert(settings).values({ key, value: new Date().toISOString() }).onConflictDoNothing();
}

/** Called every minute: 20:00 → tomorrow; Sunday 19:00 → the week ahead. */
export async function runDigests(db: Db, now = new Date()) {
  if (!telegramEnabled()) return;
  const today = dateKey(now);
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
