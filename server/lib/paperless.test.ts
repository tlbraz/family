import { beforeEach, describe, expect, it } from 'vitest';
import { fieldText, forgetLookups, highlightParts, searchDocs, updateDoc } from './paperless';

const page = (results: unknown[]) => ({ count: results.length, results });
const api: Record<string, unknown> = {
  '/api/tags/': page([{ id: 1, name: 'Inbox' }, { id: 2, name: 'Empresa' }]),
  '/api/correspondents/': page([{ id: 7, name: 'Continente' }]),
  '/api/document_types/': page([{ id: 3, name: 'Fatura' }]),
  '/api/custom_fields/': page([
    { id: 1, name: 'Total', data_type: 'monetary', extra_data: { default_currency: 'EUR' } },
    { id: 2, name: 'Paid', data_type: 'select', extra_data: { select_options: [{ id: 'a1', label: 'Company card' }, { id: 'b2', label: 'Personal' }] } },
  ]),
  '/api/documents/': {
    count: 12,
    results: [
      { id: 40, title: 'Fatura FT 2026/118', correspondent: 7, document_type: 3, tags: [1, 2], created: '2026-09-28', added: '2026-09-30T08:12:00Z', page_count: 1, archive_serial_number: null, custom_fields: [{ field: 1, value: 'EUR123.40' }, { field: 2, value: 'b2' }], notes: [{ note: 'jantar cliente' }] },
      { id: 41, title: '', original_file_name: 'scan_0001.pdf', correspondent: null, document_type: null, tags: [1], created: '2026-09-29T00:00:00+01:00', added: '2026-10-01T10:00:00Z', custom_fields: [] },
    ],
  },
};
const fake = (async (url: string, init?: RequestInit) => {
  const { pathname, searchParams } = new URL(url);
  calls.push(`${init?.method ?? 'GET'} ${pathname}?${searchParams}`);
  if (init?.method === 'PATCH') { sentBodies.push(JSON.parse(String(init.body))); return new Response('{}'); }
  if (pathname === '/api/documents/40/') return new Response(JSON.stringify((api['/api/documents/'] as { results: unknown[] }).results[0]));
  expect((init?.headers as Record<string, string>).Authorization).toBe('Token secret');
  expect((init?.headers as Record<string, string>).Accept).toBe('application/json; version=9'); // Paperless 3 takes 9 and 10
  const body = api[pathname];
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
}) as typeof fetch;
let calls: string[] = [];
let sentBodies: unknown[] = [];

describe('paperless inbox', () => {
  beforeEach(() => {
    process.env.PAPERLESS_URL = 'http://paperless.lan:8000/';
    process.env.PAPERLESS_TOKEN = 'secret';
    process.env.PAPERLESS_PUBLIC_URL = 'https://paperless.home.tbraz.pt';
    calls = [];
    sentBodies = [];
    forgetLookups();
  });

  it('lists the documents tagged inbox with their names, fields and links', async () => {
    const inbox = await searchDocs({ inbox: true }, fake);
    expect(calls.find((c) => c.startsWith('GET /api/documents/'))).toContain('tags__id__all=1');
    expect(inbox.count).toBe(12);
    expect(inbox.documents[0]).toEqual({
      id: 40, title: 'Fatura FT 2026/118', correspondent: 'Continente', correspondentId: 7, type: 'Fatura', typeId: 3, tags: ['Empresa'], tagIds: [1, 2], inbox: true,
      created: '2026-09-28', added: '2026-09-30T08:12:00Z', pages: 1, asn: null,
      fields: [{ name: 'Total', value: '€123,40' }, { name: 'Paid', value: 'Personal' }],
      note: 'jantar cliente', url: 'https://paperless.home.tbraz.pt/documents/40/details', snippet: null,
    });
    expect(inbox.documents[1]).toMatchObject({ title: 'scan_0001.pdf', correspondent: null, created: '2026-09-29', fields: [], note: null });
  });

  it('searches the text (best match first) or lists the newest, with filters', async () => {
    await searchDocs({ query: ' fatura luz ', tag: 2, type: 3, page: 2 }, fake);
    const search = new URLSearchParams(calls.at(-1)!.split('?')[1]);
    expect(Object.fromEntries(search)).toMatchObject({ query: 'fatura luz', tags__id__all: '2', document_type__id: '3', page: '2' });
    expect(search.has('ordering')).toBe(false);
    await searchDocs({ inbox: true }, fake);
    expect(Object.fromEntries(new URLSearchParams(calls.at(-1)!.split('?')[1]))).toMatchObject({ tags__id__all: '1', ordering: '-added' });
  });

  it('keeps search highlights as plain text pieces', () => {
    expect(highlightParts('Fatura da <span class="match">luz</span> &amp; <b>gás</b>')).toEqual([
      { text: 'Fatura da ', hit: false }, { text: 'luz', hit: true }, { text: ' & gás', hit: false },
    ]);
    expect(highlightParts('')).toBeNull();
  });

  it('approving takes the inbox tag off and keeps the rest', async () => {
    await updateDoc(40, { approve: true }, fake);
    expect(calls.at(-1)).toMatch(/^PATCH \/api\/documents\/40\//);
    expect(sentBodies.at(-1)).toEqual({ tags: [2] });
    await updateDoc(40, { tags: [1, 2, 2, 5] }, fake); // only tags are ever sent
    expect(sentBodies.at(-1)).toEqual({ tags: [1, 2, 5] });
  });

  it('says which address it could not reach', async () => {
    const down = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
    await expect(searchDocs({}, down)).rejects.toThrow("Can't reach Paperless at http://paperless.lan:8000 (ECONNREFUSED)");
  });

  it('turns custom field values into text', () => {
    expect(fieldText({ id: 1, name: 'x', data_type: 'monetary' }, 'USD10.5')).toBe('10,50 USD');
    expect(fieldText({ id: 1, name: 'x', data_type: 'boolean' }, false)).toBe('no');
    expect(fieldText({ id: 1, name: 'x', data_type: 'select', extra_data: { select_options: ['A', 'B'] } }, 1)).toBe('B');
    expect(fieldText({ id: 1, name: 'x', data_type: 'string' }, null)).toBeNull();
  });
});
