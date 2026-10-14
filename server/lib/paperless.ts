import type { DocsMeta, DocsPage, PaperlessDetail, PaperlessDoc } from '../../shared/types';

// Paperless-ngx behind the Docs tab. Reading, plus changing tags (and, for company expenses, the date and amount).
//   PAPERLESS_URL         where the server reaches Paperless (e.g. http://paperless.lan:8000)
//   PAPERLESS_TOKEN       an API token (Paperless → your profile → API Auth Token)
//   PAPERLESS_PUBLIC_URL  the address to open documents in the browser (default PAPERLESS_URL)
//   PAPERLESS_INBOX_TAG   the tag that marks "to review" (default "inbox")
// The token stays here: files and thumbnails reach the phone through the app.

type Fetch = typeof fetch;
export const paperlessEnabled = () => !!(process.env.PAPERLESS_URL && process.env.PAPERLESS_TOKEN);
const base = () => process.env.PAPERLESS_URL!.replace(/\/+$/, '');
const publicBase = () => (process.env.PAPERLESS_PUBLIC_URL || process.env.PAPERLESS_URL!).replace(/\/+$/, '');

// Names from our Paperless setup (the QR reader uses the same ones). A company expense is anything under the Expense
// tag; when its QR code can't be read there's no Amount, or only a placeholder date tagged "Date missing".
const EXPENSE_TAG = 'Expense';
const DATE_MISSING_TAG = 'Date missing';
const AMOUNT_FIELD = 'Amount';
const PERIOD_FIELD = 'Period'; // YYYY-MM, follows the date

export class PaperlessError extends Error {}

