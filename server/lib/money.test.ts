import { describe, expect, it } from 'vitest';
import { budgetsFor, netWorth, summarise, withoutReviewTag, type Snapshot } from './money';

const snap = (tx: Snapshot['tx'], extra: Partial<Snapshot> = {}): Snapshot => ({
  fetchedAt: '2026-09-29T10:00:00Z',
  accounts: [
    { id: 'a1', name: 'CGD', offBudget: false, balance: 150000 },
    { id: 'a2', name: 'Cartão', offBudget: false, balance: -41800 },
    { id: 'a3', name: 'PPR', offBudget: true, balance: 1890000 },
  ],
  groups: [
    { id: 'gi', name: 'Income', income: true, categories: [{ id: 'salary', name: 'Income' }] },
    { id: 'gcasa', name: 'Casa', income: false, categories: [{ id: 'hipoteca', name: 'Hipoteca' }, { id: 'luz', name: 'Luz' }] },
    { id: 'gsuper', name: 'Supermercado', income: false, categories: [{ id: 'super', name: 'Supermercado' }] },
  ],
  tx,
  dataFrom: '2026-07-01',
  review: [],
  ...extra,
});
let n = 0;
const t = (date: string, amount: number, category: string | null, payee = 'X') => ({ id: `t${++n}`, accountId: 'a1', fixable: true, review: false, note: null, date, amount, account: 'CGD', category, payee });

