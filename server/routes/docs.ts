import { Hono } from 'hono';
import type { AuthEnv } from '../lib/auth';
import { requireParent } from '../lib/auth';
import { docDetail, docsMeta, paperlessEnabled, PaperlessError, paperlessFetch, searchDocs, updateDoc } from '../lib/paperless';

/** The Docs tab: Paperless, for parents only. */
export function docRoutes() {
  const r = new Hono<AuthEnv>();
  r.use('*', requireParent);
  r.use('*', async (c, next) => {
    if (!paperlessEnabled()) return c.json({ error: 'Paperless is not set up on the server' }, 404);
    await next();
  });
  const fail = (e: unknown) => ({ error: (e as Error).message, status: e instanceof PaperlessError && /answered 400/.test((e as Error).message) ? 400 : 503 } as const);

  r.get('/meta', async (c) => {
    try {
      return c.json(await docsMeta());
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  r.get('/', async (c) => {
    const num = (k: string) => (/^\d+$/.test(c.req.query(k) ?? '') ? Number(c.req.query(k)) : undefined);
    try {
      return c.json(await searchDocs({ query: c.req.query('q'), inbox: c.req.query('inbox') === '1', tag: num('tag'), correspondent: num('correspondent'), type: num('type'), page: num('page') }));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  r.get('/:id{[0-9]+}', async (c) => {
    try {
      return c.json(await docDetail(Number(c.req.param('id'))));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // Change the tags, and/or approve (take it out of the inbox). Nothing else is edited from here.
  r.patch('/:id{[0-9]+}', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tags = Array.isArray(b.tags) && b.tags.every((t) => Number.isInteger(t)) ? (b.tags as number[]) : undefined;
    if (tags === undefined && b.approve !== true) return c.json({ error: 'Nothing to change' }, 400);
    try {
      await updateDoc(Number(c.req.param('id')), { tags, approve: b.approve === true });
      return c.json(await docDetail(Number(c.req.param('id'))));
    } catch (e) {
      const f = fail(e);
      return c.json({ error: f.error }, f.status);
    }
  });

  // The files, through us: thumbnail, preview (to look at, in the browser) and the original (download).
  const file = (kind: 'thumb' | 'preview' | 'download') =>
    r.get(`/:id{[0-9]+}/${kind}`, async (c) => {
      try {
        const res = await paperlessFetch(`/api/documents/${c.req.param('id')}/${kind}/${kind === 'download' ? '?original=true' : ''}`);
        const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' });
        const disposition = res.headers.get('content-disposition');
        if (disposition) headers.set('content-disposition', kind === 'download' ? disposition.replace(/^inline/, 'attachment') : disposition.replace(/^attachment/, 'inline'));
        const length = res.headers.get('content-length');
        if (length) headers.set('content-length', length);
        return new Response(res.body, { headers });
      } catch {
        return c.body(null, 404);
      }
    });
  file('thumb');
  file('preview');
  file('download');

  return r;
}
