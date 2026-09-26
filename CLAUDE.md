# Family app — notes for Claude

Tiago steers, Claude builds. Keep it simple; this is a family tool, not a product.

- Layout: `server/` (Hono API, Drizzle), `web/src/` (React), `shared/` (types used by both), `drizzle/` (generated SQL migrations — never edit by hand; generate with `npm run db:generate -- --name <what>`).
- All API routes live under `/api`; `createApp(db)` in `server/app.ts` takes the db so routes can be tested with a fake (see `server/app.test.ts`).
- Before pushing: `npm run typecheck && npm test && npm run build`. Bump `version` in package.json for user-visible changes.
- Deploying = pushing to `main` (the ops container autodeploys within ~1 min and verifies `/api/health`). From ops: `/root/homelab/apps/deploy.py family` deploys now, `--status` shows remote vs live commit.
- Timezone: the server runs with `TZ=Europe/Lisbon` and treats local time as Lisbon; repeats are expanded in "floating" time (`server/lib/time.ts`) so they keep their wall-clock time across DST. Tests run with the same TZ.
- Auth: parents only (scrypt passwords, session cookie); reads are open, writes need `requireParent`.
- Production: Coolify application on apps.lan, domain http://family.lan, Postgres volume `family-pgdata`. LAN/Tailscale only. Never add public exposure without asking.
- UI: mobile-first, works as an installed PWA, light + dark via CSS variables in `web/src/styles.css`.
