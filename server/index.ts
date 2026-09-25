import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { connect, runMigrations } from './db';
import { createApp } from './app';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = connect(url);
await runMigrations(db);

const app = createApp(db);
// The built web app; unknown paths fall back to index.html so client-side routes work.
app.use('/*', serveStatic({ root: './dist/web' }));
app.get('*', serveStatic({ path: './dist/web/index.html' }));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, () => console.log(`family listening on :${port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    close().finally(() => process.exit(0));
  });
}
