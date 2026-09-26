import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';

// Share → Family on the phone POSTs here (the manifest's share_target). We keep what was shared
// in memory for a few minutes and send the app to /?share=<id>, which picks it up once.
// No sign-in needed to post: the id is unguessable, single-use and short-lived.
type Shared = { text: string; image?: { mediaType: string; data: string }; at: number };

const TTL = 10 * 60_000;
const MAX_BYTES = 15_000_000;

export function shareRoutes() {
  const box = new Map<string, Shared>();
  const r = new Hono();

  r.post('/', async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > MAX_BYTES) return c.redirect('/', 303);
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.redirect('/', 303);
    const parts = ['title', 'text', 'url'].map((k) => String(form.get(k) ?? '').replace(/\r\n?/g, '\n').trim()).filter(Boolean);
    // Apps often repeat the title inside the text; keep each piece once.
    const text = parts.filter((p, i) => parts.indexOf(p) === i && !parts.some((q) => q !== p && q.includes(p))).join('\n');
    const file = form.get('file');
    const image =
      file instanceof File && file.size && file.type.startsWith('image/')
        ? { mediaType: file.type, data: Buffer.from(await file.arrayBuffer()).toString('base64') }
        : undefined;
    if (!text && !image) return c.redirect('/', 303);

    const now = Date.now();
    for (const [k, v] of box) if (now - v.at > TTL || box.size > 20) box.delete(k);
    const id = randomUUID();
    box.set(id, { text, image, at: now });
    return c.redirect(`/?share=${id}`, 303);
  });

  r.get('/:id', (c) => {
    const s = box.get(c.req.param('id'));
    box.delete(c.req.param('id'));
    if (!s || Date.now() - s.at > TTL) return c.json({ error: 'Nothing shared' }, 404);
    return c.json({ text: s.text, image: s.image ?? null });
  });

  return r;
}
