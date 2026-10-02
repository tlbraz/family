# Family

The family planner: one web app for the house, at **https://family.home.tbraz.pt** (on the LAN or over Tailscale; http://family.lan redirects there).
Install it on a phone with *Share → Add to Home Screen*.

## Stack

| Part | Choice |
|---|---|
| Web | React 19 + Vite (TypeScript), in `web/` |
| API | Hono on Node 22, in `server/`; the same process serves the built web app |
| Database | Postgres 17 via Drizzle ORM; schema in `server/schema.ts`, migrations in `drizzle/` (run on start) |
| Shared types | `shared/` (imported by both sides) |
| Deploy | `docker-compose.yml` (app + db) → Coolify on the home server |

## Features (v0.2)

- **Calendar**: week agenda or month grid (tap a day for its list), coloured by person, person filter, events with type, participants, driver,
  "bring" checklist, repeats (weekly / every 2 weeks / monthly / yearly, with an end date and skipped dates).
- **To-dos** ("sign the permission slip by Friday"): a title, a due date and who it's for. Shown on the due day
  (and on today once late); anyone can tick them off, and ticked ones drop off the next day. The "To-dos" switch
  next to Week/Month hides them on that device. Add one from the Add button → To-do.
- **Family**: members with colour, role and birthday (birthdays show up every year with the age).
- **Blood pressure log** (per adult, turned on from their profile; only signed-in parents can see it): type the two
  numbers straight through, tap tags (forgot meds, after training…), save. The heart next to your picture opens it.
  Or message the bot privately: `128/82 after training` (`undo` removes it). "Open report" gives a printable page for
  the doctor: averages (morning/evening), a chart with the 135/85 lines, how each tag compares, and every reading.
- **Portuguese holidays** (incl. Carnival and Almada's São João) and the **public school calendar**
  (`shared/school-calendar.ts`, update it each summer from the new Despacho).
- **Parents sign in** (first sign-in sets the password); everyone else can look and tick "bring" items and to-dos.
- **Money** tab (parents only), read from a self-hosted Actual Budget (`ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`,
  `ACTUAL_SYNC_ID`; optional `ACTUAL_COMPANY_SYNC_ID` for a second budget only `ACTUAL_COMPANY_VIEWERS` see, default Tiago).
  Available balance first, then spending this month vs. usual, by category group (tap for categories and transactions),
  what came in, and transactions tagged `#review`: pick a category (or "Looks fine") and the tag comes out, in Actual. Reads Actual every 20 min and asks it to sync the banks at 07:00, 13:00 and 19:00
  (`ACTUAL_BANK_SYNC=off` to stop). Swipe to change month.
- **Bills & subscriptions** (Money tab, family budget): payments to the same payee in 3 of the last 4 months around
  the same day for a similar amount (or twice a year apart) are bills. The card shows what's still to come this month,
  a price change ("Vodafone €39.90 → €44.90") and a bill that didn't show up; tap for the list, "Not a bill", or to
  track a payee it missed. Price changes and missing bills also go to Tiago on Telegram, once each.
- **Quiet-failure warnings** on Telegram: a document with a "valid until" date gets a message 90, 30 and 7 days ahead
  and when it expires (family chats); a bank-linked account in Actual that hasn't synced for 36 h, or whose sync
  failed, gets a daily message to Tiago (the bank link probably expired).
- **Ethereum at today's value** (`ETH_ADDRESS`, the public address only; `ETH_ACCOUNT`, default "Ethereum"): once a
  day the ETH balance × the euro price (CoinGecko) is written into that off-budget account in Actual as a
  "Market value" adjustment.
- **Funds, ETFs and shares at today's value** (Money tab → Savings → *Update values*): per Actual account, ISINs or
  Yahoo symbols in euros with their units, plus cash. From 08:00 each day, and right after saving, units × the price
  from Yahoo Finance is written into that account in Actual. Update the units when you buy or sell. (`HOLDINGS` in the
  environment, e.g. `DEGIRO=VWCE.DE:120,cash:250; …`, is only used until the list is saved from the app.)
- **Paperless inbox** on the Empresa tab (`PAPERLESS_URL`, `PAPERLESS_TOKEN`; optional `PAPERLESS_PUBLIC_URL` for
  the browser links and `PAPERLESS_INBOX_TAG`, default "inbox"): how many documents still carry the inbox tag (also on
  the Empresa switch), and a list with their correspondent, type, dates, custom fields, tags, latest note, thumbnail and
  a link to each in Paperless. Read only; the token stays on the server.
- **Tap someone** for their profile. Parents also see their documents (Cartão de Cidadão, NIF, NISS, utente, passport,
  driving licence…) with copy buttons, expiry warnings and a link to the scan in Paperless. Served only to signed-in parents.
- **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`): 07:30 "today" message, 20:00 "tomorrow" message with
  what to bring, both with open to-dos (late, or due within three days), Sunday 19:00 week ahead (day messages only
  when something is on). `POST /api/digest?kind=today|tomorrow|week` sends one now.
  Use a bot just for the family (the app reads its incoming messages to find who tapped Start). Every message goes to
  each chat in `TELEGRAM_CHAT_ID` (optional, comma-separated) plus the people added on the Family page's Telegram card
  (they open the bot and tap Start, then a parent taps Add).
- **Photo or sentence → event** (`ANTHROPIC_API_KEY`): Claude fills the form; the parent confirms.
- **Google Calendar** (key pasted on the Family page, or `GOOGLE_SERVICE_ACCOUNT`): a shared "Family" calendar owned by a service account,
  shared with each parent's Google address; app events are pushed, events added in Google are pulled in.

One container for the app plus one for Postgres. When the app grows, add feature folders under
`server/` and `web/src/`; nothing about the layout needs to change.

## Develop

```sh
npm install
docker run -d --name family-db -p 5432:5432 -e POSTGRES_USER=family -e POSTGRES_PASSWORD=family -e POSTGRES_DB=family postgres:17-alpine
DATABASE_URL=postgres://family:family@localhost:5432/family npm run dev   # web on :5173, API on :3000
```

Changing the schema: edit `server/schema.ts`, then `npm run db:generate -- --name <what>` and commit the new file in `drizzle/`.

Checks (also run by GitHub Actions on every push): `npm run typecheck && npm test && npm run build`.

## Deploy

Push to `main`. The home server checks GitHub every minute, deploys through Coolify, verifies
`/api/health` reports the new commit, and sends a Telegram message (🚀 or ❌).

`GET /api/health` → `{ ok, version, commit, db }`. The version and commit also show in the page footer.
