import { describe, expect, it } from 'vitest';
import { groupBills } from '../../shared/bills';
import { billAlerts, billsFor, fixedVsVariable, parseOverrides, payeeKey } from './bills';
import type { Snapshot } from './money';

let n = 0;
const out = (date: string, euros: number, payee: string, category: string | null = null): Snapshot['tx'][number] => ({
  id: `t${++n}`, accountId: 'a1', fixable: true, review: false, note: null, date, amount: -Math.round(euros * 100), account: 'CGD', category, payee,
});
const monthly = (payee: string, day: number, amounts: Record<string, number>) => Object.entries(amounts).map(([m, eur]) => out(`${m}-${String(day).padStart(2, '0')}`, eur, payee));

const today = new Date(2026, 8, 20); // 20 Sep 2026
const tx: Snapshot['tx'] = [
  // Price went up this month.
  ...monthly('DD VODAFONE PORTUGAL SA', 5, { '2026-05': 39.9, '2026-06': 39.9, '2026-07': 39.9, '2026-08': 39.9 }),
  out('2026-09-05', 44.9, 'Vodafone'),
  // Usually on the 25th: still to come.
  ...monthly('Netflix', 25, { '2026-05': 13.99, '2026-06': 13.99, '2026-07': 13.99, '2026-08': 13.99 }),
  // Different every month, and hasn't come in (usually the 8th).
  ...monthly('EDP Comercial', 8, { '2026-05': 55.1, '2026-06': 61.4, '2026-07': 70.2, '2026-08': 60 }),
  // Rent on the 1st; September's went out on 31 August.
  ...monthly('Senhorio', 1, { '2026-05': 900, '2026-06': 900, '2026-07': 900, '2026-08': 900 }),
  out('2026-08-31', 900, 'Senhorio'),
  // Cancelled in June: not expected any more.
  ...monthly('Spotify', 12, { '2026-02': 10.99, '2026-03': 10.99, '2026-04': 10.99, '2026-05': 10.99, '2026-06': 10.99 }),
  // Yearly insurance, a bit dearer this year.
  out('2025-09-10', 240, 'Fidelidade'),
  out('2026-09-12', 252, 'Fidelidade'),
  // The supermarket: often, but not a bill.
  ...['2026-06-03', '2026-06-10', '2026-06-17', '2026-07-02', '2026-07-09', '2026-08-01', '2026-08-15', '2026-09-02'].map((d) => out(d, 80, 'Continente')),
  // A new gym, only two months so far.
  out('2026-08-02', 35, 'Gym'),
  out('2026-09-02', 35, 'Gym'),
];
const snap = { tx, dataFrom: '2025-09-01' };
const find = (b: ReturnType<typeof billsFor>, key: string) => b.bills.find((x) => x.key === key);

