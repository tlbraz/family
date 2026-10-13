import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';

// Each account's IBAN, typed in from the Money tab (Actual doesn't keep them), so it can be copied from there.
// Kept by budget and account name: { "family:ABanca": "PT50…" }.
const KEY = 'money.ibans';

export async function accountIbans(db: Db): Promise<Record<string, string>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return row ? JSON.parse(row.value) : {};
}

export async function saveIban(db: Db, budget: string, account: string, iban: string | null) {
  const all = await accountIbans(db);
  if (iban) all[`${budget}:${account}`] = iban;
  else delete all[`${budget}:${account}`];
  const value = JSON.stringify(all);
  await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** The IBAN without spaces, in capitals, when its check digits are right (ISO 13616 mod 97); otherwise null. */
export function cleanIban(input: string): string | null {
  const iban = input.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return null;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? iban : null;
}

/** "PT50 0002 0123 …": groups of four, as banks print it. */
export const formatIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, '$1 ');
