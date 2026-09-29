import { describe, expect, it } from 'vitest';
import { budgetsFor, summarise, type Snapshot } from './money';

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
const t = (date: string, amount: number, category: string | null, payee = 'X') => ({ date, amount, account: 'CGD', category, payee });

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
    const s = summarise(snap([], { review: [t('2026-08-02', -6490, null, 'LEROY'), t('2026-09-03', -1200, 'luz', 'EDP')] }), 'family', ['family'], '2026-09', today);
    expect(s.review.map((r) => [r.payee, r.category, r.amount])).toEqual([['EDP', 'Luz', 1200], ['LEROY', 'Not categorised', 6490]]);
    expect(s.accounts.map((a) => a.name)).toEqual(['CGD', 'Cartão', 'PPR']);
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
