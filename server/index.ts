import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { connect, runMigrations } from './db';
import { createApp } from './app';
import { runDigests } from './lib/digest';
import { deleteGoogleEvent, googleEnabled, loadGoogleKey, pushEvent, shareWithParents, syncRound } from './lib/google';
import { runMoney } from './lib/money';
import { runPayrollAlert } from './lib/payroll';
import { runReminders } from './lib/reminders';
import { runBankAlerts, runDocumentAlerts, runOwedAlerts } from './lib/alerts';
import { runValuations } from './lib/valuations';
import { bpFromTelegram } from './lib/bp';
import { loadTelegramChats, pollTelegram } from './lib/telegram';
import { seed } from './seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = connect(url);
await runMigrations(db);
await seed(db);
await loadGoogleKey(db);
await loadTelegramChats(db);

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
// Phones that installed the app before the share target moved to /api/share still post here.
app.post('/share', (c) => app.fetch(new Request(new URL('/api/share', c.req.url), c.req.raw)));
// The built web app; unknown paths fall back to index.html so client-side routes work.
app.use('/*', serveStatic({ root: './dist/web' }));
app.get('*', serveStatic({ path: './dist/web/index.html' }));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`family listening on :${port} (google ${googleEnabled() ? 'on' : 'off'})`),
);

// After each read of Actual: the payment alert, stuck bank links, and today's value of crypto etc.
const afterMoney = (read: Promise<unknown> | undefined) =>
  read
    ?.then(() => runPayrollAlert(db))
    .then(() => runBankAlerts(db))
    .then(() => runOwedAlerts(db))
    .then(() => runValuations(db).catch(logErr('valuations')))
    .catch(logErr('actual'));
const timers = [
  setInterval(() => void runDigests(db).catch(logErr('digest')), 60_000),
  setInterval(() => void syncRound(db), 2 * 60_000),
  setInterval(() => void runReminders(db).catch(logErr('reminders')), 60_000),
  setInterval(() => void runDocumentAlerts(db).catch(logErr('document alerts')), 60_000),
  setInterval(() => void afterMoney(runMoney()), 20 * 60_000),
];
void afterMoney(runMoney());
void syncRound(db);
// Messages people send the bot (for now: blood pressure readings).
const inbox = process.env.TELEGRAM_BOT_TOKEN ? pollTelegram(db, (m) => bpFromTelegram(db, m)) : null;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    timers.forEach(clearInterval);
    inbox?.stop();
    server.close();
    close().finally(() => process.exit(0));
  });
}
