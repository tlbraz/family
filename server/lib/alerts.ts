import { eq } from 'drizzle-orm';
import { DOCUMENT_KINDS, type DocumentKind } from '../../shared/types';
import type { Db } from '../db';
import { memberDocuments, members, settings } from '../schema';
import { type BillOverrides, billAlerts, billsFor } from './bills';
import { moneyEnabled, moneySnapshot, stillOwed, type Snapshot } from './money';
import { tiagoChat } from './payroll';
import { esc, sendTelegram, telegramEnabled } from './telegram';
import { dateKey } from './time';

// Telegram warnings for things that go wrong quietly: documents running out, and a bank that stopped syncing.
// Each is sent once (remembered in settings), and only in the daytime.

const daytime = (now: Date) => now.getHours() >= 9 && now.getHours() < 21;
const longDate = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function once(db: Db, key: string, send: () => Promise<boolean>) {
  const [done] = await db.select().from(settings).where(eq(settings.key, key));
  if (done) return;
  if (await send()) await db.insert(settings).values({ key, value: new Date().toISOString() }).onConflictDoNothing();
}

// ---- Documents ---------------------------------------------------------------------------------

/** Which warning a document is due: 90, 30 or 7 days ahead, or on/after the day it expires. */
export function expiryStage(expires: string, today: Date): 90 | 30 | 7 | 0 | null {
  const days = Math.round((new Date(`${expires}T12:00`).getTime() - new Date(`${dateKey(today)}T12:00`).getTime()) / 86_400_000);
  if (days <= 0) return 0;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  if (days <= 90) return 90;
  return null;
}

export function expiryMessage(person: string, document: string, expires: string, today: Date): string {
  const days = Math.round((new Date(`${expires}T12:00`).getTime() - new Date(`${dateKey(today)}T12:00`).getTime()) / 86_400_000);
  const what = `<b>${esc(person)}'s ${esc(document)}</b>`;
  if (days < 0) return `🪪 ${what} expired on ${longDate(expires)}.`;
  if (days === 0) return `🪪 ${what} expires <b>today</b>.`;
  return `🪪 ${what} expires in <b>${days} day${days === 1 ? '' : 's'}</b> (${longDate(expires)}).`;
}

/** Every minute (cheap); each document gets each warning once. Goes to the family chats (parents). */
export async function runDocumentAlerts(db: Db, now = new Date()) {
  if (!telegramEnabled() || !daytime(now)) return;
  const rows = await db
    .select({ doc: memberDocuments, person: members.name })
    .from(memberDocuments)
    .innerJoin(members, eq(members.id, memberDocuments.memberId));
  for (const { doc, person } of rows) {
    if (!doc.expires) continue;
    const stage = expiryStage(doc.expires, now);
    if (stage === null) continue;
    const name = (doc.kind === 'other' && doc.label) || DOCUMENT_KINDS[doc.kind as DocumentKind]?.label || doc.kind;
    // Keyed on what the document is, not its row id (saving the family page rewrites the rows).
    const key = `docexpiry:${doc.memberId}:${doc.kind}:${doc.number}:${doc.expires}:${stage}`;
    await once(db, key, () => sendTelegram(expiryMessage(person, name, doc.expires!, now)));
  }
}

// ---- Bank links --------------------------------------------------------------------------------

const STALE_HOURS = 36;
// One failed sync is usually the bank having a bad moment (1 Oct 2026: Revolut and Activo failed at 19:00, fine at 07:00).
// Syncs run at 07, 13 and 19 (the longest gap is 12 h overnight), so a failure only counts once the last good sync is
// more than 13 h old, i.e. at least two syncs in a row didn't work.
const FAILED_HOURS = 13;

/** Linked accounts that stopped syncing: failing for two syncs in a row, or none worked for a day and a half. */
export function staleBankLinks(links: NonNullable<Snapshot['bankLinks']>, now: Date) {
  return links.filter((l) => {
    if (!l.lastSync) return true;
    const hours = (now.getTime() - new Date(l.lastSync).getTime()) / 3_600_000;
    return hours > STALE_HOURS || (!!l.status && l.status !== 'ok' && hours > FAILED_HOURS);
  });
}

