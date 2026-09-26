// The server runs with TZ=Europe/Lisbon, the same zone as everyone using the app,
// so "local" here means Lisbon wall-clock time.

export const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of a date in local time. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD string. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// rrule expands in UTC; to keep "every Saturday 10:00" at 10:00 across DST changes we
// expand in "floating" time: local wall-clock fields written into a UTC date and back.
export function toFloating(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

export function fromFloating(f: Date): Date {
  return new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds());
}
