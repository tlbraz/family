import { type AnyColumn, and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { CalendarEvent, EventInput, Occurrence, SearchResults } from '../../shared/types';
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

/**
 * The occurrence of a series to show in search results: the one happening now or next,
 * or, once the series is over, its last one. Null if every date was removed.
 */
export function pickOccurrence(rrule: string, start: Date, duration: number, exdates: string[], now: Date): Date | null {
  const next = expand(rrule, start, new Date(now.getTime() - duration), new Date(now.getTime() + 400 * 86_400_000), exdates)
    .find((s) => s.getTime() + duration > now.getTime());
  if (next) return next;
  const until = seriesEnd(rrule);
  if (!until) return null;
  return expand(rrule, start, start, until < now ? until : now, exdates).at(-1) ?? null;
}

const SEARCH_LIMIT = 30;
const ACCENTED = 'áàâãäçéèêëíìîïñóòôõöúùûü';
const PLAIN = 'aaaaaceeeeiiiinooooouuuu';

/** Lower case without accents, so "goncalo" finds Gonçalo. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Column contains the (already folded) text, ignoring case and accents. */
const contains = (col: AnyColumn, folded: string) =>
  sql`translate(lower(${col}), ${ACCENTED}, ${PLAIN}) like ${`%${folded.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;

/**
 * Events whose title, place or notes contain `q`, or that involve a family member named `q`.
 * Repeating events appear once (see pickOccurrence). Upcoming soonest first, past most recent first.
 */
export async function searchEvents(db: Db, q: string, now = new Date()): Promise<SearchResults> {
  const text = fold(q);
  const who = await db.select({ id: members.id }).from(members).where(contains(members.name, text));
  const involving = who.length
    ? (await db.select({ id: eventParticipants.eventId }).from(eventParticipants).where(inArray(eventParticipants.memberId, who.map((m) => m.id)))).map((r) => r.id)
    : [];
  const rows = await db
    .select()
    .from(events)
    .where(
      or(
        contains(events.title, text),
        contains(events.location, text),
        contains(events.notes, text),
        involving.length ? inArray(events.id, involving) : undefined,
      ),
    );
  const people = await participantsOf(db, rows.map((r) => r.id));
  const upcoming: Occurrence[] = [];
  const past: Occurrence[] = [];

  for (const row of rows) {
    const duration = row.endAt.getTime() - row.startAt.getTime();
    const start = row.rrule ? pickOccurrence(row.rrule, row.startAt, duration, row.exdates, now) : row.startAt;
    if (!start) continue;
    const end = new Date(start.getTime() + duration);
    const o: Occurrence = {
      key: row.rrule ? `${row.id}@${start.toISOString()}` : row.id,
      eventId: row.id,
      kind: 'event',
      title: row.title,
      type: row.type,
      allDay: row.allDay,
      start: start.toISOString(),
      end: end.toISOString(),
      location: row.location,
      participants: people.get(row.id) ?? [],
      bring: row.bring,
      repeats: !!row.rrule,
    };
    (end > now ? upcoming : past).push(o);
  }

  upcoming.sort((a, b) => a.start.localeCompare(b.start));
  past.sort((a, b) => b.start.localeCompare(a.start));
  return { upcoming: upcoming.slice(0, SEARCH_LIMIT), past: past.slice(0, SEARCH_LIMIT) };
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
    repeats: kind !== 'school',
  };
}

export { dateKey };
