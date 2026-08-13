# MCP Server Web App — Implementation Plan

A containerized **MCP (Model Context Protocol) server** with a management dashboard.
Users sign in with Google, manage their own MCP access tokens and OAuth 2.1 clients;
admins manage users. The MCP endpoint itself is served by the same app and accepts
both personal access tokens and OAuth 2.1 access tokens.

---

## 1. Tech stack (latest as of 2026-07)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Backend | Hono | 4.12.x | Runs on Node via `@hono/node-server`; serves API, OAuth, MCP, and the built SPA |
| Frontend build | Vite | 8.1.x | SPA build; dev server proxies `/api`, `/oauth`, `/mcp` to Hono |
| UI | React | 19.2.x | With `@vitejs/plugin-react` 6.x |
| Routing | React Router | 8.x | Library mode (`createBrowserRouter`); **all page state lives in URL search params** (see `CLAUDE.md` rules) |
| Data fetching | TanStack Query | 5.x | Query keys derived from search params; caching + optimistic updates |
| Styling | Tailwind CSS | 4.x | CSS-first config (`@theme`), dark mode via `prefers-color-scheme` + user preference |
| Database | PostgreSQL + Drizzle ORM 0.45.x | pg 8.22.x (node-postgres) | Connection via `DATABASE_URL`; `drizzle-kit` migrations run at boot; docker-compose ships a `postgres:17` service |
| Validation | Zod 4.x + `@hono/zod-validator` | | Shared schemas between API and client where useful |
| Auth (dashboard) | Google OIDC via `arctic` 3.x + `jose` 6.x | | Google login **only**; server-side sessions in HttpOnly cookies |
| MCP | `@modelcontextprotocol/sdk` 1.30.x + `@hono/mcp` 0.3.x + `yahoo-finance2` 4.x | | Streamable HTTP transport at `/mcp`; read-only market data tools |
| Language | TypeScript 7.x | | Native (tsgo) compiler; fall back to 5.9 only if a tool in the chain can't handle 7 yet |

**Project shape:** single package, two source roots — `src/server/` (Hono) and
`src/web/` (React). Shared types/schemas in `src/shared/`. **One process in both
modes:** in dev, the Hono app runs inside the Vite dev server via
`@hono/vite-dev-server` (`npm run dev`, port `PORT`, SPA with HMR + backend paths);
in production, one Hono process serves the API, OAuth, MCP endpoint, and the
built `dist/web` assets with an SPA fallback.

---

## 2. Authentication & authorization model

### Dashboard auth — Google only
- OIDC Authorization Code + PKCE against Google (`arctic`), `state` + nonce checked.
- On callback: verify ID token (`jose`), upsert user by `google_sub`/email.
- **Login is allowlisted**: only emails that already exist in the `users` table may
  sign in. There is no open signup — admins create (pre-authorize) users by email.
- Server-side sessions: random session ID in a signed, HttpOnly, `SameSite=Lax`,
  `Secure` cookie; session rows in DB with expiry, IP, user agent. Sliding renewal.
- Disabled users: sessions invalidated, login rejected, tokens/grants rejected.

### Admin seeding from env
Since login is Google-only there is no password to seed. `ADMIN_EMAILS`
(comma-separated) is read at boot: each email is upserted as an active `admin`
user. First Google login with that email links the Google account. Boot fails
loudly if `ADMIN_EMAILS` is empty on a fresh database.

### MCP endpoint auth (two parallel methods)
1. **Personal access tokens** — `Authorization: Bearer mcp_<random>`.
2. **OAuth 2.1 access tokens** — issued by our built-in authorization server.

Both are opaque random strings; only SHA-256 hashes are stored. Middleware
resolves the token → user, rejects disabled/revoked/expired, and updates
`last_used_at`/`last_used_ip` (throttled to at most once a minute per token to
avoid write amplification).

### OAuth 2.1 authorization server (per MCP spec)
- `GET /.well-known/oauth-authorization-server` (RFC 8414) and
  `GET /.well-known/oauth-protected-resource` (RFC 9728) metadata.
- **Dynamic Client Registration** (RFC 7591) at `POST /oauth/register` — this is how
  MCP clients (Claude, IDEs) register; public clients, PKCE **S256 required**.
- `GET /oauth/authorize` — requires dashboard session (redirects to login),
  renders a consent screen (client name, scopes), issues short-lived auth code
  bound to `code_challenge`, exact-match `redirect_uri`, and `resource`.
- `POST /oauth/token` — code + verifier exchange; refresh tokens with rotation
  (reuse detection revokes the family). Access tokens ~1h, refresh ~30d.
- `POST /oauth/revoke` (RFC 7009).
- 401 responses from `/mcp` include `WWW-Authenticate` with the resource metadata
  URL so MCP clients can discover the flow automatically.

