import { addDays, dateKey } from './time';

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Portuguese national holidays, plus Carnival and Almada's municipal holiday. */
export function holidays(year: number): { date: string; name: string }[] {
  const e = easter(year);
  const fixed: [number, number, string][] = [
    [1, 1, "New Year's Day"],
    [4, 25, 'Freedom Day'],
    [5, 1, 'Labour Day'],
    [6, 10, 'Portugal Day'],
    [6, 24, 'São João (Almada holiday)'],
    [8, 15, 'Assumption Day'],
    [10, 5, 'Republic Day'],
    [11, 1, "All Saints' Day"],
    [12, 1, 'Restoration of Independence'],
    [12, 8, 'Immaculate Conception'],
    [12, 25, 'Christmas'],
  ];
  const list = [
    ...fixed.map(([m, d, name]) => ({ date: dateKey(new Date(year, m - 1, d)), name })),
    { date: dateKey(addDays(e, -47)), name: 'Carnival' },
    { date: dateKey(addDays(e, -2)), name: 'Good Friday' },
    { date: dateKey(e), name: 'Easter' },
    { date: dateKey(addDays(e, 60)), name: 'Corpus Christi' },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
