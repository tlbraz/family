import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../../shared/types';
import { dueReminders, reminderLabel, reminderText } from './reminders';

const occ = (start: Date, reminders: number[], allDay = false): Occurrence => ({
  key: 'e1',
  eventId: 'e1',
  kind: 'event',
  title: 'Swimming',
  type: 'sports',
  allDay,
  start: start.toISOString(),
  end: new Date(start.getTime() + 3_600_000).toISOString(),
  location: 'Piscina',
  participants: [4],
  bring: [{ text: 'Swimsuit', done: false }, { text: 'Towel', done: true }],
  reminders,
  repeats: false,
});

describe('dueReminders', () => {
  const start = new Date(2026, 9, 1, 16, 30);
  it('fires at the offset and for a short while after, not before', () => {
    const o = occ(start, [60]);
    expect(dueReminders([o], new Date(2026, 9, 1, 15, 29))).toHaveLength(0);
    expect(dueReminders([o], new Date(2026, 9, 1, 15, 30))).toHaveLength(1);
    expect(dueReminders([o], new Date(2026, 9, 1, 15, 45))).toHaveLength(1);
    expect(dueReminders([o], new Date(2026, 9, 1, 15, 55))).toHaveLength(0); // too late: skipped
  });

  it('handles "08:00 on the day" for all-day events', () => {
    const o = occ(new Date(2026, 9, 6), [-480], true);
    expect(dueReminders([o], new Date(2026, 9, 6, 8, 0))).toHaveLength(1);
    expect(dueReminders([o], new Date(2026, 9, 6, 7, 59))).toHaveLength(0);
  });
});

describe('reminder text', () => {
  it('reads naturally', () => {
    expect(reminderLabel(60, false)).toBe('In 1 hour');
    expect(reminderLabel(1440, false)).toBe('Tomorrow');
    expect(reminderLabel(360, true)).toBe('Tomorrow');
    expect(reminderLabel(-480, true)).toBe('Today');
    const text = reminderText({ key: 'k', occurrence: occ(new Date(2026, 9, 1, 16, 30), [60]), offset: 60 }, new Map([[4, 'Matilde']]));
    expect(text).toContain('In 1 hour');
    expect(text).toContain('Swimming — Matilde');
    expect(text).toContain('Bring: Swimsuit');
    expect(text).not.toContain('Towel');
  });
});
