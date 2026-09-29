import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MoneyBudget, MoneyGroup, MoneySummary, MoneyTransaction } from '../../shared/types';

/**
 * The Money tab reads from Actual Budget (self-hosted, fed by bank sync). Actual stays the place to categorise
 * and fix things; here we only summarise. A background refresh keeps a copy of each budget in memory, so the
 * page is fast and still works for a while if Actual is down.
 */
const SYNC_IDS: Record<MoneyBudget, string | undefined> = {
  family: process.env.ACTUAL_SYNC_ID,
  company: process.env.ACTUAL_COMPANY_SYNC_ID,
};
export const moneyEnabled = () => !!(process.env.ACTUAL_SERVER_URL && process.env.ACTUAL_PASSWORD && SYNC_IDS.family);

/** Which budgets a parent may open. The company one is private (ACTUAL_COMPANY_VIEWERS, default Tiago). */
export function budgetsFor(name: string): MoneyBudget[] {
  const viewers = (process.env.ACTUAL_COMPANY_VIEWERS ?? 'Tiago').split(',').map((s) => s.trim().toLowerCase());
  return SYNC_IDS.company && viewers.includes(name.toLowerCase()) ? ['family', 'company'] : ['family'];
}

// ---- What we keep from Actual -------------------------------------------------------------------

export interface Snapshot {
  fetchedAt: string;
  accounts: { id: string; name: string; offBudget: boolean; balance: number }[];
  groups: { id: string; name: string; income: boolean; hidden?: boolean; categories: { id: string; name: string }[] }[];
  /** Expense-side transactions of on-budget accounts: no transfers, no starting balances, splits flattened. */
  tx: { id: string; accountId: string; fixable: boolean; review: boolean; note: string | null; date: string; amount: number; account: string; category: string | null; payee: string }[];
  dataFrom: string | null; // earliest real transaction, to know which months are complete
  bankSyncedAt?: string | null; // the latest bank sync of any linked account (ours, Actual's button or another tool)
  review: { id: string; accountId: string; fixable: boolean; note?: string | null; date: string; amount: number; account: string; category: string | null; payee: string }[]; // tagged #review
}

type Api = typeof import('@actual-app/api');
const REVIEW_TAG = /(^|\s)#review\b/i;
let apiPromise: Promise<Api> | null = null;
const snapshots = new Map<MoneyBudget, Snapshot>();
let lastError: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

// Actual's API holds one open budget per process, so every use goes through this queue.
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function actual(): Promise<Api> {
  apiPromise ??= (async () => {
    const api = await import('@actual-app/api');
    const dataDir = join(tmpdir(), 'family-actual');
    mkdirSync(dataDir, { recursive: true });
    await api.init({ dataDir, serverURL: process.env.ACTUAL_SERVER_URL!, password: process.env.ACTUAL_PASSWORD! });
    return api;
  })().catch((e) => {
    apiPromise = null; // try again next time
    throw e;
  });
  return apiPromise;
}

