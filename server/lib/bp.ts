import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { BP_TAGS, parseBp, type BpInput, type BpLog, type BpReading } from '../../shared/bp';
import type { Db } from '../db';
import { bpReadings, bpSettings } from '../schema';

export const toReading = (r: typeof bpReadings.$inferSelect): BpReading => ({
  id: r.id,
  at: r.at.toISOString(),
  systolic: r.systolic,
  diastolic: r.diastolic,
  tags: r.tags,
  note: r.note,
});

export async function bpSettingsOf(db: Db, memberId: number) {
  const [row] = await db.select().from(bpSettings).where(eq(bpSettings.memberId, memberId));
  return row ?? null;
}

/** Readings between two instants, oldest first. */
export async function readingsBetween(db: Db, memberId: number, from: Date, to: Date): Promise<BpReading[]> {
  const rows = await db
    .select()
    .from(bpReadings)
    .where(and(eq(bpReadings.memberId, memberId), gte(bpReadings.at, from), lt(bpReadings.at, to)))
    .orderBy(bpReadings.at);
  return rows.map(toReading);
}

/** Tags to offer: the ones used most first, then the built-in ones never used. */
export function tagsByUse(readings: BpReading[]): string[] {
  const count = new Map<string, number>();
  for (const r of readings) for (const t of r.tags) count.set(t, (count.get(t) ?? 0) + 1);
  const used = [...count].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return [...used, ...BP_TAGS.filter((t) => !count.has(t))];
}

export async function bpLog(db: Db, memberId: number, limit = 60): Promise<BpLog> {
  const settings = await bpSettingsOf(db, memberId);
  const rows = await db.select().from(bpReadings).where(eq(bpReadings.memberId, memberId)).orderBy(desc(bpReadings.at)).limit(500);
  const readings = rows.map(toReading);
  return { tracking: !!settings, telegramId: settings?.telegramId ?? null, readings: readings.slice(0, limit), tags: tagsByUse(readings) };
}

export async function addReading(db: Db, memberId: number, input: BpInput, source: 'app' | 'telegram' = 'app') {
  const [row] = await db
    .insert(bpReadings)
    .values({ memberId, at: new Date(input.at), systolic: input.systolic, diastolic: input.diastolic, tags: input.tags, note: input.note, source })
    .returning();
  return toReading(row!);
}

const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * A private message to the bot from someone who linked their Telegram to their blood pressure log:
 * "128/82 after training" saves a reading, "undo" removes the last one. Null = not for us (stay quiet).
 */
export async function bpFromTelegram(db: Db, m: { chatId: string; text: string; at: Date }): Promise<string | null> {
  const [who] = await db.select().from(bpSettings).where(eq(bpSettings.telegramId, m.chatId));
  if (!who) return null;
  const text = m.text.trim();
  if (text.startsWith('/')) return text === '/start' ? null : HELP;

  if (/^(undo|desfazer|apagar)$/i.test(text)) {
    const [last] = await db.select().from(bpReadings).where(eq(bpReadings.memberId, who.memberId)).orderBy(desc(bpReadings.createdAt)).limit(1);
    if (!last || Date.now() - last.createdAt.getTime() > 60 * 60_000) return 'Nothing to undo (only the last hour’s reading can be undone here).';
    await db.delete(bpReadings).where(eq(bpReadings.id, last.id));
    return `Removed ${last.systolic}/${last.diastolic} from ${hhmm(last.at)}.`;
  }

  const { tags: known } = await bpLog(db, who.memberId, 0);
  const parsed = parseBp(text, known);
  if (!parsed) return HELP;
  const r = await addReading(db, who.memberId, { at: m.at.toISOString(), ...parsed }, 'telegram');
  const extra = [...r.tags, ...(r.note ? [`“${r.note}”`] : [])].join(' · ');
  return `✓ ${r.systolic}/${r.diastolic} at ${hhmm(m.at)}${extra ? ` · ${extra}` : ''}\nSend <i>undo</i> to remove it.`;
}

const HELP = 'Send a reading like <b>128/82</b>, optionally with tags: <b>128/82 after training, forgot meds</b>. Send <i>undo</i> to remove the last one.';
