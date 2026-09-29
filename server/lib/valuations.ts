import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';
import { moneyEnabled, setAccountValue } from './money';
import { dateKey } from './time';

// Keeps off-budget investment accounts in Actual at today's value, once a day, with one balance adjustment.
// Ethereum: the ETH on a public address (ETH_ADDRESS) × the euro price. Only the address is needed, never a key.
//   ETH_ACCOUNT  the account in Actual (default "Ethereum")
//   ETH_RPC_URL  a public Ethereum node (default publicnode.com)
// Only ETH itself on Ethereum mainnet is counted (not tokens, and not other chains).

type Fetch = typeof fetch;

/** Wei (hex from the node) to ETH, without losing precision on big numbers. */
export function weiToEth(hex: string): number {
  const wei = BigInt(hex);
  return Number(wei / 10n ** 12n) / 1e6; // to micro-ETH first, then a float
}

export async function ethValue(address: string, get: Fetch = fetch) {
  const rpc = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const bal = await get(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  });
  const { result } = (await bal.json()) as { result?: string };
  if (!bal.ok || !result) throw new Error(`Ethereum node answered ${bal.status}`);
  const price = await get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
  const eur = ((await price.json()) as { ethereum?: { eur?: number } }).ethereum?.eur;
  if (!price.ok || !eur) throw new Error(`Price service answered ${price.status}`);
  const eth = weiToEth(result);
  return { eth, eur, cents: Math.round(eth * eur * 100) };
}

/** Once a day, from 08:00. Failures are logged and tried again on the next round (every 20 minutes). */
export async function runValuations(db: Db, now = new Date(), get: Fetch = fetch) {
  const address = process.env.ETH_ADDRESS;
  if (!moneyEnabled() || !address || now.getHours() < 8) return;
  const key = `valuation:eth:${dateKey(now)}`;
  const [done] = await db.select().from(settings).where(eq(settings.key, key));
  if (done) return;
  const { eth, eur, cents } = await ethValue(address, get);
  const note = `${eth.toFixed(4)} ETH × €${eur.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  await setAccountValue('family', process.env.ETH_ACCOUNT || 'Ethereum', cents, note);
  await db.insert(settings).values({ key, value: note }).onConflictDoNothing();
}
