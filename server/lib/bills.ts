import { payeeKey } from '../../shared/bills';
import type { Bill, MoneyBills, TrackedBill } from '../../shared/types';
import type { Snapshot } from './money';
import { addDays, dateKey, parseDateKey } from './time';

export { payeeKey };

/**
 * Bills and subscriptions, spotted in Actual: payments to the same payee that come back every month
 * (or every year) around the same day for about the same amount. Everything here is pure, so it's tested.
 */

export interface BillOverrides {
  ignored: { key: string; name: string }[]; // "Not a bill"
  tracked: TrackedBill[]; // "Track as a bill" / "Make it a fixed expense"
}

/** The saved choices, as stored (older ones have only key and name for tracked bills). Anything odd is dropped. */
export function parseOverrides(raw: unknown): BillOverrides {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { ignored?: unknown; tracked?: unknown };
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof e.key === 'string' && !!e.key) : []);
  return {
    ignored: list(o.ignored).map((e) => ({ key: e.key as string, name: typeof e.name === 'string' ? e.name : (e.key as string) })),
    tracked: list(o.tracked).map((e) => ({
      key: e.key as string,
      name: typeof e.name === 'string' ? e.name : (e.key as string),
      ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
      ...(Number.isInteger(e.expected) && (e.expected as number) > 0 ? { expected: e.expected as number } : {}),
      ...(e.cadence === 'monthly' || e.cadence === 'yearly' ? { cadence: e.cadence } : {}),
      ...(Number.isInteger(e.day) && (e.day as number) >= 1 && (e.day as number) <= 31 ? { day: e.day as number } : {}),
    })),
  };
}

interface Charge {
  date: string;
  amount: number; // cents, positive
  category: string | null; // Actual's category id (of the biggest part, when split)
}

interface Series {
  key: string;
  name: string;
  charges: Charge[]; // oldest first, one per day
}

interface Pattern {
  cadence: 'monthly' | 'yearly';
  day: number; // day of the month it usually comes
  varying: boolean;
}

const DAY = 86_400_000;
const WINDOW = 12; // a charge this many days either side of the usual day counts for that month
const GRACE = 5; // days after the usual day before a missing charge is flagged
const CHANGE = 50; // cents: smaller differences are not a price change
const OFF = 0.25; // a fixed expense paid this much above or below what's expected is flagged

const days = (a: string, b: string) => Math.round((parseDateKey(a).getTime() - parseDateKey(b).getTime()) / DAY);
const monthKey = (d: string) => d.slice(0, 7);
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y!, mo! - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const daysIn = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};
/** Days between two days of the month, going round the end of the month (30th and 2nd are 3 apart). */
const dayGap = (a: number, b: number) => Math.min(Math.abs(a - b), 30 - Math.abs(a - b));

