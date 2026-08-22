# MCP Server Web App — Project Rules

## Stack
Hono (backend, Node) + Vite + React SPA, React Router, TanStack Query,
Tailwind CSS, Drizzle ORM + PostgreSQL (`pg` driver, `DATABASE_URL`), Zod. Always use the latest stable versions
when adding dependencies. See `docs/PLAN.md` for the full architecture.

## Routing rule: URL search params are the source of truth (MANDATORY)

All page-level UI state MUST live in React Router URL search parameters —
never in component `useState` or global stores. This includes:

- **Search / query text** → `?q=`
- **Pagination** → `?page=` (and `?per_page=` when configurable)
- **Filtering** → `?status=`, `?role=`, `?action=`, etc.
- **Tab switching** → `?tab=`
- **Sorting** → `?sort=` (e.g. `sort=created_at.desc`)

Requirements:
- Read and write params with React Router's `useSearchParams` (or loader
  `request.url`); use a shared helper to parse/validate params with zod and
  apply defaults.
- Data fetching (TanStack Query) MUST derive its query keys from the parsed
  search params, so navigation, back/forward, reload, and shared URLs all
  reproduce the exact same page content.
- Updating a filter/search resets `page` to 1; changing params uses
  `setSearchParams` with `replace: true` for keystroke-level updates (search
  input debounce) and history pushes for discrete actions (tab, page, filter).
- Omit params that equal their default value to keep URLs clean.
- Backend list endpoints accept the same parameter names 1:1 (`q`, `status`,
  `page`, `per_page`, `sort`) so the URL maps directly to the API call.

## Security conventions
- Never store raw token secrets — store SHA-256 hashes; show full token only
  once at creation time.
- All state-changing API routes require session auth + CSRF protection.
- OAuth: PKCE S256 required, exact `redirect_uri` match, refresh token rotation.
- Validate every request body/query with zod via `@hono/zod-validator`.
- Every security-relevant action writes an `audit_log` row.

## Code layout
- `src/server/` — Hono app (routes, middleware, oauth, mcp, db)
- `src/web/` — React SPA (routes, components, lib)
- `src/shared/` — types and zod schemas used by both
- MCP tools live in `src/server/mcp/tools/`, one file per tool.
- `src/server/realtime/` — the WebSocket endpoint and the in-process event bus.
  Change events are published by decorating the repositories, so the dashboard
  API and the MCP tools both emit without either knowing about sockets. Events
  never carry business data: the client refetches over the normal HTTP API.
- `src/server/funds/` — the market-agnostic fund pipeline (ingest, repo,
  exposure, on-demand cache). Nothing here may know about a specific market.
- `src/server/funds/providers/<id>/` — one upstream source each, behind the
  `FundProvider` interface. Everything market-specific belongs here: code
  shapes, weight and size units, scope vocabulary, response parsing. Adding a
  market means adding a provider plus a descriptor in `src/shared/funds.ts`,
  never a branch in the pipeline.

## Workflow
- TypeScript strict mode; `npm run typecheck && npm run test` must pass before
  every commit.
- Drizzle migrations via `drizzle-kit`; never edit applied migration files.
- Never push directly to `main`. Always create a new branch and submit a pull request (PR) for any changes.
