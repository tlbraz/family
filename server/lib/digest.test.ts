import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';

const sent: string[] = [];
vi.mock('./telegram', () => ({
  telegramEnabled: () => true,
  sendTelegram: async (html: string) => (sent.push(html), true),
  esc: (s: string) => s,
}));
vi.mock('./calendar', () => ({
  listOccurrences: async (_db: Db, from: string) => [
    { kind: 'event', type: 'school', title: `Swimming ${from}`, start: `${from}T09:00:00`, end: `${from}T10:00:00`, allDay: false, participants: [], bring: [] },
  ],
}));
const { runDigests } = await import('./digest');

// Enough of drizzle for the digest: selects return nothing (no members, nothing sent yet), inserts are remembered.
function fakeDb() {
  const marks: string[] = [];
  const chain = { from: () => chain, where: async () => [], then: (r: (v: unknown[]) => void) => r([]) };
  const db = {
    select: () => chain,
    insert: () => ({ values: (v: { key: string }) => ({ onConflictDoNothing: async () => void marks.push(v.key) }) }),
  } as unknown as Db;
  return { db, marks };
}

describe('morning message', () => {
  beforeEach(() => void (sent.length = 0));

  it('sends what is on today at 07:30', async () => {
    const { db, marks } = fakeDb();
    await runDigests(db, new Date(2026, 8, 28, 7, 30));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Today');
    expect(sent[0]).toContain('Swimming 2026-09-28');
    expect(marks).toEqual(['digest:today:2026-09-28']);
  });

  it('waits until 07:30 and skips it after a late restart', async () => {
    const { db } = fakeDb();
    await runDigests(db, new Date(2026, 8, 28, 7, 29));
    await runDigests(db, new Date(2026, 8, 28, 15, 0));
    expect(sent).toHaveLength(0);
  });
});
