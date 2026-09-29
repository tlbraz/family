import { describe, expect, it } from 'vitest';
import { newPayrollCredits, payrollMessage } from './payroll';

const tx = (id: string, date: string, amount: number, payee: string) =>
  ({ id, accountId: 'a', fixable: true, review: false, date, amount, account: 'Empresa', category: null, payee });

describe('payroll alert', () => {
  const all = [
    tx('1', '2026-09-14', 528000, 'EPI Operations B.V.'),
    tx('2', '2026-10-12', 912000, 'EPI Operations B.V.'),
    tx('3', '2026-10-12', -15000, 'EPI Operations B.V.'), // a debit: ignored
    tx('4', '2026-10-13', 25000, 'Caetano Gamobar'),
  ];
  it('finds only new credits from EPI', () => {
    expect(newPayrollCredits(all, ['1']).map((t) => t.id)).toEqual(['2']);
  });
  it('reads naturally', () => {
    expect(payrollMessage(all[1]!)).toBe('💶 <b>EPI Operations B.V.</b> paid <b>€9 120</b> into Empresa');
    expect(payrollMessage(tx('5', '2026-10-12', 528050, 'EPI Operations B.V.'))).toBe('💶 <b>EPI Operations B.V.</b> paid <b>€5 280.50</b> into Empresa');
  });
});
