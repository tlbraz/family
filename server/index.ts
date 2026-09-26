import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { connect, runMigrations } from './db';
import { createApp } from './app';
import { runDigests } from './lib/digest';
import { deleteGoogleEvent, googleEnabled, loadGoogleKey, pushEvent, shareWithParents, syncRound } from './lib/google';
import { seed } from './seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = connect(url);
await runMigrations(db);
await seed(db);
await loadGoogleKey(db);

const logErr = (what: string) => (e: Error) => console.error(`${what}:`, e.message);
const app = createApp(db, {
  changed: (id) => googleEnabled() && void pushEvent(db, id).catch(logErr('google push')),
  removed: (gid) => googleEnabled() && void deleteGoogleEvent(db, gid).catch(logErr('google delete')),
  membersChanged: () => googleEnabled() && void shareWithParents(db).catch(logErr('google share')),
});
// The old http://family.lan address sends people to HTTPS (needed for the microphone and other browser features).
// /api stays reachable on both, for health checks and the ops scripts.
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://family.home.tbraz.pt';
app.use('*', async (c, next) => {
  const host = c.req.header('host')?.split(':')[0];
  if (host === 'family.lan' && !c.req.path.startsWith('/api')) return c.redirect(PUBLIC_URL + c.req.path, 301);
  await next();
});
// Share → Family normally lands in the service worker; if it isn't running yet, just open the app.
app.post('/share', (c) => c.redirect('/', 303));
// The built web app; unknown paths fall back to index.html so client-side routes work.
app.use('/*', serveStatic({ root: './dist/web' }));
app.get('*', serveStatic({ path: './dist/web/index.html' }));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`family listening on :${port} (google ${googleEnabled() ? 'on' : 'off'})`),
);

const timers = [
  setInterval(() => void runDigests(db).catch(logErr('digest')), 60_000),
  setInterval(() => void syncRound(db), 2 * 60_000),
];
void syncRound(db);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    timers.forEach(clearInterval);
    server.close();
    close().finally(() => process.exit(0));
  });
}
