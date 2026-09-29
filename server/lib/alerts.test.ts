import { describe, expect, it } from 'vitest';
import { expiryMessage, expiryStage, staleBankLinks, staleMessage } from './alerts';

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
