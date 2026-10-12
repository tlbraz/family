// Bills: how a payee is recognised, shared by the server (spotting bills) and the app (a transaction's bill).

// Words banks and card terminals add around the name ("DD VODAFONE PORTUGAL SA", "COMPRA 1234 NETFLIX.COM").
const FILLER = new Set(['dd', 'pag', 'pagamento', 'pagamentos', 'compra', 'compras', 'debito', 'direto', 'trf', 'transf', 'transferencia', 'mb', 'way', 'mbway',
  'sepa', 'cartao', 'serv', 'servicos', 'de', 'da', 'do', 'das', 'dos', 'e', 'lda', 'sa', 'pt', 'portugal', 'com', 'www', 'the', 'eu', 'europe', 'ltd', 'inc']);

/** "DD VODAFONE PORTUGAL SA 2034" and "Vodafone" → "vodafone": the first two words that are the name. */
export function payeeKey(payee: string): string {
  return payee
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1 && !FILLER.has(w))
    .slice(0, 2)
    .join(' ');
}

/** A group of the Bills sheet: the bills whose category is in one of Actual's category groups. Cents. */
export interface BillGroup<B> {
  id: string; // Actual's group id, or 'uncategorised' (as in the rest of the Money tab, so it gets the same colour)
  name: string;
  total: number; // the month's amount of its bills (paid, or expected)
  paid: number; // how much of it is paid
  bills: B[]; // in the order given
}

/** The month's bills by category group, the biggest total first; the ones without a category last. */
export function groupBills<B extends { amount: number; status: string; group: { id: string; name: string } | null }>(bills: B[], uncategorised = 'Sem categoria'): BillGroup<B>[] {
  const by = new Map<string, BillGroup<B>>();
  for (const b of bills) {
    const id = b.group?.id ?? 'uncategorised';
    const g = by.get(id) ?? { id, name: b.group?.name ?? uncategorised, total: 0, paid: 0, bills: [] };
    g.total += b.amount;
    if (b.status === 'paid') g.paid += b.amount;
    g.bills.push(b);
    by.set(id, g);
  }
  return [...by.values()].sort((a, b) => (a.id === 'uncategorised' ? 1 : b.id === 'uncategorised' ? -1 : b.total - a.total));
}
