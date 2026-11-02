import { describe, expect, it } from 'vitest';
import { cleanNotes } from './monthNotes';

describe('month notes', () => {
  it('keeps a title, an emoji (📌 if none), optional details and a rough amount in cents', () => {
    expect(cleanNotes([{ id: 'a', emoji: '🦶', title: ' Foot fracture ', text: 'doctor, boot', amount: 45000 }, { title: 'Party', text: '  ', amount: null }])).toEqual([
      { id: 'a', emoji: '🦶', title: 'Foot fracture', text: 'doctor, boot', amount: 45000 },
      { id: expect.any(String), emoji: '📌', title: 'Party', text: null, amount: null },
    ]);
  });
  it('says what is wrong', () => {
    expect(() => cleanNotes([{ title: '' }])).toThrow('title');
    expect(() => cleanNotes([{ title: 'x', amount: -5 }])).toThrow('amount');
    expect(() => cleanNotes(Array.from({ length: 11 }, () => ({ title: 'x' })))).toThrow('10');
  });
});
