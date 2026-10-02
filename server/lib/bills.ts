import type { Bill, MoneyBills } from '../../shared/types';
import type { Snapshot } from './money';
import { addDays, dateKey, parseDateKey } from './time';

/**
 * Bills and subscriptions, spotted in Actual: payments to the same payee that come back every month
 * (or every year) around the same day for about the same amount. Everything here is pure, so it's tested.
 */

export interface BillOverrides {
  ignored: { key: string; name: string }[]; // "Not a bill"
  tracked: { key: string; name: string }[]; // "Track as a bill"
}

interface Charge {
  date: string;
  amount: number; // cents, positive
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

// Words banks and card terminals add around the name ("DD VODAFONE PORTUGAL SA", "COMPRA 1234 NETFLIX.COM").
const FILLER = new Set(['dd', 'pag', 'pagamento', 'pagamentos', 'compra', 'compras', 'debito', 'direto', 'trf', 'transf', 'transferencia', 'mb', 'way', 'mbway',
  'sepa', 'cartao', 'serv', 'servicos', 'de', 'da', 'do', 'das', 'dos', 'e', 'lda', 'sa', 'pt', 'portugal', 'com', 'www', 'the', 'eu', 'europe', 'ltd', 'inc']);

/** "DD VODAFONE PORTUGAL SA 2034" and "Vodafone" → "vodafone": the first two words that are the name. */
export function payeeKey(payee: string): string {
  return payee
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1 && !FILLER.has(w))
    .slice(0, 2)
    .join(' ');
}

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
  const by = new Map<string, { name: string; nameDate: string; byDate: Map<string, number> }>();
  for (const t of tx) {
    if (t.amount >= 0 || !t.payee) continue;
    const key = payeeKey(t.payee);
    if (!key) continue;
    const s = by.get(key) ?? { name: t.payee, nameDate: t.date, byDate: new Map() };
    if (t.date >= s.nameDate) Object.assign(s, { name: t.payee, nameDate: t.date }); // the latest spelling (Actual's rules tidy names up over time)
    s.byDate.set(t.date, (s.byDate.get(t.date) ?? 0) - t.amount);
    by.set(key, s);
  }
  return [...by].map(([key, s]) => ({
    key,
    name: s.name,
    charges: [...s.byDate].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
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

/** How a bill stands in `month`, or null when it isn't expected that month. */
export function billIn(s: Series, p: Pattern, month: string, today: Date, tracked = false): Bill | null {
  const todayKey = dateKey(today);
  const history = [...s.charges].reverse().slice(0, 6);
  const base = { key: s.key, name: s.name, cadence: p.cadence, varying: p.varying, tracked, history };
  const change = (now: Charge, prev: Charge | null) => (!p.varying && prev && Math.abs(now.amount - prev.amount) >= CHANGE ? { from: prev.amount, to: now.amount } : null);

  if (p.cadence === 'monthly') {
    const due = dueIn(month, p.day);
    const paid = chargeFor(s, due, WINDOW);
    const prevDue = dueIn(addMonths(month, -1), p.day);
    const prev = chargeFor(s, prevDue, WINDOW);
    if (paid) return { ...base, status: 'paid', date: paid.date, amount: paid.amount, change: change(paid, prev) };
    // Not paid: only expected if it had started, and came in one of the two months before (else it probably stopped).
    const started = s.charges[0] && s.charges[0].date <= due;
    const alive = prev || chargeFor(s, dueIn(addMonths(month, -2), p.day), WINDOW);
    if (!started || !alive) return null;
    const expected = p.varying ? median(s.charges.filter((c) => c.date < due).slice(-4).map((c) => c.amount)) : (prev ?? s.charges.filter((c) => c.date < due).at(-1)!).amount;
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
  const next = dateKey(new Date(parseDateKey(last.date).setFullYear(parseDateKey(last.date).getFullYear() + 1)));
  if (monthKey(next) !== month) return null;
  return { ...base, status: days(todayKey, next) > GRACE + 5 ? 'missing' : 'due', date: next, amount: last.amount, change: null };
}

const ORDER = { due: 0, missing: 1, paid: 2 } as const;

/** Everything the Bills card needs for one month. */
export function billsFor(snap: Pick<Snapshot, 'tx' | 'dataFrom'>, month: string, today: Date, overrides: BillOverrides = { ignored: [], tracked: [] }): MoneyBills {
  const ignored = new Set(overrides.ignored.map((x) => x.key));
  const tracked = new Set(overrides.tracked.map((x) => x.key));
  const bills: Bill[] = [];
  const candidates: MoneyBills['candidates'] = [];
  const since = dateKey(addDays(today, -400));
  for (const s of seriesOf(snap.tx)) {
    if (ignored.has(s.key)) continue;
    const p = patternOf(s, today, snap.dataFrom, tracked.has(s.key));
    if (p) {
      const b = billIn(s, p, month, today, tracked.has(s.key));
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
