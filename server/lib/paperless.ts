import type { PaperlessDoc, PaperlessInbox } from '../../shared/types';

// Paperless-ngx: the documents still in the inbox (tagged "inbox"), for the company's Money tab. Read only.
//   PAPERLESS_URL         where the server reaches Paperless (e.g. http://paperless.lan:8000)
//   PAPERLESS_TOKEN       an API token (Paperless → your profile → API Auth Token)
//   PAPERLESS_PUBLIC_URL  the address to open documents in the browser (default PAPERLESS_URL)
//   PAPERLESS_INBOX_TAG   the tag that marks "to review" (default "inbox")

type Fetch = typeof fetch;
export const paperlessEnabled = () => !!(process.env.PAPERLESS_URL && process.env.PAPERLESS_TOKEN);
const base = () => process.env.PAPERLESS_URL!.replace(/\/+$/, '');
const publicBase = () => (process.env.PAPERLESS_PUBLIC_URL || process.env.PAPERLESS_URL!).replace(/\/+$/, '');

/** A request to Paperless's API, with the token. */
export async function paperlessFetch(path: string, get: Fetch = fetch) {
  const res = await get(`${base()}${path}`, { headers: { Authorization: `Token ${process.env.PAPERLESS_TOKEN}`, Accept: 'application/json; version=5' } });
  if (!res.ok) throw new Error(`Paperless answered ${res.status}${res.status === 401 || res.status === 403 ? ' (check PAPERLESS_TOKEN)' : ''}`);
  return res;
}
const json = async <T>(path: string, get: Fetch) => (await (await paperlessFetch(path, get)).json()) as T;

interface Page<T> { count: number; results: T[] }
interface Named { id: number; name: string }
interface Field extends Named { data_type: string; extra_data?: { select_options?: (string | { id: string; label: string })[]; default_currency?: string } }
interface Doc {
  id: number; title: string; correspondent: number | null; document_type: number | null; tags: number[];
  created: string; added: string; page_count?: number | null; archive_serial_number?: number | null;
  original_file_name?: string; custom_fields?: { field: number; value: unknown }[]; notes?: { note: string }[];
}

/** A custom field's value as text: "€12.50", "yes", a date, the picked option… */
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

// Names of tags, correspondents, types and fields change rarely: keep them for 10 minutes.
let names: { at: number; tags: Named[]; correspondents: Named[]; types: Named[]; fields: Field[] } | null = null;
async function lookups(get: Fetch) {
  if (names && Date.now() - names.at < 10 * 60_000) return names;
  const all = <T>(what: string) => json<Page<T>>(`/api/${what}/?page_size=1000`, get).then((p) => p.results);
  const [tags, correspondents, types, fields] = await Promise.all([all<Named>('tags'), all<Named>('correspondents'), all<Named>('document_types'), all<Field>('custom_fields').catch(() => [])]);
  names = { at: Date.now(), tags, correspondents, types, fields };
  return names;
}

export async function paperlessInbox(get: Fetch = fetch): Promise<PaperlessInbox> {
  const { tags, correspondents, types, fields } = await lookups(get);
  const tagName = (process.env.PAPERLESS_INBOX_TAG || 'inbox').toLowerCase();
  const inbox = tags.find((t) => t.name.toLowerCase() === tagName);
  if (!inbox) throw new Error(`Paperless has no tag called "${tagName}"`);
  const page = await json<Page<Doc>>(`/api/documents/?tags__id__all=${inbox.id}&ordering=-added&page_size=50&truncate_content=true`, get);
  const nameOf = (list: Named[], id: number | null) => (id === null ? null : list.find((x) => x.id === id)?.name ?? null);
  const documents: PaperlessDoc[] = page.results.map((d) => ({
    id: d.id,
    title: d.title || d.original_file_name || `Document ${d.id}`,
    correspondent: nameOf(correspondents, d.correspondent),
    type: nameOf(types, d.document_type),
    tags: d.tags.filter((t) => t !== inbox.id).map((t) => nameOf(tags, t)).filter((t): t is string => !!t),
    created: d.created.slice(0, 10),
    added: d.added,
    pages: d.page_count ?? null,
    asn: d.archive_serial_number ?? null,
    fields: (d.custom_fields ?? [])
      .map((f) => {
        const field = fields.find((x) => x.id === f.field);
        const value = fieldText(field, f.value);
        return field && value !== null ? { name: field.name, value } : null;
      })
      .filter((f): f is { name: string; value: string } => !!f),
    note: d.notes?.at(-1)?.note ?? null,
    url: `${publicBase()}/documents/${d.id}/details`,
  }));
  return { count: page.count, documents, url: `${publicBase()}/documents?tags__id__all=${inbox.id}&sort=added&reverse=1` };
}
