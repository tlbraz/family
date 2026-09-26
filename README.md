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
- **Family**: members with colour, role and birthday (birthdays show up every year with the age).
- **Portuguese holidays** (incl. Carnival and Almada's São João) and the **public school calendar**
  (`shared/school-calendar.ts`, update it each summer from the new Despacho).
- **Parents sign in** (first sign-in sets the password); everyone else can look and tick "bring" items.
- **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`): 07:30 "today" message, 20:00 "tomorrow" message with
  what to bring, Sunday 19:00 week ahead (day messages only when something is on). `POST /api/digest?kind=today|tomorrow|week` sends one now.
  Every message goes to each chat in `TELEGRAM_CHAT_ID` (comma-separated) plus the people added on the Family page
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
