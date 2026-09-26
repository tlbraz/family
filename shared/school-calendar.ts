// Portuguese public school calendar (pre-school and 1st cycle), Despacho n.º 8368/2024.
// Individual schools may differ by a day or two; `end` is the last day off (inclusive).
export const SCHOOL_BREAKS: { start: string; end: string; name: string }[] = [
  { start: '2026-12-16', end: '2027-01-03', name: 'Christmas break' },
  { start: '2027-02-08', end: '2027-02-10', name: 'Carnival break' },
  { start: '2027-03-22', end: '2027-04-04', name: 'Easter break' },
  { start: '2027-07-01', end: '2027-09-10', name: 'Summer holidays' },
];

export const SCHOOL_DAYS: { date: string; name: string }[] = [
  { date: '2026-12-15', name: 'Last day of term 1' },
  { date: '2027-01-04', name: 'Back to school' },
  { date: '2027-03-19', name: 'Last day of term 2' },
  { date: '2027-04-05', name: 'Back to school' },
  { date: '2027-06-30', name: 'Last day of school (1st cycle)' },
];
