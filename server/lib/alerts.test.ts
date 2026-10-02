import { describe, expect, it } from 'vitest';
import { expiryMessage, expiryStage, overdueOwed, owedMessage, staleBankLinks, staleMessage } from './alerts';

describe('document expiry', () => {
  const today = new Date(2026, 8, 29, 10); // 29 Sep 2026

  it('warns 90, 30 and 7 days ahead, and when it expires', () => {
    expect(expiryStage('2027-03-01', today)).toBeNull(); // 5 months away
    expect(expiryStage('2026-12-20', today)).toBe(90);
    expect(expiryStage('2026-10-29', today)).toBe(30);
    expect(expiryStage('2026-10-06', today)).toBe(7);
    expect(expiryStage('2026-09-29', today)).toBe(0);
    expect(expiryStage('2026-06-01', today)).toBe(0);
  });

  it('reads naturally', () => {
    expect(expiryMessage('Gonçalo', 'Cartão de Cidadão', '2026-10-29', today)).toBe("🪪 <b>Gonçalo's Cartão de Cidadão</b> expires in <b>30 days</b> (29 Oct 2026).");
    expect(expiryMessage('Tiago', 'Passaporte', '2026-09-29', today)).toBe("🪪 <b>Tiago's Passaporte</b> expires <b>today</b>.");
    expect(expiryMessage('Tiago', 'Passaporte', '2026-06-01', today)).toBe("🪪 <b>Tiago's Passaporte</b> expired on 1 Jun 2026.");
  });
});

describe('bank links', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const links = [
    { name: 'CGD', lastSync: '2026-09-29T07:00:00Z', status: 'ok' },
    { name: 'ABanca', lastSync: '2026-09-27T19:00:00Z', status: 'ok' }, // 41 h ago
    { name: 'Millennium', lastSync: '2026-09-29T07:00:00Z', status: 'failed' },
    { name: 'New', lastSync: null, status: null },
  ];

  it('flags accounts that stopped syncing or whose last sync failed', () => {
    expect(staleBankLinks(links, now).map((l) => l.name)).toEqual(['ABanca', 'Millennium', 'New']);
  });

  it('says what to do', () => {
    expect(staleMessage(links[1]!)).toContain('<b>ABanca</b> hasn\'t synced since Sunday 27 Sept');
    expect(staleMessage(links[1]!)).toContain('Bank Sync');
    expect(staleMessage(links[2]!)).toContain('(Actual says: failed)');
  });
});

describe('money to be reimbursed', () => {
  const t = (id: string, date: string, amount: number, payee: string, note: string | null = null) => ({ id, accountId: 'a', fixable: true, review: false, note, date, amount, account: 'CGD', category: 'emp', payee });

  it('nudges about what has waited a month or more', () => {
    const items = [t('1', '2026-08-01', -2000, 'TAXI'), t('2', '2026-08-20', -8550, 'RESTAURANTE', 'jantar cliente'), t('3', '2026-09-10', -1000, 'CTT'), t('4', '2026-09-12', 1500, 'EPI')];
    const due = overdueOwed(items, new Date(2026, 8, 19, 10));
    // €15 came back: most of the taxi (oldest first). CTT is too recent to nudge about.
    expect(due.map((d) => [d.id, d.left])).toEqual([['1', 500], ['2', 8550]]);
    expect(owedMessage(due[1]!)).toBe('🧾 Still not paid back: <b>€85.50</b> for RESTAURANTE (jantar cliente), paid on 20 Aug 2026.');
  });
});
