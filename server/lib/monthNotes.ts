import { eq } from 'drizzle-orm';
import type { MoneyBudget, MonthNote } from '../../shared/types';
import type { Db } from '../db';
import { settings } from '../schema';

// What happened in a month ("🦶 Foot fracture: doctor, orthopaedic boot"), written on the Money tab so an unusual
// month is easy to understand later. Kept here, not in Actual: they're not bookkeeping. One settings row per budget.

const key = (budget: MoneyBudget) => `monthnotes:${budget}`;

export async function monthNotes(db: Db, budget: MoneyBudget): Promise<Record<string, MonthNote[]>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key(budget)));
  return row ? (JSON.parse(row.value) as Record<string, MonthNote[]>) : {};
}

/** Checks the notes sent from the page; throws a readable message. */
export function cleanNotes(input: unknown): MonthNote[] {
  if (!Array.isArray(input) || input.length > 10) throw new Error('Up to 10 notes a month');
  return input.map((n: Partial<MonthNote>, i) => {
    const title = String(n?.title ?? '').trim().slice(0, 80);
    if (!title) throw new Error('Each note needs a title');
    const emoji = String(n?.emoji ?? '').trim().slice(0, 8) || '📌';
    const text = String(n?.text ?? '').trim().slice(0, 300) || null;
    const amount = n?.amount === null || n?.amount === undefined || (n.amount as unknown) === '' ? null : Math.round(Number(n.amount));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000)) throw new Error(`"${title}": the amount must be a number`);
    return { id: String(n?.id ?? '').slice(0, 40) || `${Date.now().toString(36)}${i}`, emoji, title, text, amount };
  });
}

export async function saveMonthNotes(db: Db, budget: MoneyBudget, month: string, notes: MonthNote[]) {
  const all = await monthNotes(db, budget);
  if (notes.length) all[month] = notes;
  else delete all[month];
  const value = JSON.stringify(all);
  await db.insert(settings).values({ key: key(budget), value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  return all;
}
