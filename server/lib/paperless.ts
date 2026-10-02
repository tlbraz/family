import type { DocsMeta, DocsPage, PaperlessDetail, PaperlessDoc, PaperlessInbox } from '../../shared/types';

// Paperless-ngx behind the Docs tab (and the inbox count on the company's Money tab).
//   PAPERLESS_URL         where the server reaches Paperless (e.g. http://paperless.lan:8000)
//   PAPERLESS_TOKEN       an API token (Paperless → your profile → API Auth Token)
//   PAPERLESS_PUBLIC_URL  the address to open documents in the browser (default PAPERLESS_URL)
//   PAPERLESS_INBOX_TAG   the tag that marks "to review" (default "inbox")
// The token stays here: files and thumbnails reach the phone through the app.

type Fetch = typeof fetch;
export const paperlessEnabled = () => !!(process.env.PAPERLESS_URL && process.env.PAPERLESS_TOKEN);
const base = () => process.env.PAPERLESS_URL!.replace(/\/+$/, '');
const publicBase = () => (process.env.PAPERLESS_PUBLIC_URL || process.env.PAPERLESS_URL!).replace(/\/+$/, '');

export class PaperlessError extends Error {}

/** A request to Paperless's API, with the token. */
export async function paperlessFetch(path: string, get: Fetch = fetch, init: RequestInit = {}) {
  const res = await get(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Token ${process.env.PAPERLESS_TOKEN}`, Accept: 'application/json; version=5', ...init.headers },
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
interface Named { id: number; name: string; color?: string }
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
    tags: sortByName(n.tags).map(({ id, name }) => ({ id, name })),
    correspondents: sortByName(n.correspondents).map(({ id, name }) => ({ id, name })),
    types: sortByName(n.types).map(({ id, name }) => ({ id, name })),
    inboxTag: inbox?.id ?? null,
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
  const pick = (list: Named[], ids: number[] | undefined) => (ids ?? []).map((i) => list.find((x) => x.id === i)).filter((x): x is Named => !!x).map(({ id, name }) => ({ id, name }));
  return {
    ...toDoc(d, n, inbox?.id ?? null),
    content: (d.content ?? '').trim().slice(0, 3000),
    mime: d.mime_type ?? null,
    filename: d.original_file_name ?? null,
    notes: (d.notes ?? []).map((x) => ({ note: x.note, created: x.created })),
    suggestions: {
      correspondents: pick(n.correspondents, s.correspondents),
      types: pick(n.types, s.document_types),
      tags: pick(n.tags, s.tags).filter((t) => t.id !== inbox?.id),
      dates: (s.dates ?? []).slice(0, 4),
    },
  };
}

export interface DocChange { title?: string; created?: string; correspondent?: number | null; type?: number | null; tags?: number[]; approve?: boolean }

/** Saves changes to a document; "approve" also takes the inbox tag off. */
export async function updateDoc(id: number, change: DocChange, get: Fetch = fetch) {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  const body: Record<string, unknown> = {};
  if (change.title !== undefined) body.title = change.title.trim().slice(0, 128);
  if (change.created !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.created)) throw new PaperlessError('The date should look like 2026-09-28');
    body.created = change.created;
  }
  if (change.correspondent !== undefined) body.correspondent = change.correspondent;
  if (change.type !== undefined) body.document_type = change.type;
  let tags = change.tags;
  if (change.approve) {
    tags ??= (await json<Doc>(`/api/documents/${id}/`, get)).tags;
    tags = tags.filter((t) => t !== inbox?.id);
  }
  if (tags !== undefined) body.tags = [...new Set(tags)];
  if (!Object.keys(body).length) return;
  await paperlessFetch(`/api/documents/${id}/`, get, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** Hands a file to Paperless, which reads it in the background; it then shows up in the inbox. */
export async function uploadDoc(file: Blob, filename: string, get: Fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append('document', file, filename);
  const res = await paperlessFetch('/api/documents/post_document/', get, { method: 'POST', body: form });
  return String(await res.text()).replace(/"/g, '');
}

/** The newest inbox documents and how many there are (for the company Money tab). */
export async function paperlessInbox(get: Fetch = fetch): Promise<PaperlessInbox> {
  const n = await lookups(get);
  const inbox = inboxTagOf(n);
  if (!inbox) throw new PaperlessError(`Paperless has no tag called "${process.env.PAPERLESS_INBOX_TAG || 'inbox'}"`);
  const page = await json<Page<Doc>>(`/api/documents/?tags__id__all=${inbox.id}&ordering=-added&page_size=50&truncate_content=true`, get);
  return { count: page.count, documents: page.results.map((d) => toDoc(d, n, inbox.id)), url: `${publicBase()}/documents?tags__id__all=${inbox.id}&sort=added&reverse=1` };
}