---

## 3. Data model (Drizzle / PostgreSQL)

- **users** — id, email (unique), google_sub (unique, nullable until first login),
  name, display_name, avatar_url, role (`admin`|`user`), status (`active`|`disabled`),
  preferences (JSON: theme, page size, timezone), created_at, last_login_at
- **sessions** — id (hash of cookie value), user_id, created_at, expires_at, ip, user_agent
- **access_tokens** — id, user_id, name, token_hash (unique), token_prefix
  (first 8 chars, for display `mcp_ab12cd34…`), status (`active`|`disabled`|`revoked`),
  expires_at (nullable = never), last_used_at, last_used_ip, created_at
- **oauth_clients** — client_id, client_name, redirect_uris (JSON), logo_uri,
  token_endpoint_auth_method, status (`active`|`disabled`), created_at, last_used_at
- **oauth_grants** — id, user_id, client_id, scope, status (`active`|`revoked`),
  created_at, last_used_at  ← what the user's "Clients" page manages
- **oauth_auth_codes** — code_hash, client_id, user_id, redirect_uri,
  code_challenge, scope, resource, expires_at (~60s), consumed_at
- **oauth_tokens** — id, kind (`access`|`refresh`), token_hash, grant_id, family_id,
  expires_at, revoked_at, last_used_at
- **audit_log** — id, actor_user_id, action, target_type, target_id, meta (JSON),
  ip, created_at

Lifecycle semantics (tokens and grants alike):
- **Disable/enable** — reversible; token stays valid data but is rejected while disabled.
- **Revoke** — permanent; row kept for audit/history, can never authenticate again.
- **Delete** — removes the row (only allowed after revoke, or with confirm dialog that revokes+deletes).

---

## 4. Pages & routes

### Frontend (React Router 8, all state in search params — see rule)

| Route | Purpose | Search params |
|---|---|---|
| `/login` | Google sign-in button; error display | `?error=`, `?next=` |
| `/` | Overview: active token count, connected clients, recent access, expiring-soon warnings | — |
| `/tokens` | Create/manage personal access tokens | `?q=&status=&page=&sort=` |
| `/tokens/new` (modal route) | Name + optional expiry; shows token **once** with copy button | — |
| `/clients` | OAuth clients that have a grant from this user; disable/revoke/delete, last access | `?q=&status=&page=` |
| `/assistant` | Built-in chat assistant (Anthropic / OpenAI / Gemini via env keys); streaming, per-user persisted conversations | `?c=<conversation>&q=` |
| `/tools` | Browse the built-in MCP tools: description, annotations, parameter schemas | `?q=&tool=` |
| `/settings` | Account name, preferences | `?tab=profile\|preferences` |
| `/admin/users` | Admin: list/create users, enable/disable, role | `?q=&status=&role=&page=&sort=` |
| `/admin/clients` | Admin: all registered OAuth clients | `?q=&status=&page=` |
| `/admin/audit` | Admin: audit log | `?q=&action=&actor=&page=` |

Layout: sidebar app shell (admin section visible only to admins), route-level
auth guards via loader redirects, error boundaries, toast notifications.

### Backend API (all under `/api`, JSON, zod-validated, session-cookie auth + CSRF)

- `GET /api/me`, `PATCH /api/me` (display name, preferences), `DELETE /api/me/sessions/:id`
- `GET|POST /api/tokens`, `PATCH /api/tokens/:id` (enable/disable/rename),
  `POST /api/tokens/:id/revoke`, `DELETE /api/tokens/:id`
