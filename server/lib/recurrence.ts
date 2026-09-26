import rrulePkg from 'rrule';
import type { Repeat } from '../../shared/types';
import { fromFloating, parseDateKey, pad, toFloating } from './time';

const { RRule } = rrulePkg;
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQ = { weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const;

/** Repeat → RRULE body (no "RRULE:" prefix). */
export function repeatToRrule(repeat: Repeat, start: Date): string {
  const parts = [`FREQ=${FREQ[repeat.freq]}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  if (repeat.freq === 'weekly') {
    // Monday = 0; default to the start's own weekday.
    const days = repeat.weekdays?.length ? repeat.weekdays : [(start.getDay() + 6) % 7];
    parts.push(`BYDAY=${[...new Set(days)].sort().map((d) => DAYS[d]).join(',')}`);
  }
  if (repeat.until) {
    const u = parseDateKey(repeat.until);
    parts.push(`UNTIL=${u.getFullYear()}${pad(u.getMonth() + 1)}${pad(u.getDate())}T235959Z`);
  }
  return parts.join(';');
}

/** RRULE body → Repeat for the edit form (best effort for rules made in Google). */
export function rruleToRepeat(rrule: string | null): Repeat | null {
  if (!rrule) return null;
  const fields = Object.fromEntries(
    rrule.replace(/^RRULE:/, '').split(';').map((p) => p.split('=') as [string, string]),
  );
  const freq = ({ WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly', DAILY: 'weekly' } as const)[
    fields.FREQ as 'WEEKLY'
  ];
  if (!freq) return null;
  const repeat: Repeat = { freq, interval: Number(fields.INTERVAL ?? 1) };
  if (fields.FREQ === 'DAILY') repeat.weekdays = [0, 1, 2, 3, 4, 5, 6];
  else if (fields.BYDAY) repeat.weekdays = fields.BYDAY.split(',').map((d: string) => DAYS.indexOf(d.slice(-2))).filter((d: number) => d >= 0);
  if (fields.UNTIL) repeat.until = `${fields.UNTIL.slice(0, 4)}-${fields.UNTIL.slice(4, 6)}-${fields.UNTIL.slice(6, 8)}`;
  return repeat;
}

/** Start times of a series that begin in [from, to). */
export function expand(rrule: string, start: Date, from: Date, to: Date, exdates: string[] = []): Date[] {
  const rule = new RRule({ ...RRule.parseString(rrule.replace(/^RRULE:/, '')), dtstart: toFloating(start) });
  const skip = new Set(exdates.map((d) => new Date(d).getTime()));
  return rule
    .between(toFloating(from), toFloating(to), true)
    .map(fromFloating)
    .filter((d) => d < to && !skip.has(d.getTime()));
}

/** Last day a series can produce an occurrence, or null if it never ends. */
export function seriesEnd(rrule: string): Date | null {
  const until = /UNTIL=(\d{8})/.exec(rrule)?.[1];
  if (!until) return null;
  return new Date(Number(until.slice(0, 4)), Number(until.slice(4, 6)) - 1, Number(until.slice(6, 8)) + 1);
}
