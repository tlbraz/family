# Family

The family planner: one web app for the house, at **http://family.lan** (on the LAN or over Tailscale).
Install it on a phone with *Share → Add to Home Screen*.

## Stack

| Part | Choice |
|---|---|
| Web | React 19 + Vite (TypeScript), in `web/` |
| API | Hono on Node 22, in `server/`; the same process serves the built web app |
| Database | Postgres 17 via Drizzle ORM; schema in `server/schema.ts`, migrations in `drizzle/` (run on start) |
| Shared types | `shared/` (imported by both sides) |
| Deploy | `docker-compose.yml` (app + db) → Coolify on the home server |

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
