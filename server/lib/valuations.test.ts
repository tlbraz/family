import { describe, expect, it } from 'vitest';
import { ethValue, holdingValue, parseHoldings, priceOf, weiToEth } from './valuations';

describe('ethereum value', () => {
  it('turns wei into ETH', () => {
    expect(weiToEth('0x0')).toBe(0);
    expect(weiToEth('0x' + (2931500000000000000n).toString(16))).toBeCloseTo(2.9315, 6);
  });

  it('multiplies the balance by the euro price', async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(init?.body ? JSON.parse(String(init.body)).method : url);
      const body = String(url).includes('coingecko') ? { ethereum: { eur: 2756.4 } } : { result: '0x' + (2931500000000000000n).toString(16) };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const v = await ethValue('0xabc', fake);
    expect(v.eth).toBeCloseTo(2.9315, 6);
    expect(v.cents).toBe(Math.round(2.9315 * 2756.4 * 100));
    expect(calls[0]).toBe('eth_getBalance');
  });

  it('fails clearly when a service is down', async () => {
    const down = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    await expect(ethValue('0xabc', down)).rejects.toThrow('Ethereum node answered 503');
  });
});


describe('holdings', () => {
  it('reads the setting, with decimal commas and cash', () => {
    expect(parseHoldings('PPR Tiago (Optimize)=PTOPZAHM0003:27,2941,PTOPZDHM0000:414,4142; DEGIRO=VWCE.DE:120, cash:250.50')).toEqual([
      { account: 'PPR Tiago (Optimize)', items: [{ id: 'PTOPZAHM0003', units: 27.2941 }, { id: 'PTOPZDHM0000', units: 414.4142 }], cash: 0 },
      { account: 'DEGIRO', items: [{ id: 'VWCE.DE', units: 120 }], cash: 250.5 },
    ]);
    expect(parseHoldings('')).toEqual([]);
    expect(() => parseHoldings('DEGIRO VWCE 120')).toThrow('should look like');
  });

  // A stand-in for Yahoo: ISIN search, then a chart with the last price.
  const yahoo = (prices: Record<string, [number, string]>) =>
    (async (url: string) => {
      const u = String(url);
      if (u.includes('/search')) {
        const isin = new URL(u).searchParams.get('q')!;
        return new Response(JSON.stringify({ quotes: [{ symbol: `${isin}.F` }] }));
      }
      const symbol = decodeURIComponent(u.split('/chart/')[1]!.split('?')[0]!);
      const p = prices[symbol];
      return p ? new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: p[0], currency: p[1] } }] } })) : new Response('{}', { status: 404 });
    }) as typeof fetch;

  it('finds an ISIN\'s price through its symbol, in euros only', async () => {
    const get = yahoo({ 'PTOPZAHM0003.F': [11.52, 'EUR'], 'VWCE.DE': [131.2, 'EUR'], AAPL: [230, 'USD'] });
    expect(await priceOf('PTOPZAHM0003', get)).toEqual({ symbol: 'PTOPZAHM0003.F', eur: 11.52 });
    expect(await priceOf('VWCE.DE', get)).toEqual({ symbol: 'VWCE.DE', eur: 131.2 });
    await expect(priceOf('AAPL', get)).rejects.toThrow('priced in USD');
    await expect(priceOf('XX0000000000', get)).rejects.toThrow('Yahoo answered 404');
  });

  it('adds up units × price, plus cash', async () => {
    const get = yahoo({ 'PTOPZAHM0003.F': [11.5, 'EUR'], 'PTOPZDHM0000.F': [14.25, 'EUR'] });
    const [h] = parseHoldings('PPR=PTOPZAHM0003:27.2941,PTOPZDHM0000:414.4142,cash:10');
    const v = await holdingValue(h!, get);
    expect(v.cents).toBe(Math.round((27.2941 * 11.5 + 414.4142 * 14.25 + 10) * 100));
    expect(v.note).toBe('27.2941 × €11.5 + 414.4142 × €14.25 + cash €10');
  });
});
