import { describe, expect, it } from 'vitest';
import { parseBp } from '../../shared/bp';

describe('parseBp', () => {
  it('reads the numbers in the usual ways', () => {
    for (const s of ['128/82', '128 82', '128-82', ' 128 / 82 ']) expect(parseBp(s)).toEqual({ systolic: 128, diastolic: 82, tags: [], note: null });
  });

  it('picks out tags, aliases included, and keeps the rest as a note', () => {
    expect(parseBp('141/91 forgot meds, after training')).toMatchObject({ tags: ['Forgot meds', 'After training'], note: null });
    expect(parseBp('130/85 gym and coffee')).toMatchObject({ tags: ['After training', 'Coffee'], note: null });
    expect(parseBp('125/80 dormi mal, headache')).toMatchObject({ tags: ['Bad sleep'], note: 'headache' });
    expect(parseBp('125/80 Late dinner', ['Late dinner'])).toMatchObject({ tags: ['Late dinner'], note: null });
  });

  it('does not match a tag inside another word', () => {
    expect(parseBp('120/80 running late')).toMatchObject({ tags: [], note: 'running late' });
  });

  it('rejects anything that is not a plausible reading', () => {
    for (const s of ['hello', '82/128', '300/90', '120', 'pay 10/12 euros']) expect(parseBp(s)).toBeNull();
  });
});

import { average, bpReport } from './bp-report';

describe('doctor report', () => {
  const r = (id: number, at: string, systolic: number, diastolic: number, tags: string[] = []) => ({ id, at: new Date(at).toISOString(), systolic, diastolic, tags, note: null });
  const readings = [
    r(1, '2026-09-01T07:30', 130, 82),
    r(2, '2026-09-01T21:30', 124, 80),
    r(3, '2026-09-02T07:30', 146, 94, ['Forgot meds']),
    r(4, '2026-09-02T07:32', 142, 92, ['Forgot meds']),
  ];

  it('averages', () => {
    expect(average(readings)).toEqual({ systolic: 136, diastolic: 87, n: 4 });
    expect(average([])).toBeNull();
  });

  it('shows the averages, the high count and how a tag compares', () => {
    const html = bpReport({ name: 'Tiago', from: '2026-09-01', to: '2026-09-07', readings, now: new Date(2026, 8, 7) });
    expect(html).toContain('1 – 7 September 2026');
    expect(html).toContain('136/87'); // overall
    expect(html).toContain('139/89'); // mornings
    expect(html).toContain('2<span class="unit">of 4</span>'); // at or above 135/85
    expect(html).toContain('+17 / +12'); // forgot meds (144/93) vs no tag (127/81)
  });

  it('escapes what people typed', () => {
    const html = bpReport({ name: '<b>x</b>', from: '2026-09-01', to: '2026-09-01', readings: [{ ...readings[0]!, note: '<script>' }], now: new Date() });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
  });

  it('says so when there is nothing in the period', () => {
    expect(bpReport({ name: 'Tiago', from: '2026-09-01', to: '2026-09-07', readings: [], now: new Date() })).toContain('No readings');
  });
});