export function staleMessage(l: NonNullable<Snapshot['bankLinks']>[number]): string {
  const when = (d: Date) => d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
  const since = l.lastSync ? `last synced ${when(new Date(l.lastSync))}` : 'has never synced';
  const failing = l.status && l.status !== 'ok' ? ` (Actual says: ${esc(l.status)})` : '';
  return `⚠️ <b>${esc(l.name)}</b> ${since}${failing}. The bank link may have expired: re-link it in Actual → Bank Sync.`;
}

/** After each read of Actual: tell Tiago (who looks after the links) once a day per account that's stuck. */
export async function runBankAlerts(db: Db, now = new Date()) {
  if (!moneyEnabled() || !tiagoChat() || !daytime(now)) return;
  for (const budget of ['family', 'company'] as const) {
    if (budget === 'company' && !process.env.ACTUAL_COMPANY_SYNC_ID) continue;
    const snap = await moneySnapshot(budget).catch(() => null);
    for (const l of staleBankLinks(snap?.bankLinks ?? [], now)) {
      await once(db, `bankstale:${budget}:${l.name}:${dateKey(now)}`, () => sendTelegram(staleMessage(l), tiagoChat()));
    }
  }
}

// ---- Money to be reimbursed --------------------------------------------------------------------

const OWED_DAYS = 30;
const euros = (cents: number) => `€${(cents / 100).toFixed(2).replace('.00', '')}`;

/** Expenses paid for someone else (e.g. the company) that haven't come back after a month. */
export function overdueOwed(items: NonNullable<Snapshot['owed']>, now: Date) {
  return stillOwed(items).filter((t) => (new Date(`${dateKey(now)}T12:00`).getTime() - new Date(`${t.date}T12:00`).getTime()) / 86_400_000 >= OWED_DAYS);
}

export function owedMessage(t: ReturnType<typeof overdueOwed>[number]): string {
  const what = t.note ? `${esc(t.payee)} (${esc(t.note)})` : esc(t.payee || 'an expense');
  return `🧾 Still not paid back: <b>${euros(t.left)}</b> for ${what}, paid on ${longDate(t.date)}.`;
}

/** After each read of Actual: tell Tiago once per expense that's been waiting a month. */
export async function runOwedAlerts(db: Db, now = new Date()) {
  if (!moneyEnabled() || !tiagoChat() || !daytime(now)) return;
  const snap = await moneySnapshot('family').catch(() => null);
  for (const t of overdueOwed(snap?.owed ?? [], now)) {
    await once(db, `owed:${t.id}`, () => sendTelegram(owedMessage(t), tiagoChat()));
  }
}

// ---- Bills -------------------------------------------------------------------------------------

const OVERRIDES_KEY = 'bills:family';

/** "Not a bill" and "Track as a bill" choices made on the Money tab. */
export async function billOverrides(db: Db): Promise<BillOverrides> {
  const [row] = await db.select().from(settings).where(eq(settings.key, OVERRIDES_KEY));
  return row ? (JSON.parse(row.value) as BillOverrides) : { ignored: [], tracked: [] };
}

export async function saveBillOverrides(db: Db, o: BillOverrides) {
  const value = JSON.stringify(o);
  await db.insert(settings).values({ key: OVERRIDES_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** After each read of Actual: tell Tiago about a price change or a bill that didn't come, once each. */
export async function runBillAlerts(db: Db, now = new Date()) {
  if (!moneyEnabled() || !tiagoChat() || !daytime(now)) return;
  const snap = await moneySnapshot('family').catch(() => null);
  if (!snap) return;
  const bills = billsFor(snap, dateKey(now).slice(0, 7), now, await billOverrides(db));
  for (const a of billAlerts(bills, now)) await once(db, a.key, () => sendTelegram(a.text, tiagoChat()));
}