- `GET /api/clients` (user's grants), `PATCH /api/clients/:id` (disable/enable grant),
  `POST /api/clients/:id/revoke`, `DELETE /api/clients/:id`
- `GET /api/tools` — MCP tool catalog (accepts `q`), produced by running
  `tools/list` against a metadata-only MCP server so it never drifts from the
  real registrations
- Admin: `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`,
  `GET /api/admin/clients`, `PATCH /api/admin/clients/:id`, `GET /api/admin/audit`
- List endpoints accept `q`, `status`, `page`, `per_page`, `sort` — mirroring the
  frontend search params 1:1 so URLs are the single source of truth.
- Auth: `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`
- Health: `GET /healthz` (for container orchestration)

### MCP endpoint
- `ALL /mcp` — Streamable HTTP via `@hono/mcp`, guarded by the bearer middleware.
- System tool: `whoami` returns the authenticated user and auth method.
- Yahoo Finance tools: `search`, `quote`, `quoteSummary`, `chart`, `screener`,
  `trendingSymbols`, `options`, `insights`, `recommendationsBySymbol`, and
  `fundamentalsTimeSeries`.
- The process reuses one Yahoo Finance client for cookies and queueing. Each call
  has a timeout and result-size limit; inputs constrain symbol counts, date
  ranges, module names, screeners, and result counts.

---

## 5. Delivery phases

Each phase ends with typecheck + tests green and a commit.

1. **Scaffold** — package.json, TS, Vite 8 + React 19, Hono + node-server, Tailwind 4,
   unified dev server (`@hono/vite-dev-server`), `/healthz`, oxlint, `CLAUDE.md` rules,
   `.env.example`.
2. **DB layer** — Drizzle schema + migrations, boot-time migrate + admin seeding
   from `ADMIN_EMAILS`, config loader with zod-validated env.
3. **Auth** — Google OIDC flow, sessions, CSRF, auth middleware, login page,
   app shell with user menu + logout.
4. **Admin: user management** — users list (search/filter/paginate/sort via URL),
   create user by email, enable/disable, role toggle, audit entries.
5. **Access tokens** — tokens page, create-with-copy-once flow, optional expiry,
   enable/disable/revoke/delete, last-access display; PAT bearer middleware.
6. **OAuth 2.1 AS** — metadata endpoints, DCR, authorize + consent UI, token with
   PKCE + refresh rotation, revocation; user Clients page + admin clients page.
7. **MCP endpoint** — `@hono/mcp` wiring, both auth methods, `whoami` plus the 10
   read-only Yahoo Finance tools, `WWW-Authenticate` discovery; verified through
   an in-memory MCP client and optionally with MCP Inspector.
8. **Settings** — profile (display name), preferences (theme, page size), applied
   app-wide.
9. **Polish & hardening** — overview dashboard, audit log page, rate limiting on
   auth endpoints, security headers, session list/revoke UI, empty states, dark mode.
10. **Ship** — `Dockerfile` (multi-stage, node:24-alpine, non-root, healthcheck)
    and `docker-compose.yml` (`postgres:17-alpine` + named volume, env wired from
    `.env`) are already committed at the repo root; this phase verifies the
    container build end-to-end, adds boot-time migration + connection retry/wait,
    GitHub Actions CI (lint, typecheck, test against a Postgres service
    container, build, docker build), and the README.

---

## 6. Environment variables

```
PORT=5173
APP_URL=https://mcp.example.com        # public base URL (OAuth issuer, redirects)
DATABASE_URL=postgres://finance_mcp:finance_mcp@db:5432/finance_mcp
SESSION_SECRET=<32+ random bytes>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ADMIN_EMAILS=shinchven@gmail.com       # comma-separated; seeded as admins at boot
```

---

## 7. Recommended additions (beyond the requested features)

Included in the plan above:
- **Audit log** (admin page) — every security-relevant action recorded; cheap to add from day one, impossible to retrofit history later.
- **Overview dashboard** at `/` — active tokens, expiring-soon warnings, recent MCP access, connected clients.
- **Session management** in Settings — list active sessions (device/IP/last seen), revoke individually.
- **Copy-once token UX** — full token shown exactly once at creation; only prefix stored/displayed after.
- **Rate limiting** on `/auth/*`, `/oauth/token`, and bearer-auth failures; generic security headers (CSP, `X-Frame-Options`, etc.).
- **Refresh-token rotation with reuse detection** — stolen refresh tokens kill the whole token family.
- **`/healthz`** + graceful shutdown for container orchestration.
- **CI** (GitHub Actions) + **Vitest** integration tests for the auth-critical paths (PKCE flow, token lifecycle, disabled-user rejection).

Deferred (worth doing later, not in v1):
- **Token scopes** (e.g. read-only vs full MCP access) — schema has a `scope` column from the start so this is additive.
- **Structured logging** (pino) with request IDs, and optional OpenTelemetry.
- **Database backups** — scheduled `pg_dump` cron/sidecar example in the README (or point at the managed Postgres provider's backups).
- **Webhook/email notifications** for security events (new token created, token used from new IP).
- **Multiple identity providers** — the auth layer will be structured so adding GitHub/OIDC later is a new provider file, not a refactor.

---

## 8. Open decisions (defaults chosen; say the word to change)

1. **PostgreSQL + Drizzle** as the database (per your request), using the `pg` driver; docker-compose provides the database in dev and self-hosted deploys, and any managed Postgres works via `DATABASE_URL`.
2. **Login allowlist** — users must be pre-created by an admin before Google login works. Alternative: open signup with default `user` role.
3. **No shadcn/ui** — hand-rolled Tailwind components to keep the dependency surface small. Can adopt shadcn/ui if you prefer.
4. **TypeScript 7 (native)** — newest major; if any tool chokes on it we pin 5.9.x and note it.