/** A request to Paperless's API, with the token. */
export async function paperlessFetch(path: string, get: Fetch = fetch, init: RequestInit = {}) {
  const res = await get(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Token ${process.env.PAPERLESS_TOKEN}`, Accept: 'application/json; version=9', ...init.headers },
  }).catch((e: Error & { cause?: { code?: string; message?: string } }) => {
    // "fetch failed" says nothing: name the address and the reason (refused, unknown host, timed out…).
    throw new PaperlessError(`Can't reach Paperless at ${base()} (${e.cause?.code ?? e.cause?.message ?? e.message}). Check PAPERLESS_URL: it must be reachable from the app's server.`);
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403 ? ' (check PAPERLESS_TOKEN and its permissions)' : '';
    throw new PaperlessError(`Paperless answered ${res.status}${hint}${detail && res.status === 400 ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return res;
}
const json = async <T>(path: string, get: Fetch, init?: RequestInit) => (await (await paperlessFetch(path, get, init)).json()) as T;

interface Page<T> { count: number; next: string | null; results: T[] }
interface Named { id: number; name: string; color?: string; parent?: number | null }
interface Field extends Named { data_type: string; extra_data?: { select_options?: (string | { id: string; label: string })[]; default_currency?: string } }
interface Doc {
  id: number; title: string; correspondent: number | null; document_type: number | null; tags: number[];
  created: string; added: string; page_count?: number | null; archive_serial_number?: number | null;
  original_file_name?: string; mime_type?: string; content?: string;
  custom_fields?: { field: number; value: unknown }[]; notes?: { note: string; created: string; user?: { username?: string } | number }[];
  __search_hit__?: { highlights?: string; note_highlights?: string };
}

/** A custom field's value as text: "€12,50", "yes", a date, the picked option… */
export function fieldText(field: Field | undefined, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (field?.data_type) {
    case 'monetary': {
      const m = String(value).match(/^([A-Z]{3})?(-?[\d.]+)$/);
      if (!m) return String(value);
      const currency = m[1] || field.extra_data?.default_currency || 'EUR';
      const amount = Number(m[2]).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return currency === 'EUR' ? `€${amount}` : `${amount} ${currency}`;
    }
    case 'boolean':
      return value ? 'yes' : 'no';
    case 'select': {
      const options = field.extra_data?.select_options ?? [];
      const hit = options.find((o, i) => (typeof o === 'string' ? i === value : o.id === value));
      return hit === undefined ? String(value) : typeof hit === 'string' ? hit : hit.label;
    }
    case 'documentlink':
      return Array.isArray(value) && value.length ? `${value.length} linked` : null;
    default:
      return String(value);
  }
}

/** Paperless's search highlights ("…<span class="match">word</span>…") as plain pieces, so nothing is injected. */
export function highlightParts(html: string | undefined): { text: string; hit: boolean }[] | null {
  if (!html) return null;
  const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const parts: { text: string; hit: boolean }[] = [];
  const re = /<span class="match">(.*?)<\/span>/gs;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) parts.push({ text: decode(html.slice(last, m.index)), hit: false });
    parts.push({ text: decode(m[1]!), hit: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ text: decode(html.slice(last)), hit: false });
  const clean = parts.filter((p) => p.text);
  return clean.length ? clean : null;
}

// Names of tags, correspondents, types and fields change rarely: keep them for a few minutes.
type Lookups = { at: number; tags: Named[]; correspondents: Named[]; types: Named[]; fields: Field[] };
let names: Lookups | null = null;
export const forgetLookups = () => void (names = null);
async function lookups(get: Fetch): Promise<Lookups> {
  if (names && Date.now() - names.at < 5 * 60_000) return names;
  const all = <T>(what: string) => json<Page<T>>(`/api/${what}/?page_size=1000`, get).then((p) => p.results);
  const [tags, correspondents, types, fields] = await Promise.all([all<Named>('tags'), all<Named>('correspondents'), all<Named>('document_types'), all<Field>('custom_fields').catch(() => [])]);
  names = { at: Date.now(), tags, correspondents, types, fields };
  return names;
}
const inboxTagOf = (n: Lookups) => {
  const name = (process.env.PAPERLESS_INBOX_TAG || 'inbox').toLowerCase();
  return n.tags.find((t) => t.name.toLowerCase() === name) ?? null;
};
const named = <T extends Named>(list: T[], name: string) => list.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? null;
const sortByName = (list: Named[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt'));

function toDoc(d: Doc, n: Lookups, inboxId: number | null): PaperlessDoc {
  const nameOf = (list: Named[], id: number | null) => (id === null ? null : list.find((x) => x.id === id)?.name ?? null);
  return {
    id: d.id,
    title: d.title || d.original_file_name || `Document ${d.id}`,
    correspondent: nameOf(n.correspondents, d.correspondent),
    correspondentId: d.correspondent,
    type: nameOf(n.types, d.document_type),
    typeId: d.document_type,
    tags: d.tags.filter((t) => t !== inboxId).map((t) => nameOf(n.tags, t)).filter((t): t is string => !!t),
    tagIds: d.tags,
    inbox: inboxId !== null && d.tags.includes(inboxId),
    created: d.created.slice(0, 10),
    added: d.added,
    pages: d.page_count ?? null,
    asn: d.archive_serial_number ?? null,
    fields: (d.custom_fields ?? [])
      .map((f) => {
        const field = n.fields.find((x) => x.id === f.field);
        const value = fieldText(field, f.value);
        return field && value !== null ? { name: field.name, value } : null;
      })
      .filter((f): f is { name: string; value: string } => !!f),
    note: d.notes?.at(-1)?.note ?? null,
    url: `${publicBase()}/documents/${d.id}/details`,
    snippet: highlightParts(d.__search_hit__?.highlights) ?? highlightParts(d.__search_hit__?.note_highlights),
  };
}

/** The lists to filter and edit with: tags, correspondents and types. */
export async function docsMeta(get: Fetch = fetch): Promise<DocsMeta> {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  return {
    tags: sortByName(n.tags).map(({ id, name, parent }) => ({ id, name, parent: parent ?? null })),
    correspondents: sortByName(n.correspondents).map(({ id, name }) => ({ id, name })),
    types: sortByName(n.types).map(({ id, name }) => ({ id, name })),
    inboxTag: inbox?.id ?? null,
    expenseTag: named(n.tags, EXPENSE_TAG)?.id ?? null,
    url: publicBase(),
  };
}

export interface DocsQuery { query?: string; inbox?: boolean; tag?: number; correspondent?: number; type?: number; page?: number }

/** One page of documents: full-text search (best match first) or the newest first, with optional filters. */
export async function searchDocs(q: DocsQuery, get: Fetch = fetch): Promise<DocsPage> {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  const p = new URLSearchParams({ page_size: '25', page: String(Math.max(1, q.page ?? 1)), truncate_content: 'true' });
  const tags = [q.inbox && inbox ? inbox.id : null, q.tag ?? null].filter((t): t is number => t !== null);
  if (q.inbox && !inbox) throw new PaperlessError(`Paperless has no tag called "${process.env.PAPERLESS_INBOX_TAG || 'inbox'}"`);
  if (tags.length) p.set('tags__id__all', tags.join(','));
  if (q.correspondent) p.set('correspondent__id', String(q.correspondent));
  if (q.type) p.set('document_type__id', String(q.type));
  if (q.query?.trim()) p.set('query', q.query.trim().slice(0, 200));
  else p.set('ordering', '-added');
  const page = await json<Page<Doc>>(`/api/documents/?${p}`, get);
  return { count: page.count, next: !!page.next, documents: page.results.map((d) => toDoc(d, n, inbox?.id ?? null)) };
}

/** Everything about one document, with Paperless's suggestions for filing it. */
export async function docDetail(id: number, get: Fetch = fetch): Promise<PaperlessDetail> {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  const [d, s] = await Promise.all([
    json<Doc>(`/api/documents/${id}/`, get),
    json<{ correspondents?: number[]; tags?: number[]; document_types?: number[]; dates?: string[] }>(`/api/documents/${id}/suggestions/`, get).catch(() => ({}) as Record<string, undefined>),
  ]);
  const amount = d.custom_fields?.find((f) => f.field === named(n.fields, AMOUNT_FIELD)?.id)?.value;
  const euros = typeof amount === 'string' ? amount.match(/^(?:[A-Z]{3})?(-?[\d.]+)$/) : null;
  const pick = (list: Named[], ids: number[] | undefined) => (ids ?? []).map((i) => list.find((x) => x.id === i)).filter((x): x is Named => !!x).map(({ id, name }) => ({ id, name }));
  return {
    ...toDoc(d, n, inbox?.id ?? null),
    content: (d.content ?? '').trim().slice(0, 3000),
    mime: d.mime_type ?? null,
    filename: d.original_file_name ?? null,
    notes: (d.notes ?? []).map((x) => ({ note: x.note, created: x.created })),
    amount: euros ? Number(euros[1]) : null,
    dateMissing: d.tags.includes(named(n.tags, DATE_MISSING_TAG)?.id ?? -1),
    suggestions: {
      correspondents: pick(n.correspondents, s.correspondents),
      types: pick(n.types, s.document_types),
      tags: pick(n.tags, s.tags).filter((t) => t.id !== inbox?.id),
      dates: (s.dates ?? []).slice(0, 4),
    },
  };
}

export interface DocChange { tags?: number[]; approve?: boolean; created?: string; amount?: number }

/**
 * Changes a document's tags; "approve" takes the inbox tag off. For a receipt whose QR code couldn't be read, the date
 * (Period follows it, "Date missing" comes off) and the Amount can be put in by hand. Nothing else is changed.
 */
export async function updateDoc(id: number, change: DocChange, get: Fetch = fetch) {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  const dated = change.created !== undefined;
  const amountField = named(n.fields, AMOUNT_FIELD);
  const periodField = named(n.fields, PERIOD_FIELD);
  if (change.amount !== undefined && !amountField) throw new PaperlessError(`Paperless has no custom field called "${AMOUNT_FIELD}"`);
  const doc = change.approve || dated || change.amount !== undefined ? await json<Doc>(`/api/documents/${id}/`, get) : null;
  let tags = change.tags ?? (change.approve || dated ? doc!.tags : undefined);
  if (change.approve) tags = tags!.filter((t) => t !== inbox?.id);
  if (dated) tags = tags!.filter((t) => t !== named(n.tags, DATE_MISSING_TAG)?.id);

  const patch: { tags?: number[]; created?: string; custom_fields?: { field: number; value: unknown }[] } = {};
  if (tags !== undefined) patch.tags = [...new Set(tags)];
  if (dated) patch.created = change.created;
  // Paperless replaces the whole list of custom fields: send the others back as they are.
  const values = new Map((doc?.custom_fields ?? []).map((f) => [f.field, f.value]));
  if (change.amount !== undefined) values.set(amountField!.id, `${amountField!.extra_data?.default_currency || 'EUR'}${change.amount.toFixed(2)}`);
  if (dated && periodField) values.set(periodField.id, change.created!.slice(0, 7));
  if (change.amount !== undefined || (dated && periodField)) patch.custom_fields = [...values].map(([field, value]) => ({ field, value }));
  if (!Object.keys(patch).length) return;
  await paperlessFetch(`/api/documents/${id}/`, get, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
}

export class NotInInbox extends Error {}

/**
 * Rejects a document still in the inbox: deletes it in Paperless, which keeps it in its trash for a while (30 days
 * by default) in case it was a mistake. Anything already approved is refused.
 */
export async function rejectDoc(id: number, get: Fetch = fetch) {
  const inbox = inboxTagOf(await lookups(get));
  const doc = await json<Doc>(`/api/documents/${id}/`, get);
  if (!inbox || !doc.tags.includes(inbox.id)) throw new NotInInbox('Only documents still in the inbox can be rejected here');
  await paperlessFetch(`/api/documents/${id}/`, get, { method: 'DELETE' });
}
