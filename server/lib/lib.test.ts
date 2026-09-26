import { describe, expect, it } from 'vitest';
import { easter, holidays } from './holidays';
import { fold, pickOccurrence } from './calendar';
import { expand, repeatToRrule, rruleToRepeat } from './recurrence';
import { dateKey } from './time';

describe('holidays', () => {
  it('computes Easter', () => {
    expect(dateKey(easter(2026))).toBe('2026-04-05');
    expect(dateKey(easter(2027))).toBe('2027-03-28');
  });

  it('includes the movable Portuguese holidays', () => {
    const h = Object.fromEntries(holidays(2027).map((x) => [x.name, x.date]));
    expect(h['Good Friday']).toBe('2027-03-26');
    expect(h['Corpus Christi']).toBe('2027-05-27');
    expect(h['Carnival']).toBe('2027-02-09');
  });
});

describe('recurrence', () => {
  it('keeps the wall-clock time across the October DST change', () => {
    const start = new Date(2026, 9, 17, 10, 0); // Sat 17 Oct 2026, 10:00
    const rule = repeatToRrule({ freq: 'weekly', interval: 1 }, start);
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=SA');
    const got = expand(rule, start, new Date(2026, 9, 1), new Date(2026, 10, 8));
    expect(got.map((d) => `${dateKey(d)} ${d.getHours()}:00`)).toEqual([
      '2026-10-17 10:00',
      '2026-10-24 10:00',
      '2026-10-31 10:00',
      '2026-11-07 10:00',
    ]);
  });

  it('skips removed dates and stops at until', () => {
    const start = new Date(2026, 8, 29, 17, 30); // Tue
    const rule = repeatToRrule({ freq: 'weekly', interval: 1, weekdays: [1, 3], until: '2026-10-08' }, start);
    const skip = [new Date(2026, 9, 1, 17, 30).toISOString()];
    const got = expand(rule, start, new Date(2026, 8, 28), new Date(2026, 11, 1), skip).map(dateKey);
    expect(got).toEqual(['2026-09-29', '2026-10-06', '2026-10-08']);
  });

  it('round-trips the form model', () => {
    const r = rruleToRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270630T235959Z');
    expect(r).toEqual({ freq: 'weekly', interval: 2, weekdays: [0, 2], until: '2027-06-30' });
  });
});

describe('search', () => {
  it('ignores case and accents', () => {
    expect(fold('Gonçalo ESTÁDIO')).toBe('goncalo estadio');
  });
});

describe('search: which date of a repeating event to show', () => {
  const start = new Date(2026, 8, 5, 10, 0); // Sat 5 Sep 2026, 10:00
  const hour = 60 * 60_000;

  it('shows the next one', () => {
    const rule = repeatToRrule({ freq: 'weekly', interval: 1 }, start);
    const got = pickOccurrence(rule, start, hour, [], new Date(2026, 8, 26, 12, 0));
    expect(dateKey(got!)).toBe('2026-10-03');
  });

  it('shows the one happening right now', () => {
    const rule = repeatToRrule({ freq: 'weekly', interval: 1 }, start);
    const got = pickOccurrence(rule, start, hour, [], new Date(2026, 8, 26, 10, 30));
    expect(dateKey(got!)).toBe('2026-09-26');
  });

  it('shows the last one of a series that has ended', () => {
    const rule = repeatToRrule({ freq: 'weekly', interval: 1, until: '2026-09-20' }, start);
    const got = pickOccurrence(rule, start, hour, [], new Date(2026, 8, 26, 12, 0));
    expect(dateKey(got!)).toBe('2026-09-19');
  });
});
