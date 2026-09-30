import { describe, expect, it } from 'vitest';
import { billAlerts, billsFor, payeeKey } from './bills';
import type { Snapshot } from './money';

let n = 0;
const out = (date: string, euros: number, payee: string): Snapshot['tx'][number] => ({
  id: `t${++n}`, accountId: 'a1', fixable: true, review: false, note: null, date, amount: -Math.round(euros * 100), account: 'CGD', category: null, payee,
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
});
