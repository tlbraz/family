export const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monday of the week containing d. */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, -((r.getDay() + 6) % 7));
}

export const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const weekdayShort = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' });
export const monthName = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long' });

export function dayLabel(d: Date, today: Date): string {
  const diff = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  const name = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' });
  if (diff === 0) return `Today · ${name}`;
  if (diff === 1) return `Tomorrow · ${name}`;
  if (diff === -1) return `Yesterday · ${name}`;
  return name;
}

/** Does [start, end) touch the local day `key`? */
export function onDay(start: string, end: string, key: string): boolean {
  const s = dateKey(new Date(start));
  const e = dateKey(new Date(new Date(end).getTime() - 1));
  return s <= key && e >= key;
}
