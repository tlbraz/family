import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';
import { moneySnapshot, type Snapshot } from './money';
import { esc, sendTelegram } from './telegram';

// Tells Tiago on Telegram (this app's bot, only his chat) when a payment from EPI Operations lands in the
// company budget. Runs after each refresh from Actual, so it follows the app's own bank syncs (07, 13, 19 h).
// PAYROLL_PAYEE overrides who to watch (a case-insensitive pattern matched against the payee).

const SEEN_KEY = 'payroll:seen';
const payeePattern = () => new RegExp(process.env.PAYROLL_PAYEE || 'EPI Operations', 'i');
// Tiago = the first chat in TELEGRAM_CHAT_ID (the ones added on the Family page are the rest of the family).
const tiagoChat = () => (process.env.TELEGRAM_CHAT_ID ?? '').split(',')[0]?.trim() || '';

/** Credits from the watched payer that aren't in `seen` yet, oldest first. */
export function newPayrollCredits(tx: Snapshot['tx'], seen: string[], pattern = payeePattern()) {
  return tx
    .filter((t) => t.amount > 0 && pattern.test(t.payee) && !seen.includes(t.id))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function payrollMessage(t: Snapshot['tx'][number]): string {
  const cents = t.amount % 100 !== 0;
  const [int, dec] = (t.amount / 100).toFixed(cents ? 2 : 0).split('.');
  const eur = `€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${dec ? `.${dec}` : ''}`;
  return `💶 <b>${esc(t.payee)}</b> paid <b>${eur}</b> into Empresa`;
}

export async function runPayrollAlert(db: Db) {
  if (!process.env.ACTUAL_COMPANY_SYNC_ID || !tiagoChat()) return;
  let snap: Snapshot;
  try {
    snap = await moneySnapshot('company');
  } catch {
    return; // Actual unreachable: the money page already reports that
  }
  const [row] = await db.select().from(settings).where(eq(settings.key, SEEN_KEY));
  const credits = snap.tx.filter((t) => t.amount > 0 && payeePattern().test(t.payee));
  if (!row) {
    // First run: remember what's already there instead of announcing old payments.
    await db.insert(settings).values({ key: SEEN_KEY, value: JSON.stringify(credits.map((t) => t.id)) }).onConflictDoNothing();
    return;
  }
  const seen: string[] = JSON.parse(row.value);
  for (const t of newPayrollCredits(snap.tx, seen)) {
    if (!(await sendTelegram(payrollMessage(t), tiagoChat()))) break; // try again on the next refresh
    seen.push(t.id);
    await db.update(settings).set({ value: JSON.stringify(seen) }).where(eq(settings.key, SEEN_KEY));
  }
}
