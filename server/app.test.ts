import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { Db } from './db';

const fakeDb = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Db;

describe('GET /api/health', () => {
  it('is ok when the database answers', async () => {
    const res = await createApp(fakeDb(async () => [])).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: 'up' });
  });

  it('is 503 when the database is down', async () => {
    const res = await createApp(fakeDb(async () => { throw new Error('down'); })).request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' });
  });
});

describe('POST /api/notes', () => {
  it('rejects an empty note', async () => {
    const res = await createApp(fakeDb(async () => [])).request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
