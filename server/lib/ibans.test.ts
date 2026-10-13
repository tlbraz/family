import { describe, expect, it } from 'vitest';
import { cleanIban, formatIban } from './ibans';

describe('cleanIban', () => {
  it('accepts a valid IBAN however it was typed', () => {
    expect(cleanIban('PT50 0002 0123 1234 5678 9015 4')).toBe('PT50000201231234567890154');
    expect(cleanIban('pt50000201231234567890154')).toBe('PT50000201231234567890154');
    expect(cleanIban('NL91 ABNA 0417 1643 00')).toBe('NL91ABNA0417164300');
  });
  it('refuses a typo or something that is not an IBAN', () => {
    expect(cleanIban('PT50 0002 0123 1234 5678 9015 5')).toBeNull();
    expect(cleanIban('hello')).toBeNull();
  });
  it('formats in groups of four', () => {
    expect(formatIban('PT50000201231234567890154')).toBe('PT50 0002 0123 1234 5678 9015 4');
  });
});
