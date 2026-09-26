// Only job: receive things shared to the installed app (Share → Family).
// Everything else goes straight to the network — nothing is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || url.pathname !== '/share') return;
  e.respondWith(
    (async () => {
      const form = await e.request.formData();
      const parts = ['title', 'text', 'url'].map((k) => String(form.get(k) ?? '').trim()).filter(Boolean);
      // Apps often repeat the title inside the text; keep each piece once.
      const text = parts.filter((p, i) => parts.indexOf(p) === i && !parts.some((q) => q !== p && q.includes(p))).join('\n');
      const file = form.get('file');
      const box = await caches.open('share');
      await box.put('/shared/text', new Response(text));
      if (file && typeof file !== 'string' && file.size) await box.put('/shared/file', new Response(file, { headers: { 'content-type': file.type } }));
      else await box.delete('/shared/file');
      return Response.redirect('/?share=1', 303);
    })(),
  );
});
