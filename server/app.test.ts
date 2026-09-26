import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { Db } from './db';

const fakeDb = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Db;
const up = () => createApp(fakeDb(async () => []));

describe('GET /api/health', () => {
  it('is ok when the database answers', async () => {
    const res = await up().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: 'up' });
  });

  it('is 503 when the database is down', async () => {
    const res = await createApp(fakeDb(async () => { throw new Error('down'); })).request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' });
  });
});

describe('permissions', () => {
  it('only lets signed-in parents create events', async () => {
    const res = await up().request('/api/events', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('ignores a wrong ops token', async () => {
    process.env.OPS_TOKEN = 'x'.repeat(40);
    const res = await up().request('/api/events', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
    delete process.env.OPS_TOKEN;
  });

  it('only lets signed-in parents change a picture', async () => {
    const res = await up().request('/api/members/1/photo', { method: 'PUT', body: JSON.stringify({ photo: 'data:image/jpeg;base64,AAAA' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('rejects an empty note', async () => {
    const res = await up().request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
