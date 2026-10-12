# Family app — notes for Claude

Tiago steers, Claude builds. Keep it simple; this is a family tool, not a product.

- Layout: `server/` (Hono API, Drizzle), `web/src/` (React), `shared/` (types used by both), `drizzle/` (generated SQL migrations — never edit by hand; generate with `npm run db:generate -- --name <what>`).
- All API routes live under `/api`; `createApp(db)` in `server/app.ts` takes the db so routes can be tested with a fake (see `server/app.test.ts`).
- Before pushing: `npm run typecheck && npm test && npm run build`. Bump `version` in package.json for user-visible changes.
- Several Claude sessions push to `main`. Always `git fetch origin main` and merge it before pushing (never force-push main), re-run the checks after the merge, and check `main` really moved (`git merge-base --is-ancestor origin/main HEAD` before `git push origin HEAD:main`). If two sessions used the same version, bump again.
- Tiago lets Claude merge to `main` without asking once a change is tested. Tiago writes in Portuguese or English: answer in the language he used (pt-PT, not Brazilian).
- Deploying = pushing to `main` (the ops container autodeploys within ~1 min and verifies `/api/health`). From ops: `/root/homelab/apps/deploy.py family` deploys now (it redeploys even if nothing changed); `/root/homelab/apps/deploy.py --status` (no app name) only shows remote vs live commit. `GET /api/health` gives the live version and commit.
- Timezone: the server runs with `TZ=Europe/Lisbon` and treats local time as Lisbon; repeats are expanded in "floating" time (`server/lib/time.ts`) so they keep their wall-clock time across DST. Tests run with the same TZ.
- Auth: parents only (scrypt passwords, session cookie); reads are open, writes need `requireParent`.
- Production: Coolify application on apps.lan, domains https://family.home.tbraz.pt (wildcard cert *.home.tbraz.pt, DNS only in Pi-hole) + http://family.lan (redirects, /api stays), Postgres volume `family-pgdata`. LAN/Tailscale only. Never add public exposure without asking.
- UI: mobile-first, works as an installed PWA, light + dark via CSS variables in `web/src/styles.css`.

## Money tab (Actual Budget) — `server/lib/money.ts`, `web/src/components/MoneyView.tsx`

- Reads Actual through `@actual-app/api` (one open budget per process: everything goes through `serial()`), a snapshot every 20 min and on "updated … ago". Two budgets: Família (`ACTUAL_SYNC_ID`) and Empresa (`ACTUAL_COMPANY_SYNC_ID`, only `ACTUAL_COMPANY_VIEWERS`, default Tiago). Bank sync at 07/13/19 (`ACTUAL_BANK_SYNC=off` to stop; PSD2 allows ~4/day).
- Category names are pt-PT and live in Actual; the app finds categories by id. Conventions the app relies on (don't rename): group **"A receber"** or a category with **"reembolso"** = money paid for someone else (not spending; "To come back" line + 30-day Telegram nudge); **Rendimentos/Receitas/Income** = generic income (Came in shows who paid); money without a category = "Sem categoria".
- Three levels by name: a group `Casa / Energia` sits under **Casa** (donut, legend, Bills colours). Colours (12 validated slots, `moneyColours.ts`) go by the top level in Actual's order.
- Actual API gotchas: `updateTransaction` rejects `category: null`; `updateCategory(id, { name, group_id })` needs `name` when moving a category; linking two existing transactions as a transfer = set each one's payee to the other account's transfer payee and `transfer_id` to the other id, then set the same note on both (see `linkTransfer`).
- Net worth = budget accounts + off-budget accounts ≥ 0; debts (the mortgage) stay apart everywhere. Valuations (ETH, funds via Yahoo) write a daily "Market value" adjustment; holdings are edited in the app.

## Docs tab (Paperless-ngx) — `server/lib/paperless.ts`, `web/src/components/DocsView.tsx`

- `PAPERLESS_URL=http://docs.lan` (reachable from the app container; Paperless's own container name isn't), `PAPERLESS_TOKEN` (tiago, superuser). Paperless 3.x: send `Accept: application/json; version=9` (it answers 406 to old versions). Inbox tag is `Inbox` (matched ignoring case).
- Read, view/download (proxied, token stays on the server), and change **tags only** + Approve (removes the inbox tag). No uploads, no other edits: Tiago asked for that. New documents are added in Paperless itself.

## Client gotchas

- `request()` in `web/src/api.ts`: any non-OK answer is an error, except `/health`'s 503. Plain-text 502–504 means a deploy is in progress (the app shows "Updating the app…" and reloads).
- `index.html` is served no-cache, `/assets/*` immutable and 404 when missing; if the app can't start it shows "The app didn't start" with the error: ask for a screenshot.

## Testing locally

- Postgres 16 in `/var/tmp/familypg` (port 5433), a local Actual sync-server (`@actual-app/sync-server`, password `testpass`) seeded with fake budgets, fakes for Paperless, then Playwright screenshots at 390×844 in light and dark. External services (banks, Yahoo, CoinGecko, Paperless, the home LAN) aren't reachable from cloud sessions; a local agent on the LAN can check the real thing.