/** Money going out, grouped by payee (same-day parts of a split added up), named as most recently written. */
export function seriesOf(tx: Snapshot['tx']): Series[] {
  const by = new Map<string, { name: string; nameDate: string; byDate: Map<string, { amount: number; category: string | null; biggest: number }> }>();
  for (const t of tx) {
    if (t.amount >= 0 || !t.payee) continue;
    const key = payeeKey(t.payee);
    if (!key) continue;
    const s = by.get(key) ?? { name: t.payee, nameDate: t.date, byDate: new Map() };
    if (t.date >= s.nameDate) Object.assign(s, { name: t.payee, nameDate: t.date }); // the latest spelling (Actual's rules tidy names up over time)
    const day = s.byDate.get(t.date) ?? { amount: 0, category: null, biggest: 0 };
    day.amount -= t.amount;
    if (-t.amount > day.biggest) Object.assign(day, { category: t.category, biggest: -t.amount });
    s.byDate.set(t.date, day);
    by.set(key, s);
  }
  return [...by].map(([key, s]) => ({
    key,
    name: s.name,
    charges: [...s.byDate].map(([date, d]) => ({ date, amount: d.amount, category: d.category })).sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

/**
 * Is this a bill? Monthly: in at least 3 of the last 4 complete months, once a month, around the same day,
 * for a similar amount (±25%). Yearly: twice, about a year apart, for a similar amount. `forced` = marked by hand.
 */
export function patternOf(s: Series, today: Date, dataFrom: string | null, forced = false): Pattern | null {
  const current = dateKey(today).slice(0, 7);
  const complete = [1, 2, 3, 4].map((n) => addMonths(current, -n)).filter((m) => !!dataFrom && dataFrom <= `${m}-03`);
  const inMonth = (m: string) => s.charges.filter((c) => monthKey(c.date) === m);
  const hits = complete.filter((m) => inMonth(m).length > 0);
  const oneEach = complete.every((m) => inMonth(m).length <= 2) && complete.reduce((n, m) => n + inMonth(m).length, 0) <= hits.length + 1;

  const recent = hits.map((m) => inMonth(m)[0]!);
  const shape = (list: Charge[]) => {
    const day = median(list.map((c) => Number(c.date.slice(8, 10))));
    const amount = median(list.map((c) => c.amount));
    return {
      day,
      steady: list.every((c) => dayGap(Number(c.date.slice(8, 10)), day) <= 6),
      similar: list.every((c) => Math.abs(c.amount - amount) <= amount * 0.25),
      varying: Math.max(...list.map((c) => c.amount)) - Math.min(...list.map((c) => c.amount)) > Math.max(100, amount * 0.03),
    };
  };

  if (complete.length >= 3 && hits.length >= 3 && hits.length >= complete.length - 1 && oneEach) {
    const sh = shape(recent);
    if (sh.steady && sh.similar) return { cadence: 'monthly', day: sh.day, varying: sh.varying };
  }
  // Yearly: the last two charges 11–13 months apart, and not much else from them.
  const last = s.charges[s.charges.length - 1];
  const before = s.charges[s.charges.length - 2];
  if (last && before && s.charges.length <= 3) {
    const gap = days(last.date, before.date);
    const sh = shape([before, last]);
    if (gap >= 335 && gap <= 395 && sh.similar) return { cadence: 'yearly', day: Number(last.date.slice(8, 10)), varying: false };
  }
  if (!forced || !last) return null;
  // Marked by hand: monthly if it came in two of the last three months, otherwise yearly.
  const lately = [1, 2, 3].map((n) => addMonths(current, -n)).filter((m) => inMonth(m).length > 0).length;
  const list = s.charges.slice(-4);
  const sh = shape(list);
  return { cadence: lately >= 2 || inMonth(current).length > 0 && lately >= 1 ? 'monthly' : 'yearly', day: Number(last.date.slice(8, 10)), varying: lately >= 2 ? sh.varying : false };
}

/**
 * A bill marked by hand: what was set for it (how often, around which day, about how much) wins over what's
 * guessed, so a single charge is enough. With an expected amount it varies: no flags for small changes.
 */
export function trackedPattern(s: Series, t: TrackedBill, today: Date, dataFrom: string | null): Pattern | null {
  const guess = patternOf(s, today, dataFrom, true);
  const cadence = t.cadence ?? guess?.cadence;
  const day = t.day ?? guess?.day;
  if (!cadence || !day) return null;
  return { cadence, day, varying: t.expected !== undefined || (guess?.varying ?? false) };
}

/** The charge that belongs to the cycle due on `due`: the closest one within the window. */
function chargeFor(s: Series, due: string, window: number): Charge | null {
  let best: Charge | null = null;
  for (const c of s.charges) {
    const d = Math.abs(days(c.date, due));
    if (d <= window && (!best || d < Math.abs(days(best.date, due)))) best = c;
  }
  return best;
}

const dueIn = (month: string, day: number) => `${month}-${String(Math.min(day, daysIn(month))).padStart(2, '0')}`;

type CategoryOf = (id: string) => { name: string; group: { id: string; name: string } } | undefined;

/**
 * Where a bill belongs in the Money tab: the category of its most recent charge that has one, and that
 * category's group (so it gets the group's colour). Null when none of its charges has a category, or when
 * that category isn't in Actual's groups any more (it then shows with the ones without a category).
 */
export function placeOf(s: Series, categoryOf: CategoryOf): Pick<Bill, 'category' | 'group'> {
  const id = [...s.charges].reverse().find((c) => c.category)?.category;
  const c = id ? categoryOf(id) : undefined;
  return c ? { category: c.name, group: c.group } : { category: null, group: null };
}

/** How a bill stands in `month`, or null when it isn't expected that month. */
export function billIn(s: Series, p: Pattern, month: string, today: Date, tracked: TrackedBill | null = null, categoryOf: CategoryOf = () => undefined): Bill | null {
  const todayKey = dateKey(today);
  const history = [...s.charges].reverse().slice(0, 6).map(({ date, amount }) => ({ date, amount }));
  const set = tracked?.expected; // a fixed expense: any amount counts, flagged only when far from this
  const base = { key: s.key, name: tracked?.label || s.name, cadence: p.cadence, varying: p.varying, tracked: !!tracked, day: p.day, expected: set ?? null, history, ...placeOf(s, categoryOf) };
  const change = (now: Charge, prev: Charge | null) =>
    set !== undefined
      ? (Math.abs(now.amount - set) > set * OFF ? { from: set, to: now.amount } : null)
      : (!p.varying && prev && Math.abs(now.amount - prev.amount) >= CHANGE ? { from: prev.amount, to: now.amount } : null);

  if (p.cadence === 'monthly') {
    const due = dueIn(month, p.day);
    const paid = chargeFor(s, due, WINDOW);
    const prevDue = dueIn(addMonths(month, -1), p.day);
    const prev = chargeFor(s, prevDue, WINDOW);
    if (paid) return { ...base, status: 'paid', date: paid.date, amount: paid.amount, change: change(paid, prev) };
    // Not paid: only expected if it had started, and came in one of the two months before (else it probably stopped),
    // or it was set by hand as monthly (then it's expected until it's no longer tracked).
    const started = s.charges[0] && s.charges[0].date <= due;
    const alive = tracked?.cadence || prev || chargeFor(s, dueIn(addMonths(month, -2), p.day), WINDOW);
    if (!started || !alive) return null;
    const expected = set ?? (p.varying ? median(s.charges.filter((c) => c.date < due).slice(-4).map((c) => c.amount)) : (prev ?? s.charges.filter((c) => c.date < due).at(-1)!).amount);
    const late = days(todayKey, due) > GRACE;
    return { ...base, status: late ? 'missing' : 'due', date: due, amount: expected, change: null };
  }

  // Yearly: shown in the month it was paid, or the month the next one is due.
  const paidHere = s.charges.filter((c) => monthKey(c.date) === month).at(-1);
  if (paidHere) {
    const prev = s.charges.filter((c) => days(paidHere.date, c.date) >= 300).at(-1) ?? null;
    return { ...base, status: 'paid', date: paidHere.date, amount: paidHere.amount, change: change(paidHere, prev) };
  }
  const last = s.charges.at(-1)!;
  const yearOn = dateKey(new Date(parseDateKey(last.date).setFullYear(parseDateKey(last.date).getFullYear() + 1)));
  const next = tracked?.day ? dueIn(monthKey(yearOn), tracked.day) : yearOn;
  if (monthKey(next) !== month) return null;
  return { ...base, status: days(todayKey, next) > GRACE + 5 ? 'missing' : 'due', date: next, amount: set ?? last.amount, change: null };
}

const ORDER = { due: 0, missing: 1, paid: 2 } as const;

/** Everything the Bills card needs for one month. */
export function billsFor(snap: Pick<Snapshot, 'tx' | 'dataFrom'> & Partial<Pick<Snapshot, 'groups'>>, month: string, today: Date, overrides: BillOverrides = { ignored: [], tracked: [] }): MoneyBills {
  const cats = new Map((snap.groups ?? []).flatMap((g) => g.categories.map((c) => [c.id, { name: c.name, group: { id: g.id, name: g.name } }] as const)));
  const ignored = new Set(overrides.ignored.map((x) => x.key));
  const tracked = new Map(overrides.tracked.map((x) => [x.key, x]));
  const bills: Bill[] = [];
  const candidates: MoneyBills['candidates'] = [];
  const since = dateKey(addDays(today, -400));
  for (const s of seriesOf(snap.tx)) {
    if (ignored.has(s.key)) continue;
    const t = tracked.get(s.key) ?? null;
    const p = t ? trackedPattern(s, t, today, snap.dataFrom) : patternOf(s, today, snap.dataFrom);
    if (p) {
      const b = billIn(s, p, month, today, t, (id) => cats.get(id));
      if (b) bills.push(b);
    } else {
      const recent = s.charges.filter((c) => c.date >= since);
      if (recent.length >= 2) candidates.push({ key: s.key, name: s.name, count: recent.length, last: recent.at(-1)! });
    }
  }
  bills.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.date.localeCompare(b.date));
  return {
    bills,
    paid: bills.filter((b) => b.status === 'paid').length,
    remaining: bills.filter((b) => b.status === 'due').reduce((sum, b) => sum + b.amount, 0),
    candidates: candidates.sort((a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date)).slice(0, 40),
    ignored: overrides.ignored,
    tracked: overrides.tracked,
  };
}

/**
 * Fixed against variable for the month: fixed = its bills (paid, and still to come at their expected amount);
 * variable = the month's spending (`spending`, as the Money tab counts it; out < 0) without the bill charges in it.
 * A bill paid just before the month (rent on the 31st) is fixed for this month but isn't in its spending.
 */
export function fixedVsVariable(bills: MoneyBills, spending: { date: string; amount: number; payee: string }[]) {
  const paid = bills.bills.filter((b) => b.status === 'paid');
  const charges = new Set(paid.map((b) => `${b.key}|${b.date}`));
  const spent = spending.reduce((sum, t) => sum - t.amount, 0);
  const inBills = spending.filter((t) => t.amount < 0 && charges.has(`${payeeKey(t.payee)}|${t.date}`)).reduce((sum, t) => sum - t.amount, 0);
  return {
    paid: paid.reduce((sum, b) => sum + b.amount, 0),
    toCome: bills.bills.filter((b) => b.status !== 'paid').reduce((sum, b) => sum + b.amount, 0),
    variable: Math.max(0, spent - inBills),
  };
}

// ---- Telegram ----------------------------------------------------------------------------------

export const euro = (cents: number) => {
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
};
const shortDate = (d: string) => parseDateKey(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** The messages worth an interruption this month: a price change (right after the charge) and a charge that didn't come. */
export function billAlerts(bills: MoneyBills, today: Date): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const todayKey = dateKey(today);
  for (const b of bills.bills) {
    if (b.status === 'paid' && b.change && days(todayKey, b.date) <= 10) {
      const up = b.change.to > b.change.from;
      out.push({ key: `billchange:${b.key}:${b.date}`, text: `${up ? '📈' : '📉'} <b>${escape(b.name)}</b> went from ${euro(b.change.from)} to <b>${euro(b.change.to)}</b> (charged ${shortDate(b.date)}).` });
    }
    if (b.status === 'missing') {
      const when = b.cadence === 'monthly' ? `usually around the ${ordinal(Number(b.date.slice(8, 10)))}` : `due ${shortDate(b.date)}`;
      out.push({ key: `billmissing:${b.key}:${b.date}`, text: `❓ <b>${escape(b.name)}</b> hasn't come in (${when}, ${b.varying ? 'about ' : ''}${euro(b.amount)}). Paid another way, or did something stop?` });
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
