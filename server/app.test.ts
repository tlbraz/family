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

describe('GET /api/search', () => {
  it('needs at least 2 letters', async () => {
    const res = await up().request('/api/search?q=%20a%20');
    expect(res.status).toBe(400);
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

  it('only lets signed-in parents add a to-do', async () => {
    const res = await up().request('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Pay the trip', due: '2026-10-02', memberId: null }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('never shows blood pressure without a parent signed in', async () => {
    for (const path of ['/api/bp/1', '/api/bp/1/report?from=2026-09-01&to=2026-09-30']) expect((await up().request(path)).status).toBe(401);
    const res = await up().request('/api/bp/1', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
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

describe('share target', () => {
  it('keeps a share for the app to pick up once', async () => {
    const app = up();
    const form = new FormData();
    form.set('title', 'Escola');
    form.set('text', 'Escola\nReunião de pais sexta às 18h');
    const res = await app.request('/api/share', { method: 'POST', body: form });
    expect(res.status).toBe(303);
    const id = new URL(res.headers.get('location')!, 'http://x').searchParams.get('share');
    expect(id).toBeTruthy();
    const got = await app.request(`/api/share/${id}`);
    expect(await got.json()).toEqual({ text: 'Escola\nReunião de pais sexta às 18h', image: null });
    expect((await app.request(`/api/share/${id}`)).status).toBe(404);
  });

  it('opens the app when nothing usable was shared', async () => {
    const res = await up().request('/api/share', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
  });
});

describe('member documents', () => {
  it('are only shown to signed-in parents', async () => {
    const res = await up().request('/api/members/1/documents');
    expect(res.status).toBe(401);
  });

  it('are only changed by signed-in parents', async () => {
    const res = await up().request('/api/members/1/documents', { method: 'PUT', body: '[]', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });
});

describe('money', () => {
  it('is only for signed-in parents', async () => {
    const res = await up().request('/api/money');
    expect(res.status).toBe(401);
  });

  it('only lets signed-in parents edit transactions', async () => {
    const res = await up().request('/api/money/edit', { method: 'POST', body: JSON.stringify({ id: 'x', review: true }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('only lets signed-in parents review transactions', async () => {
    const res = await up().request('/api/money/review', { method: 'POST', body: JSON.stringify({ id: 'x', category: 'y' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });
});
