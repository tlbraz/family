import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { CalendarEvent, EventInput, Occurrence } from '../../shared/types';
import { SCHOOL_BREAKS, SCHOOL_DAYS } from '../../shared/school-calendar';
import type { Db } from '../db';
import { eventParticipants, events, members } from '../schema';
import { holidays } from './holidays';
import { expand, repeatToRrule, rruleToRepeat, seriesEnd } from './recurrence';
import { addDays, dateKey, parseDateKey } from './time';

type EventRow = typeof events.$inferSelect;

/** Birthdays stored with this year (or earlier) have no known year: no age is shown. */
export const NO_YEAR = 1904;

async function participantsOf(db: Db, ids: string[]): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (!ids.length) return map;
  const rows = await db.select().from(eventParticipants).where(inArray(eventParticipants.eventId, ids));
  for (const r of rows) map.set(r.eventId, [...(map.get(r.eventId) ?? []), r.memberId]);
  return map;
}

export function toEvent(row: EventRow, participants: number[]): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    allDay: row.allDay,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    location: row.location,
    notes: row.notes,
    participants,
    bring: row.bring,
    reminders: row.reminders,
    repeat: rruleToRepeat(row.rrule),
    source: row.source,
  };
}

export async function getEvent(db: Db, id: string): Promise<CalendarEvent | null> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) return null;
  return toEvent(row, (await participantsOf(db, [id])).get(id) ?? []);
}

/** Column values for an insert/update from validated input. */
export function eventValues(input: EventInput) {
  const start = new Date(input.start);
  return {
    title: input.title,
    type: input.type,
    allDay: input.allDay,
    startAt: start,
    endAt: new Date(input.end),
    location: input.location,
    notes: input.notes,
    bring: input.bring,
    reminders: [...new Set(input.reminders)].sort((a, b) => b - a),
    rrule: input.repeat ? repeatToRrule(input.repeat, start) : null,
    updatedAt: new Date(),
  };
}

export async function setParticipants(db: Db, eventId: string, ids: number[]) {
  await db.delete(eventParticipants).where(eq(eventParticipants.eventId, eventId));
  if (ids.length) await db.insert(eventParticipants).values([...new Set(ids)].map((memberId) => ({ eventId, memberId })));
}

/** Everything on the calendar between two local dates (from inclusive, to exclusive). */
export async function listOccurrences(db: Db, fromKey: string, toKey: string): Promise<Occurrence[]> {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  const rows = await db
    .select()
    .from(events)
    .where(
      or(
        and(isNull(events.rrule), lt(events.startAt, to), gte(events.endAt, from)),
        and(isNotNull(events.rrule), lt(events.startAt, to)),
      ),
    );
  const people = await participantsOf(db, rows.map((r) => r.id));
  const out: Occurrence[] = [];

  for (const row of rows) {
    const duration = row.endAt.getTime() - row.startAt.getTime();
    const base = {
      eventId: row.id,
      kind: 'event' as const,
      title: row.title,
      type: row.type,
      allDay: row.allDay,
      location: row.location,
      participants: people.get(row.id) ?? [],
      bring: row.bring,
      reminders: row.reminders,
      repeats: !!row.rrule,
    };
    if (!row.rrule) {
      out.push({ ...base, key: row.id, start: row.startAt.toISOString(), end: row.endAt.toISOString() });
      continue;
    }
    const until = seriesEnd(row.rrule);
    if (until && until < from) continue;
    // Look back by the duration so a multi-day occurrence that started earlier still shows.
    for (const s of expand(row.rrule, row.startAt, new Date(from.getTime() - duration), to, row.exdates)) {
      if (s.getTime() + duration <= from.getTime()) continue;
      out.push({
        ...base,
        key: `${row.id}@${s.toISOString()}`,
        start: s.toISOString(),
        end: new Date(s.getTime() + duration).toISOString(),
      });
    }
  }

  // Birthdays, every year.
  const kids = await db.select().from(members).where(isNotNull(members.birthday));
  for (const m of kids) {
    const [by, bm, bd] = m.birthday!.split('-').map(Number);
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      const day = new Date(y, bm! - 1, bd!);
      if (day < from || day >= to) continue;
      const title = by! > NO_YEAR ? `${m.name}'s birthday · ${y - by!}` : `${m.name}'s birthday`;
      out.push(generated(`bday-${m.id}-${y}`, 'birthday', title, day, addDays(day, 1), [m.id]));
    }
  }

  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    for (const h of holidays(y)) {
      const day = parseDateKey(h.date);
      if (day >= from && day < to) out.push(generated(`hol-${h.date}`, 'holiday', h.name, day, addDays(day, 1)));
    }
  }
  for (const b of SCHOOL_BREAKS) {
    const s = parseDateKey(b.start);
    const e = addDays(parseDateKey(b.end), 1);
    if (s < to && e > from) out.push(generated(`school-${b.start}`, 'school', `No school · ${b.name}`, s, e));
  }
  for (const d of SCHOOL_DAYS) {
    const day = parseDateKey(d.date);
    if (day >= from && day < to) out.push(generated(`schoolday-${d.date}`, 'school', d.name, day, addDays(day, 1)));
  }

  return out.sort((a, b) => a.start.localeCompare(b.start) || Number(b.allDay) - Number(a.allDay));
}

function generated(key: string, kind: Occurrence['kind'], title: string, start: Date, end: Date, participants: number[] = []): Occurrence {
  return {
    key,
    eventId: null,
    kind,
    title,
    type: kind === 'birthday' ? 'birthday' : kind === 'school' ? 'school' : 'holiday',
    allDay: true,
    start: start.toISOString(),
    end: end.toISOString(),
    location: null,
    participants,
    bring: [],
    reminders: [],
    repeats: kind !== 'school',
  };
}

export { dateKey };
