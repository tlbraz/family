import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';
import { moneyEnabled, setAccountValue } from './money';
import { dateKey } from './time';

// Keeps off-budget investment accounts in Actual at today's value, once a day, with one balance adjustment.
//
// Ethereum: the ETH on a public address (ETH_ADDRESS) × the euro price. Only the address is needed, never a key.
//   ETH_ACCOUNT  the account in Actual (default "Ethereum");  ETH_RPC_URL  a public Ethereum node.
//   Only ETH itself on Ethereum mainnet is counted (not tokens, and not other chains).
//
// Funds, ETFs and shares (PPR, Degiro…): HOLDINGS lists, per Actual account, what's held and how many units:
//   HOLDINGS="PPR Tiago (Optimize)=PTOPZAHM0003:27.2941,PTOPZDHM0000:414.4142; DEGIRO=VWCE.DE:120,cash:250"
//   Each item is an ISIN or a Yahoo Finance symbol with its units; "cash:250" adds a fixed amount in euros.
//   Prices come from Yahoo Finance (ISINs are looked up to a symbol first) and must be in euros.

type Fetch = typeof fetch;

// ---- Ethereum ------------------------------------------------------------------------------------

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

// ---- Funds and shares ----------------------------------------------------------------------------

export interface Holding {
  account: string;
  items: { id: string; units: number }[];
  cash: number; // euros
}

const num = (s: string) => Number(s.trim().replace(/\s/g, '').replace(',', '.'));

/** Reads HOLDINGS (see above). Portuguese decimal commas in the units are fine: "27,2941". */
export function parseHoldings(text = process.env.HOLDINGS ?? ''): Holding[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 1) throw new Error(`HOLDINGS: "${part}" should look like "Account=ISIN:units,…"`);
      const holding: Holding = { account: part.slice(0, eq).trim(), items: [], cash: 0 };
      for (const item of part.slice(eq + 1).split(/,(?=\s*[A-Za-z0-9.^-]+:)/)) {
        const [id, units] = item.split(':');
        if (!id?.trim() || units === undefined || Number.isNaN(num(units))) throw new Error(`HOLDINGS: can't read "${item.trim()}"`);
        if (id.trim().toLowerCase() === 'cash') holding.cash += num(units);
        else holding.items.push({ id: id.trim().toUpperCase(), units: num(units) });
      }
      return holding;
    });
}

const isIsin = (id: string) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id);
const YAHOO_HEADERS = { 'user-agent': 'Mozilla/5.0 (family app; daily portfolio value)' };

/** Today's price in euros for an ISIN or a Yahoo symbol. */
export async function priceOf(id: string, get: Fetch = fetch): Promise<{ symbol: string; eur: number }> {
  let symbol = id;
  if (isIsin(id)) {
    const res = await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${id}&quotesCount=5&newsCount=0`, { headers: YAHOO_HEADERS });
    const quotes = ((await res.json().catch(() => ({}))) as { quotes?: { symbol?: string }[] }).quotes ?? [];
    if (!res.ok || !quotes[0]?.symbol) throw new Error(`No price found for ${id} (Yahoo search answered ${res.status})`);
    symbol = quotes[0].symbol;
  }
  const res = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: YAHOO_HEADERS });
  type Chart = { chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string } }[] } };
  const meta = ((await res.json().catch(() => ({}))) as Chart).chart?.result?.[0]?.meta;
  if (!res.ok || !meta?.regularMarketPrice) throw new Error(`No price for ${id} (${symbol}): Yahoo answered ${res.status}`);
  if (meta.currency !== 'EUR') throw new Error(`${id} (${symbol}) is priced in ${meta.currency}, not euros: use its euro listing`);
  return { symbol, eur: meta.regularMarketPrice };
}

export async function holdingValue(h: Holding, get: Fetch = fetch) {
  const parts: string[] = [];
  let euros = h.cash;
  for (const item of h.items) {
    const { eur } = await priceOf(item.id, get);
    euros += item.units * eur;
    parts.push(`${item.units} × €${eur.toLocaleString('en-GB', { maximumFractionDigits: 4 })}`);
  }
  if (h.cash) parts.push(`cash €${h.cash}`);
  return { cents: Math.round(euros * 100), note: parts.join(' + ') };
}

// ---- Once a day ----------------------------------------------------------------------------------

async function daily(db: Db, now: Date, name: string, work: () => Promise<string>) {
  const key = `valuation:${name}:${dateKey(now)}`;
  const [done] = await db.select().from(settings).where(eq(settings.key, key));
  if (done) return;
  const note = await work();
  await db.insert(settings).values({ key, value: note }).onConflictDoNothing();
}

/** From 08:00, once a day per account. A failure is logged and tried again on the next round (20 minutes). */
export async function runValuations(db: Db, now = new Date(), get: Fetch = fetch) {
  if (!moneyEnabled() || now.getHours() < 8) return;
  const address = process.env.ETH_ADDRESS;
  if (address) {
    await daily(db, now, 'eth', async () => {
      const { eth, eur, cents } = await ethValue(address, get);
      const note = `${eth.toFixed(4)} ETH × €${eur.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
      await setAccountValue('family', process.env.ETH_ACCOUNT || 'Ethereum', cents, note);
      return note;
    }).catch((e: Error) => console.error('valuation (Ethereum):', e.message));
  }
  for (const h of parseHoldings()) {
    await daily(db, now, `holding:${h.account}`, async () => {
      const { cents, note } = await holdingValue(h, get);
      await setAccountValue('family', h.account, cents, note);
      return note;
    }).catch((e: Error) => console.error(`valuation (${h.account}):`, e.message));
  }
}