async function load(budget: MoneyBudget, bankSync: boolean): Promise<Snapshot> {
  const api = await actual();
  await api.downloadBudget(SYNC_IDS[budget]!);
  if (bankSync) {
    // Asks the banks for new transactions (Actual doesn't do this on its own). Failures are only logged:
    // an expired bank link shouldn't hide the numbers we already have.
    await api.runBankSync().catch((e: Error) => console.error(`actual bank sync (${budget}):`, e.message));
    await api.sync().catch(() => {});
  }
  const from = new Date();
  from.setMonth(from.getMonth() - 13, 1);
  const start = from.toISOString().slice(0, 10);
  const end = '2999-12-31';

  const payees = new Map((await api.getPayees()).map((p) => [p.id, p.name]));
  const accounts: Snapshot['accounts'] = [];
  const tx: Snapshot['tx'] = [];
  const review: Snapshot['review'] = [];
  let dataFrom: string | null = null;
  for (const a of await api.getAccounts()) {
    if (a.closed) continue;
    accounts.push({ id: a.id, name: a.name, offBudget: !!a.offbudget, balance: await api.getAccountBalance(a.id) });
    // Anything tagged #review, in any account and any month, is still waiting to be checked.
    for (const t of await api.getTransactions(a.id, '1900-01-01', end)) {
      const parts = [t, ...(t.subtransactions ?? [])];
      const tagged = parts.find((p) => REVIEW_TAG.test(p.notes ?? ''));
      if (tagged) {
        const plain = !t.subtransactions?.length && !t.is_child && !t.transfer_id;
        review.push({ id: tagged.id, accountId: a.id, fixable: plain, note: withoutReviewTag(tagged.notes), date: t.date, amount: tagged.amount, account: a.name, category: tagged.category ?? null, payee: (t.payee && payees.get(t.payee)) || t.imported_payee || '' });
      }
    }
    if (a.offbudget) continue;
    for (const t of await api.getTransactions(a.id, start, end)) {
      if (t.transfer_id || t.starting_balance_flag) continue;
      if (!dataFrom || t.date < dataFrom) dataFrom = t.date;
      const payee = (t.payee && payees.get(t.payee)) || t.imported_payee || '';
      const split = !!t.subtransactions?.length;
      const parts = split ? t.subtransactions! : [t];
      for (const p of parts) {
        if (p.transfer_id) continue;
        const review = REVIEW_TAG.test(p.notes ?? '') || REVIEW_TAG.test(t.notes ?? '');
        tx.push({ id: p.id, accountId: a.id, fixable: !split, review, note: withoutReviewTag(p.notes), date: t.date, amount: p.amount, account: a.name, category: p.category ?? null, payee });
      }
    }
  }
  const groups = (await api.getCategoryGroups()).map((g) => ({
    id: g.id,
    name: g.name,
    income: !!g.is_income,
    hidden: !!g.hidden,
    categories: (g.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
  }));
  // Actual keeps when each bank-linked account last synced; getAccounts leaves it out, so ask for it.
  const synced = await api
    .aqlQuery(api.q('accounts').select(['last_sync']))
    .then((r) => ((r as { data: { last_sync: string | null }[] }).data ?? []).map((a) => Number(a.last_sync)).filter((n) => n > 0))
    .catch(() => [] as number[]);
  const bankSyncedAt = synced.length ? new Date(Math.max(...synced)).toISOString() : null;
  return { fetchedAt: new Date().toISOString(), accounts, groups, tx, dataFrom, review, bankSyncedAt };
}

/** Fetches every configured budget. Called on a timer and, the first time, by the page. */
export function refreshMoney({ bankSync = false } = {}) {
  return serial(async () => {
    for (const budget of Object.keys(SYNC_IDS) as MoneyBudget[]) {
      if (!SYNC_IDS[budget]) continue;
      try {
        snapshots.set(budget, await load(budget, bankSync));
        lastError = null;
      } catch (e) {
        lastError = (e as Error).message;
        console.error(`actual (${budget}):`, lastError);
      }
    }
  });
}

export const withoutReviewTag = (notes: string | null | undefined) =>
  (notes ?? '').replace(/(^|\s)#review\b/gi, ' ').replace(/\s+/g, ' ').trim() || null;

/**
 * Changes a transaction in Actual from the app: its category, and/or whether it's tagged #review (the rest of the
 * note is kept). Then reads the budget again so the page shows the change.
 */
export function editTransaction(budget: MoneyBudget, id: string, change: { category?: string; review?: boolean; note?: string }) {
  return serial(async () => {
    const snap = snapshots.get(budget);
    const item = snap?.tx.find((t) => t.id === id) ?? snap?.review.find((t) => t.id === id);
    if (!snap || !item) throw new ReviewError('That transaction is no longer here; pull to refresh');
    if (change.category !== undefined) {
      if (!item.fixable) throw new ReviewError('Change the category of splits and transfers in Actual');
      if (!snap.groups.some((g) => g.categories.some((c) => c.id === change.category))) throw new ReviewError('Unknown category');
    }
    const api = await actual();
    await api.downloadBudget(SYNC_IDS[budget]!);
    const all = await api.getTransactions(item.accountId, '1900-01-01', '2999-12-31');
    const current = all.flatMap((t) => [t, ...(t.subtransactions ?? [])]).find((t) => t.id === id);
    if (!current) throw new ReviewError('That transaction is no longer in Actual');
    // The note is the description plus, when it needs review, the #review tag at the end.
    const tagged = change.review ?? REVIEW_TAG.test(current.notes ?? '');
    const text = change.note !== undefined ? change.note.trim().slice(0, 500) : withoutReviewTag(current.notes) ?? '';
    const notes = tagged ? `${text} #review`.trim() : text;
    await api.updateTransaction(id, { notes, ...(change.category !== undefined ? { category: change.category } : {}) });
    await api.sync();
    snapshots.set(budget, await load(budget, false));
  });
}

/** Done reviewing: optionally a new category, and the #review tag comes out. */
export const reviewTransaction = (budget: MoneyBudget, id: string, category?: string) => editTransaction(budget, id, { category, review: false });
export class ReviewError extends Error {}

export async function moneySnapshot(budget: MoneyBudget): Promise<Snapshot> {
  if (!snapshots.has(budget)) await refreshMoney();
  const snap = snapshots.get(budget);
  if (!snap) throw new Error(`Couldn't read Actual Budget${lastError ? `: ${lastError}` : ''}`);
  return snap;
}

// Bank sync a few times a day: banks allow about 4 automatic reads per account per day.
const BANK_SYNC_HOURS = [7, 13, 19];
let lastBankSync = '';
export function runMoney(now = new Date()) {
  if (!moneyEnabled()) return;
  const slot = `${now.toDateString()} ${now.getHours()}`;
  const bankSync = process.env.ACTUAL_BANK_SYNC !== 'off' && BANK_SYNC_HOURS.includes(now.getHours()) && lastBankSync !== slot;
  if (bankSync) lastBankSync = slot;
  return refreshMoney({ bankSync });
}

// ---- The month summary (pure, so it can be tested) ----------------------------------------------

/**
 * Who money came from: the income category when it's a named one (e.g. "Tiago", "Catarina"), otherwise who paid
 * (Actual's generic "Income" says nothing). Money in without a category is kept apart.
 */
function sourceName(t: { category: string | null; payee: string }, catName: Map<string, string>) {
  if (!t.category) return 'Not categorised';
  const cat = catName.get(t.category);
  return cat && !/^income$/i.test(cat) ? cat : t.payee || cat || 'Income';
}

const monthKey = (d: string) => d.slice(0, 7);
const daysIn = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const addMonths = (month: string, n: number) => {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function summarise(snap: Snapshot, budget: MoneyBudget, budgets: MoneyBudget[], month: string, today: Date): MoneySummary {
  const incomeCats = new Set(snap.groups.filter((g) => g.income).flatMap((g) => g.categories.map((c) => c.id)));
  const groupOf = new Map<string, { groupId: string; groupName: string; name: string }>();
  for (const g of snap.groups) for (const c of g.categories) groupOf.set(c.id, { groupId: g.id, groupName: g.name, name: c.name });

  // Spending: expenses count, refunds in an expense category count back; income and unknown money in don't.
  const spending = snap.tx.filter((t) => (t.category ? !incomeCats.has(t.category) : t.amount < 0));
  const usedCats = new Set(spending.map((t) => t.category));
  // Money in: income categories, and money in without a category (shown apart, it may be a refund or a transfer).
  const catName = new Map(snap.groups.flatMap((g) => g.categories.map((c) => [c.id, c.name] as const)));
  const incomeTx = snap.tx.filter((t) => monthKey(t.date) === month && (t.category ? incomeCats.has(t.category) : t.amount > 0));
  const spentIn = (m: string, uptoDay = 31) =>
    spending.filter((t) => monthKey(t.date) === m && Number(t.date.slice(8, 10)) <= uptoDay).reduce((s, t) => s - t.amount, 0);

  const current = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isCurrent = month === current;
  const day = isCurrent ? today.getDate() : null;

  // "Usually": the average of up to 3 earlier months we have complete data for, up to the same day.
  const complete = (m: string) => !!snap.dataFrom && snap.dataFrom <= `${m}-03`;
  const earlier = [1, 2, 3].map((n) => addMonths(month, -n)).filter(complete);
  const usual = earlier.length
    ? Math.round(earlier.reduce((s, m) => s + spentIn(m, day ? Math.min(day, daysIn(m)) : 31), 0) / earlier.length)
    : null;

  const groups = new Map<string, MoneyGroup>();
  const transactions: MoneyTransaction[] = [];
  for (const t of spending) {
    if (monthKey(t.date) !== month) continue;
    const c = t.category ? groupOf.get(t.category) : undefined;
    const groupId = c?.groupId ?? 'uncategorised';
    const catId = t.category ?? 'uncategorised';
    const g = groups.get(groupId) ?? { id: groupId, name: c?.groupName ?? 'Not categorised', amount: 0, categories: [] };
    let cat = g.categories.find((x) => x.id === catId);
    if (!cat) g.categories.push((cat = { id: catId, name: c?.name ?? 'Not categorised', amount: 0 }));
    g.amount -= t.amount;
    cat.amount -= t.amount;
    groups.set(groupId, g);
    transactions.push({ id: t.id, categoryId: t.category, fixable: t.fixable, review: t.review, note: t.note, date: t.date, payee: t.payee, account: t.account, groupId, category: cat.name, amount: -t.amount });
  }
  const sorted = [...groups.values()]
    .map((g) => ({ ...g, categories: g.categories.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount) }))
    .filter((g) => g.amount > 0)
    .sort((a, b) => (a.id === 'uncategorised' ? 1 : b.id === 'uncategorised' ? -1 : b.amount - a.amount));

  const first = snap.dataFrom ? monthKey(snap.dataFrom) : current;
  const months: string[] = [];
  for (let m = first; m <= current; m = addMonths(m, 1)) months.push(m);

  return {
    budget,
    budgets,
    month,
    months,
    today: day,
    daysInMonth: daysIn(month),
    spent: spentIn(month),
    income: (() => {
      const bySource = new Map<string, number>();
      for (const t of incomeTx) {
        const name = sourceName(t, catName);
        bySource.set(name, (bySource.get(name) ?? 0) + t.amount);
      }
      return {
        total: incomeTx.reduce((sum, t) => sum + t.amount, 0),
        sources: [...bySource].map(([name, amount]) => ({ name, amount })).sort((a, b) => (a.name === 'Not categorised' ? 1 : b.name === 'Not categorised' ? -1 : b.amount - a.amount)),
        transactions: incomeTx
          .map((t) => ({ id: t.id, categoryId: t.category, fixable: t.fixable, review: t.review, note: t.note, date: t.date, payee: t.payee, account: t.account, groupId: 'income', category: sourceName(t, catName), amount: -t.amount }))
          .sort((a, b) => b.date.localeCompare(a.date)),
      };
    })(),
    usual,
    groups: sorted,
    // Colours go to the groups actually used (Actual's unused default and hidden groups would take slots otherwise).
    groupOrder: snap.groups.filter((g) => !g.income && !g.hidden && g.categories.some((c) => usedCats.has(c.id))).map((g) => g.id),
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount),
    accounts: snap.accounts
      .map(({ name, balance, offBudget }) => ({ name, balance, offBudget }))
      .sort((a, b) => Number(a.offBudget) - Number(b.offBudget) || b.balance - a.balance),
    fetchedAt: snap.fetchedAt,
    bankSyncedAt: snap.bankSyncedAt ?? null,
    link: process.env.ACTUAL_PUBLIC_URL || process.env.ACTUAL_SERVER_URL || null,
    review: snap.review
      .map((t) => {
        const c = t.category ? groupOf.get(t.category) : undefined;
        return { id: t.id, categoryId: t.category, fixable: t.fixable, review: true, note: t.note ?? null, date: t.date, payee: t.payee, account: t.account, groupId: c?.groupId ?? 'uncategorised', category: c?.name ?? 'Not categorised', amount: -t.amount };
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    // Spending groups first, then income, as in Actual.
    pickable: [...snap.groups.filter((g) => !g.hidden && !g.income), ...snap.groups.filter((g) => !g.hidden && g.income)]
      .map((g) => ({ id: g.id, name: g.name, categories: g.categories })),
  };
}
