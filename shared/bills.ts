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