describe('money summary', () => {
  const today = new Date(2026, 8, 20); // 20 Sep

  it('counts expenses by group and category, and leaves income and unknown money in out', () => {
    const s = summarise(
      snap([
        t('2026-09-01', 310000, 'salary'),
        t('2026-09-01', -78000, 'hipoteca'),
        t('2026-09-12', -6420, 'luz'),
        t('2026-09-05', -5000, 'super'),
        t('2026-09-06', 1000, 'super'), // a refund lowers the category
        t('2026-09-07', -2350, null, 'MB WAY'), // not categorised yet
        t('2026-09-08', 5000, null), // money in without a category: not spending
      ]),
      'family', ['family'], '2026-09', today,
    );
    expect(s.spent).toBe(78000 + 6420 + 4000 + 2350);
    expect(s.groups.map((g) => [g.name, g.amount])).toEqual([['Casa', 84420], ['Supermercado', 4000], ['Not categorised', 2350]]);
    expect(s.groups[0]!.categories.map((c) => c.name)).toEqual(['Hipoteca', 'Luz']);
    expect(s.transactions.find((x) => x.payee === 'MB WAY')).toMatchObject({ groupId: 'uncategorised', amount: 2350 });
    expect(s.groupOrder).toEqual(['gcasa', 'gsuper']);
  });

  it('compares with the average of earlier complete months up to the same day', () => {
    const s = summarise(
      snap([
        t('2026-07-10', -10000, 'super'), t('2026-07-25', -99900, 'super'), // after the 20th: not counted "by now"
        t('2026-08-10', -20000, 'super'),
        t('2026-09-10', -12000, 'super'),
      ]),
      'family', ['family'], '2026-09', today,
    );
    expect(s.today).toBe(20);
    expect(s.usual).toBe(15000); // (10 000 + 20 000) / 2; June has no data
  });

  it('has no comparison until a full month of history exists, and lists the months with data', () => {
    const s = summarise(snap([t('2026-09-10', -1000, 'super')], { dataFrom: '2026-09-10' }), 'family', ['family'], '2026-09', today);
    expect(s.usual).toBeNull();
    expect(s.months).toEqual(['2026-09']);
    expect(summarise(snap([]), 'family', ['family'], '2026-09', today).months).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('shows past months in full', () => {
    const s = summarise(snap([t('2026-08-30', -5000, 'super')]), 'family', ['family'], '2026-08', today);
    expect(s.today).toBeNull();
    expect(s.spent).toBe(5000);
    expect(s.daysInMonth).toBe(31);
  });

  it('lists the #review transactions and the accounts, spending ones first', () => {
    const r = (tx: ReturnType<typeof t>, id: string, fixable = true) => ({ ...tx, id, accountId: 'a1', fixable });
    const s = summarise(snap([], { review: [r(t('2026-08-02', -6490, null, 'LEROY'), 'x1'), r(t('2026-09-03', -1200, 'luz', 'EDP'), 'x2', false)] }), 'family', ['family'], '2026-09', today);
    expect(s.review.map((r) => [r.payee, r.category, r.amount])).toEqual([['EDP', 'Luz', 1200], ['LEROY', 'Not categorised', 6490]]);
    expect(s.review.map((x) => [x.id, x.categoryId, x.fixable])).toEqual([['x2', 'luz', false], ['x1', null, true]]);
    expect(s.accounts.map((a) => a.name)).toEqual(['CGD', 'Cartão', 'PPR']);
    expect(s.pickable.map((g) => g.name)).toEqual(['Casa', 'Supermercado', 'Income']);
  });

  it('takes only the #review tag out of the notes', () => {
    expect(withoutReviewTag('check this #review')).toBe('check this');
    expect(withoutReviewTag('#review')).toBeNull();
    expect(withoutReviewTag('#Review ask Ana #reviewed')).toBe('ask Ana #reviewed');
    expect(withoutReviewTag(null)).toBeNull();
  });
});

describe('colours and money in', () => {
  const today = new Date(2026, 8, 20);

  it('gives colours only to groups that are used, not empty or hidden ones', () => {
    const base = snap([t('2026-09-05', -5000, 'super'), t('2026-08-05', -1000, 'spare')]);
    base.groups.splice(1, 0,
      { id: 'gdefault', name: 'Usual Expenses', income: false, categories: [{ id: 'food', name: 'Food' }] },
      { id: 'ghidden', name: 'Old', income: false, hidden: true, categories: [{ id: 'spare', name: 'Spare' }] });
    expect(summarise(base, 'family', ['family'], '2026-09', today).groupOrder).toEqual(['gsuper']);
  });

  it('sums what came in by who paid, with uncategorised money in apart', () => {
    const s = summarise(
      snap([
        t('2026-09-01', 310000, 'salary', 'SALARIO TIAGO'),
        t('2026-09-01', 210000, 'salary', 'VENCIMENTO CATARINA'),
        t('2026-09-15', 2500, null, 'MB WAY ANA'),
        t('2026-08-01', 310000, 'salary', 'SALARIO TIAGO'), // another month
        t('2026-09-06', 1000, 'super'), // a refund is less spending, not income
      ]),
      'family', ['family'], '2026-09', today,
    );
    expect(s.income.total).toBe(522500);
    expect(s.income.sources).toEqual([
      { name: 'SALARIO TIAGO', amount: 310000 },
      { name: 'VENCIMENTO CATARINA', amount: 210000 },
      { name: 'Not categorised', amount: 2500 },
    ]);
    expect(s.income.transactions).toHaveLength(3);
  });

  it('names money in after its income category when it has a name of its own', () => {
    const base = snap([
      t('2026-09-01', 310000, 'inc-tiago', 'ACME LDA'),
      t('2026-09-01', 210000, 'inc-cat', 'HOSPITAL'),
      t('2026-09-03', 5000, 'salary', 'IRS'),
    ]);
    base.groups[0]!.categories.push({ id: 'inc-tiago', name: 'Tiago' }, { id: 'inc-cat', name: 'Catarina' });
    const s = summarise(base, 'family', ['family'], '2026-09', today);
    expect(s.income.sources.map((x) => x.name)).toEqual(['Tiago', 'Catarina', 'IRS']);
    expect(s.income.transactions.find((x) => x.payee === 'ACME LDA')!.category).toBe('Tiago');
  });
});

describe('who sees which budget', () => {
  it('keeps the company budget to its viewers', () => {
    process.env.ACTUAL_COMPANY_VIEWERS = 'Tiago';
    expect(budgetsFor('Catarina')).toEqual(['family']);
  });
});

describe('net worth over time', () => {
  it('adds up cash and savings day by day, leaving debts out', () => {
    const s = snap([], {
      accounts: [
        { id: 'a1', name: 'CGD', offBudget: false, balance: 120000, days: [['2026-09-01', 100000], ['2026-09-03', 30000], ['2026-09-05', -10000]] },
        { id: 'a3', name: 'PPR', offBudget: true, balance: 500000, days: [['2026-08-01', 480000], ['2026-09-04', 20000]] },
        { id: 'a4', name: 'Mortgage', offBudget: true, balance: -9000000, days: [['2026-01-01', -9000000]] },
        { id: 'a5', name: 'Unused', offBudget: false, balance: 0, days: [] },
      ],
    });
    const w = netWorth(s, new Date(2026, 8, 5))!;
    expect(w.points[0]).toEqual({ date: '2026-08-01', cash: 0, saved: 480000 });
    expect(w.points.at(-1)).toEqual({ date: '2026-09-05', cash: 120000, saved: 500000 });
    expect(w.points.find((p) => p.date === '2026-09-03')).toEqual({ date: '2026-09-03', cash: 130000, saved: 480000 });
    expect(w.points).toHaveLength(36); // every day from 1 Aug to 5 Sep, DST or not
    expect(w.debtsLeftOut).toEqual(['Mortgage']);
  });

  it('counts starting balances as there from the start', () => {
    const s = snap([], { accounts: [
      { id: 'a1', name: 'CGD', offBudget: false, balance: 1500, days: [['2026-09-01', 500], ['2026-09-10', 1000]] },
      { id: 'a3', name: 'PPR', offBudget: true, balance: 900000, days: [['0000-00-00', 900000]] },
    ] });
    const w = netWorth(s, new Date(2026, 8, 12))!;
    expect(w.points[0]).toEqual({ date: '2026-09-01', cash: 500, saved: 900000 });
    expect(w.points).toHaveLength(12);
  });

  it('shows at most the last year', () => {
    const s = snap([], { accounts: [{ id: 'a1', name: 'CGD', offBudget: false, balance: 300, days: [['2020-01-01', 100], ['2026-01-01', 200]] }] });
    const w = netWorth(s, new Date(2026, 8, 30))!;
    expect(w.points[0]).toEqual({ date: '2025-09-30', cash: 100, saved: 0 });
    expect(w.points.at(-1)!.cash).toBe(300);
  });
});
