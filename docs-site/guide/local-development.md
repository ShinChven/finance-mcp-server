# Local Development

Requirements: **Node 22+** and a **PostgreSQL** database you can reach.

## 1. Clone and configure

```bash
git clone https://github.com/ShinChven/finance-mcp-server.git
cd finance-mcp-server
cp .env.example .env
```

Fill in at least `DATABASE_URL`, `SESSION_SECRET`, the Google credentials and
`ADMIN_EMAILS`. Every variable is described in the
[Configuration Reference](/guide/configuration).

```bash
openssl rand -base64 32   # a value for SESSION_SECRET
```

Google credentials come from [Google OAuth Setup](/guide/google-oauth) — the
dashboard has no password login, so sign-in does not work without them.

## 2. Install and run

```bash
npm install
npm run dev          # http://localhost:5173 (follows PORT)
```

One process serves both halves: Hono runs inside the Vite dev server, so the
API, the OAuth endpoints and `/mcp` are on the same port as the SPA.

Migrations run automatically at boot, and every `ADMIN_EMAILS` entry is seeded
as an active admin. Sign in with the matching Google account.

## 3. Checks

```bash
npm run typecheck    # tsc --noEmit, strict mode
npm run test         # vitest
npm run lint         # oxlint
```

`npm run typecheck && npm run test` must pass before every commit.

Two further test entry points exist:

```bash
npm run test:db          # executes every repo query against a real DATABASE_URL
node scripts/smoke.mjs   # end-to-end smoke test against a running dev server
```

`test:db` runs inside a transaction that is always rolled back, and is skipped
when `DATABASE_URL` is unset. It exists because the SQL layer typechecks
whatever it emits and the tool tests mock the repo away — a statement Postgres
rejects at parse time can otherwise pass the whole suite.

## 4. Documentation site

The docs you are reading live in `docs-site/` with their own dependencies:

```bash
npm run docs:install
npm run docs:dev       # http://localhost:5174
npm run docs:build
npm run docs:preview
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (SPA + backend, single process) |
| `npm run build` | Production build (`dist/web` + `dist/server`) |
| `npm start` | Run the production build |
| `npm run typecheck` · `npm run lint` · `npm run test` | Checks |
| `npm run test:db` | Repo queries against a real database |
| `npm run ingest` | [Fund data ingest CLI](/operations/ingest) |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations manually |
| `npm run docs:dev` | This documentation site |