describe('bills', () => {
  it('matches the same payee written differently', () => {
    expect(payeeKey('DD VODAFONE PORTUGAL SA 2034')).toBe('vodafone');
    expect(payeeKey('Vodafone')).toBe('vodafone');
    expect(payeeKey('COMPRA 4417 NETFLIX.COM')).toBe('netflix');
  });

  it('finds the monthly bills and how each stands this month', () => {
    const b = billsFor(snap, '2026-09', today);
    expect(find(b, 'vodafone')).toMatchObject({ status: 'paid', amount: 4490, change: { from: 3990, to: 4490 }, cadence: 'monthly' });
    expect(find(b, 'netflix')).toMatchObject({ status: 'due', date: '2026-09-25', amount: 1399 });
    expect(find(b, 'edp comercial')).toMatchObject({ status: 'missing', varying: true, change: null });
    expect(find(b, 'senhorio')).toMatchObject({ status: 'paid', date: '2026-08-31' });
    expect(find(b, 'spotify')).toBeUndefined();
    expect(find(b, 'continente')).toBeUndefined();
    expect(b.candidates.map((c) => c.key)).toContain('continente');
    expect(b.remaining).toBe(1399);
    expect(b.bills[0]!.status).toBe('due');
  });

  it('finds yearly ones and shows them only in their month', () => {
    expect(find(billsFor(snap, '2026-09', today), 'fidelidade')).toMatchObject({ cadence: 'yearly', status: 'paid', change: { from: 24000, to: 25200 } });
    expect(find(billsFor(snap, '2026-08', today), 'fidelidade')).toBeUndefined();
  });

  it('shows past months as they were', () => {
    const aug = billsFor(snap, '2026-08', today);
    expect(find(aug, 'vodafone')).toMatchObject({ status: 'paid', amount: 3990, change: null });
    expect(find(aug, 'senhorio')).toMatchObject({ status: 'paid', date: '2026-08-01' });
  });

  it('follows "Not a bill" and "Track as a bill"', () => {
    const b = billsFor(snap, '2026-09', today, { ignored: [{ key: 'vodafone', name: 'Vodafone' }], tracked: [{ key: 'gym', name: 'Gym' }] });
    expect(find(b, 'vodafone')).toBeUndefined();
    expect(find(b, 'gym')).toMatchObject({ status: 'paid', tracked: true, cadence: 'monthly' });
    expect(b.ignored).toEqual([{ key: 'vodafone', name: 'Vodafone' }]);
  });

  it('writes the Telegram messages', () => {
    const on12th = new Date(2026, 8, 12);
    expect(billAlerts(billsFor(snap, '2026-09', on12th), on12th).map((a) => a.text)).toContain('📈 <b>Vodafone</b> went from €39.90 to <b>€44.90</b> (charged 5 Sept).');
    const texts = billAlerts(billsFor(snap, '2026-09', today), today).map((a) => a.text);
    expect(texts.some((t) => t.includes('Vodafone'))).toBe(false); // old news by the 20th
    expect(texts.find((t) => t.includes('EDP'))).toContain('hasn\'t come in (usually around the 8th, about €');
    expect(texts.some((t) => t.includes('Netflix'))).toBe(false); // not late yet
  });

  it('reads the old saved choices, and drops what makes no sense', () => {
    expect(parseOverrides({ ignored: [{ key: 'vodafone', name: 'Vodafone' }], tracked: [{ key: 'gym', name: 'Gym' }] })).toEqual({ ignored: [{ key: 'vodafone', name: 'Vodafone' }], tracked: [{ key: 'gym', name: 'Gym' }] });
    expect(parseOverrides(null)).toEqual({ ignored: [], tracked: [] });
    expect(parseOverrides({ tracked: [{ key: 'gym', name: 'Gym', label: ' Gym ', expected: 3500, cadence: 'monthly', day: 2 }, { key: 'x', expected: -1, cadence: 'weekly', day: 40 }, { name: 'no key' }] }).tracked)
      .toEqual([{ key: 'gym', name: 'Gym', label: 'Gym', expected: 3500, cadence: 'monthly', day: 2 }, { key: 'x', name: 'x' }]);
  });

  describe('fixed expenses (tracked with what to expect)', () => {
    const water = (eur: number) => out('2026-09-14', eur, 'SMAS Almada');
    const tracked = (more = {}) => ({ ignored: [], tracked: [{ key: 'smas almada', name: 'SMAS Almada', label: 'Water', expected: 3000, cadence: 'monthly' as const, day: 14, ...more }] });

    it('follows what was set, from a single charge, under its own name', () => {
      const s = { tx: [out('2026-08-13', 28, 'SMAS Almada')], dataFrom: '2025-09-01' };
      const b = billsFor(s, '2026-09', today, tracked());
      expect(find(b, 'smas almada')).toMatchObject({ name: 'Water', status: 'missing', date: '2026-09-14', amount: 3000, varying: true, tracked: true, expected: 3000, day: 14, cadence: 'monthly' });
      expect(find(billsFor(s, '2026-09', new Date(2026, 8, 16), tracked()), 'smas almada')).toMatchObject({ status: 'due' });
      // Still expected months later (set by hand: it's expected until it's no longer tracked), but not before it started.
      expect(find(billsFor(s, '2026-11', today, tracked()), 'smas almada')).toMatchObject({ status: 'due', amount: 3000 });
      expect(find(billsFor(s, '2026-07', today, tracked()), 'smas almada')).toBeUndefined();
    });

    it('counts any amount near the day as paid, and flags it only when 25% off', () => {
      const b = (eur: number) => find(billsFor({ tx: [water(eur)], dataFrom: '2025-09-01' }, '2026-09', today, tracked()), 'smas almada');
      expect(b(36)).toMatchObject({ status: 'paid', amount: 3600, change: null });
      expect(b(37.5)).toMatchObject({ change: null }); // exactly 25%
      expect(b(38)).toMatchObject({ status: 'paid', change: { from: 3000, to: 3800 } });
      expect(b(20)).toMatchObject({ change: { from: 3000, to: 2000 } });
      const on15th = new Date(2026, 8, 15);
      expect(billAlerts(billsFor({ tx: [water(38)], dataFrom: '2025-09-01' }, '2026-09', on15th, tracked()), on15th).map((a) => a.text))
        .toEqual(['📈 <b>Water</b> went from €30.00 to <b>€38.00</b> (charged 14 Sept).']);
    });

    it('uses the cadence and day set, instead of guessing', () => {
      // Netflix comes monthly on the 25th; set as yearly on the 3rd, it's expected once, a year after the last one.
      const b = billsFor(snap, '2026-09', today, { ignored: [], tracked: [{ key: 'netflix', name: 'Netflix', cadence: 'yearly', day: 3, expected: 1500 }] });
      expect(find(b, 'netflix')).toBeUndefined();
      expect(find(billsFor(snap, '2027-08', today, { ignored: [], tracked: [{ key: 'netflix', name: 'Netflix', cadence: 'yearly', day: 3, expected: 1500 }] }), 'netflix'))
        .toMatchObject({ cadence: 'yearly', date: '2027-08-03', amount: 1500, status: 'due' });
    });

    it('leaves the bills it finds itself as they were', () => {
      const b = billsFor(snap, '2026-09', today, tracked());
      expect(find(b, 'vodafone')).toMatchObject({ expected: null, tracked: false, varying: false, change: { from: 3990, to: 4490 }, day: 5 });
    });
  });

  it('splits the month into fixed and variable', () => {
    const b = billsFor(snap, '2026-09', today);
    // September's spending as the Money tab counts it (here: everything that went out that month, plus a refund).
    const sept = [...tx.filter((t) => t.date.startsWith('2026-09')), { ...out('2026-09-15', -10, 'Continente') }];
    const spent = sept.reduce((s, t) => s - t.amount, 0);
    const split = fixedVsVariable(b, sept);
    // Paid: Vodafone 44.90, rent 900 (paid on 31 Aug), insurance 252, gym? (not a bill). Still to come: Netflix; missing: EDP.
    const paidBills = b.bills.filter((x) => x.status === 'paid');
    expect(split.paid).toBe(paidBills.reduce((s, x) => s + x.amount, 0));
    expect(split.toCome).toBe(1399 + find(b, 'edp comercial')!.amount);
    // Rent was paid in August: it's fixed for September but not part of September's spending.
    expect(split.variable).toBe(spent - 4490 - 25200);
  });

  describe('grouped by category', () => {
    const groups: Snapshot['groups'] = [
      { id: 'home', name: 'Home', income: false, categories: [{ id: 'mortgage', name: 'Mortgage' }, { id: 'power', name: 'Electricity' }] },
      { id: 'subs', name: 'Subscriptions', income: false, categories: [{ id: 'tv', name: 'Streaming' }, { id: 'phone', name: 'Phone' }] },
      { id: 'food', name: 'Food', income: false, categories: [{ id: 'groceries', name: 'Groceries' }] },
    ];
    const months = ['2026-05', '2026-06', '2026-07', '2026-08'];
    const cat = (payee: string, day: number, eur: number, category: string | null, last: string | null = category) => [
      ...months.map((m) => out(`${m}-${String(day).padStart(2, '0')}`, eur, payee, category)),
      ...(day < 20 ? [out(`2026-09-${String(day).padStart(2, '0')}`, eur, payee, last)] : []),
    ];
    const tx2: Snapshot['tx'] = [
      ...cat('Banco Hipoteca', 2, 650, 'mortgage'),
      ...cat('EDP Comercial', 8, 60, 'power'),
      ...cat('Netflix', 25, 13.99, 'tv'),
      ...cat('Vodafone', 5, 39.9, 'tv', 'phone'), // recategorised lately: the latest category counts
      ...cat('Gym', 3, 35, 'groceries', null), // the latest charge has no category: the one before still counts
      ...cat('Mystery', 10, 20, null),
      // Rent split on the same day: the biggest part's category.
      ...months.flatMap((m) => [out(`${m}-01`, 800, 'Senhorio', 'mortgage'), out(`${m}-01`, 20, 'Senhorio', 'power')]),
    ];
    const b = billsFor({ tx: tx2, dataFrom: '2025-09-01', groups }, '2026-09', today);

    it('takes the category of the most recent charge, and its group', () => {
      expect(find(b, 'banco hipoteca')).toMatchObject({ category: 'Mortgage', group: { id: 'home', name: 'Home' } });
      expect(find(b, 'vodafone')).toMatchObject({ category: 'Phone', group: { id: 'subs', name: 'Subscriptions' } });
      expect(find(b, 'gym')).toMatchObject({ category: 'Groceries', group: { id: 'food', name: 'Food' } });
      expect(find(b, 'senhorio')).toMatchObject({ category: 'Mortgage', group: { id: 'home' } });
      expect(find(b, 'mystery')).toMatchObject({ category: null, group: null });
      expect(find(b, 'banco hipoteca')!.history[0]).toEqual({ date: '2026-09-02', amount: 65000 });
      // Without Actual's groups (as in the Telegram alerts), there's no category.
      expect(find(billsFor({ tx: tx2, dataFrom: '2025-09-01' }, '2026-09', today), 'banco hipoteca')).toMatchObject({ category: null, group: null });
    });

    it('groups the month by category group, biggest first, with what is paid, and the ones without a category last', () => {
      const g = groupBills(b.bills);
      expect(g.map((x) => [x.id, x.name, x.bills.map((y) => y.key).sort()])).toEqual([
        ['home', 'Home', ['banco hipoteca', 'edp comercial', 'senhorio']],
        ['subs', 'Subscriptions', ['netflix', 'vodafone']],
        ['food', 'Food', ['gym']],
        ['uncategorised', 'Sem categoria', ['mystery']],
      ]);
      const home = g[0]!;
      expect(home.total).toBe(65000 + 6000 + 82000);
      // Rent is due on the 1st and didn't come in September: not paid. The mortgage and electricity are.
      expect(find(b, 'senhorio')!.status).not.toBe('paid');
      expect(home.paid).toBe(65000 + 6000);
      expect(g[1]).toMatchObject({ total: 1399 + 3990, paid: 3990 });
      expect(groupBills([])).toEqual([]);
    });
  });
});
