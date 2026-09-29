import { describe, expect, it } from 'vitest';
import { ethValue, weiToEth } from './valuations';

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
