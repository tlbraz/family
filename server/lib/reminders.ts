import { and, eq, like, lt } from 'drizzle-orm';
import type { Occurrence } from '../../shared/types';
import type { Db } from '../db';
import { members, settings } from '../schema';
import { listOccurrences } from './calendar';
import { esc, sendTelegram, telegramEnabled } from './telegram';
import { addDays, dateKey } from './time';

// Per-event reminders on Telegram. An event keeps a list of offsets in minutes before its start
// (negative = after the start, used for "08:00 on the day" of all-day events). Checked every minute;
// a reminder is sent once, and only within LATE_MINUTES of its time (no burst after downtime).

const LATE_MINUTES = 20;
const EMOJI: Record<string, string> = { medical: '🩺', sports: '⚽', school: '🎒', party: '🎉', family: '🏠', work: '💼', holiday: '✈️', other: '📌' };

/** How a reminder reads, e.g. "In 1 hour", "Tomorrow", "Today". */
export function reminderLabel(offset: number, allDay: boolean): string {
  if (allDay) return offset > 0 ? (offset <= 1440 ? 'Tomorrow' : `In ${Math.round(offset / 1440) + 1} days`) : 'Today';
  if (offset <= 0) return 'Starting now';
  if (offset < 60) return `In ${offset} min`;
  if (offset < 1440) return offset === 60 ? 'In 1 hour' : `In ${Math.round(offset / 60)} hours`;
  return offset === 1440 ? 'Tomorrow' : `In ${Math.round(offset / 1440)} days`;
}

export interface Due {
  key: string;
  occurrence: Occurrence;
  offset: number;
}

/** Reminders whose time has come (and is at most LATE_MINUTES ago). */
export function dueReminders(items: Occurrence[], now: Date): Due[] {
  const due: Due[] = [];
  for (const o of items) {
    for (const offset of o.reminders) {
      const at = new Date(o.start).getTime() - offset * 60_000;
      if (now.getTime() >= at && now.getTime() - at < LATE_MINUTES * 60_000) {
        due.push({ key: `rem:${o.key}:${offset}`, occurrence: o, offset });
      }
    }
  }
  return due;
}

export function reminderText(d: Due, who: Map<number, string>): string {
  const o = d.occurrence;
  const time = new Date(o.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const people = o.participants.map((id) => who.get(id)).filter(Boolean).join(', ');
  const lines = [`⏰ <b>${reminderLabel(d.offset, o.allDay)}</b>${o.allDay ? '' : ` · ${time}`}`, `${EMOJI[o.type] ?? '📌'} ${esc(o.title)}${people ? ` — ${esc(people)}` : ''}`];
  if (o.location) lines.push(`📍 ${esc(o.location)}`);
  const todo = o.bring.filter((b) => !b.done).map((b) => b.text);
  if (todo.length) lines.push(`🎒 Bring: ${esc(todo.join(', '))}`);
  return lines.join('\n');
}

/** Called every minute from the server. */
export async function runReminders(db: Db, now = new Date()) {
  if (!telegramEnabled()) return;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Offsets go up to 7 days before and 1 day after the start.
  const items = await listOccurrences(db, dateKey(addDays(today, -1)), dateKey(addDays(today, 9)));
  const due = dueReminders(items.filter((o) => o.kind === 'event' && o.reminders.length), now);
  if (due.length) {
    const who = new Map((await db.select().from(members)).map((m) => [m.id, m.name]));
    for (const d of due) {
      const [sent] = await db.select().from(settings).where(eq(settings.key, d.key));
      if (sent) continue;
      if (await sendTelegram(reminderText(d, who))) {
        await db.insert(settings).values({ key: d.key, value: now.toISOString() }).onConflictDoNothing();
      }
    }
  }
  if (now.getMinutes() === 0) {
    // Forget sent reminders after a month.
    await db.delete(settings).where(and(like(settings.key, 'rem:%'), lt(settings.value, addDays(now, -30).toISOString())));
  }
}
