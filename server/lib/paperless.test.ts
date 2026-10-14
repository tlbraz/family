import { beforeEach, describe, expect, it } from 'vitest';
import { docDetail, docsMeta, fieldText, forgetLookups, highlightParts, rejectDoc, searchDocs, updateDoc } from './paperless';

const page = (results: unknown[]) => ({ count: results.length, results });
const api: Record<string, unknown> = {
  '/api/tags/': page([{ id: 1, name: 'Inbox' }, { id: 2, name: 'Empresa' }, { id: 4, name: 'Expense', parent: 2 }, { id: 5, name: 'Restaurants', parent: 4 }, { id: 6, name: 'Date missing' }]),
  '/api/correspondents/': page([{ id: 7, name: 'Continente' }]),
  '/api/document_types/': page([{ id: 3, name: 'Fatura' }]),
  '/api/custom_fields/': page([
    { id: 1, name: 'Total', data_type: 'monetary', extra_data: { default_currency: 'EUR' } },
    { id: 2, name: 'Paid', data_type: 'select', extra_data: { select_options: [{ id: 'a1', label: 'Company card' }, { id: 'b2', label: 'Personal' }] } },
    { id: 3, name: 'Amount', data_type: 'monetary', extra_data: { default_currency: 'EUR' } },
    { id: 4, name: 'Period', data_type: 'string' },
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
  if (init?.method === 'DELETE') return new Response(null, { status: 204 });
  if (pathname === '/api/documents/42/') return new Response(JSON.stringify({ id: 42, title: 'Approved', tags: [2] }));
  if (init?.method === 'PATCH') { sentBodies.push(JSON.parse(String(init.body))); return new Response('{}'); }
  if (pathname === '/api/documents/43/') return new Response(JSON.stringify(receipt));
  if (pathname === '/api/documents/44/') return new Response(JSON.stringify({ ...receipt, id: 44, tags: [2, 4], custom_fields: [{ field: 3, value: 'EUR144.55' }] }));
  if (pathname === '/api/documents/40/') return new Response(JSON.stringify((api['/api/documents/'] as { results: unknown[] }).results[0]));
  expect((init?.headers as Record<string, string>).Authorization).toBe('Token secret');
  expect((init?.headers as Record<string, string>).Accept).toBe('application/json; version=9'); // Paperless 3 takes 9 and 10
  const body = api[pathname];
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
}) as typeof fetch;
// A phone photo of a restaurant receipt: QR not read, so no Amount and a placeholder date.
const receipt = { id: 43, title: 'IMG_0412', correspondent: null, document_type: null, tags: [1, 2, 4, 5, 6], created: '2026-10-01', added: '2026-10-01T09:00:00Z', custom_fields: [{ field: 2, value: 'a1' }] };
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

  it('gives the tag tree and which tag marks company expenses', async () => {
    const meta = await docsMeta(fake);
    expect(meta.expenseTag).toBe(4);
    expect(meta.tags.find((t) => t.name === 'Restaurants')).toEqual({ id: 5, name: 'Restaurants', parent: 4 });
    expect(meta.tags.find((t) => t.name === 'Inbox')).toEqual({ id: 1, name: 'Inbox', parent: null });
  });

  it("says when an expense has no amount or only a placeholder date", async () => {
    expect(await docDetail(43, fake)).toMatchObject({ amount: null, dateMissing: true, created: '2026-10-01' });
    expect(await docDetail(44, fake)).toMatchObject({ amount: 144.55, dateMissing: false });
  });

  it("puts in a receipt's date and amount by hand, keeping its other fields", async () => {
    await updateDoc(43, { tags: [1, 2, 4, 5, 6], created: '2026-09-13', amount: 144.55 }, fake);
    expect(calls.at(-1)).toMatch(/^PATCH \/api\/documents\/43\//);
    expect(sentBodies.at(-1)).toEqual({
      tags: [1, 2, 4, 5], // "Date missing" comes off; still in the inbox
      created: '2026-09-13',
      custom_fields: [{ field: 2, value: 'a1' }, { field: 3, value: 'EUR144.55' }, { field: 4, value: '2026-09' }],
    });
    await updateDoc(43, { approve: true, amount: 12 }, fake); // just the amount: the date and its tag stay
    expect(sentBodies.at(-1)).toEqual({ tags: [2, 4, 5, 6], custom_fields: [{ field: 2, value: 'a1' }, { field: 3, value: 'EUR12.00' }] });
  });

  it('rejecting deletes a document in the inbox, and nothing already approved', async () => {
    await rejectDoc(40, fake);
    expect(calls.at(-1)).toMatch(/^DELETE \/api\/documents\/40\//);
    calls = [];
    await expect(rejectDoc(42, fake)).rejects.toThrow('still in the inbox');
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
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
