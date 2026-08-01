# MCP Server

A containerized **Model Context Protocol (MCP) server** with a management dashboard.
Users sign in with Google, manage their own access tokens and OAuth 2.1 clients;
admins manage users. The MCP endpoint (Streamable HTTP at `/mcp`) accepts both
personal access tokens and OAuth 2.1 access tokens issued by the built-in
authorization server.

**Stack:** Hono · Vite · React 19 · React Router · TanStack Query · Tailwind CSS 4 ·
Drizzle ORM · PostgreSQL · TypeScript. One process serves everything — in dev,
Hono runs inside the Vite dev server; in production, Hono serves the built SPA.

## Features

- **Google sign-in only** — no passwords. Access is invitation-only: admins invite
  users by email; `ADMIN_EMAILS` seeds admin accounts at boot.
- **Personal access tokens** — optional expiry, enable/disable, revoke/delete,
  copy-once display, last-access tracking. Only SHA-256 hashes are stored.
- **OAuth 2.1 authorization server** — PKCE (S256) required, dynamic client
  registration (RFC 7591), discovery metadata (RFC 8414/9728), refresh token
  rotation with reuse detection, revocation (RFC 7009), consent screen.
- **MCP endpoint** — Streamable HTTP at `/mcp` with `whoami` and `echo` starter
  tools; add tools under `src/server/mcp/`.
- **Client integration center** — in-dashboard, copy-ready setup guides for
  Claude, Claude Code, Codex, Cursor, Antigravity 2 and generic MCP clients,
  with both OAuth and personal-token instructions.
- **Admin** — user management (invite/enable/disable/role), all registered OAuth
  clients, full audit log.
- **Built-in chat assistant** — streaming chat with the latest Anthropic
  (Claude Opus 4.8 / Sonnet 5 / Haiku 4.5), OpenAI (GPT-5.6 family), and Google
  Gemini (3.1 Pro / 3.5 Flash / 3.5 Flash-Lite / 3.6 Flash) models. API keys come from the environment
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` — any subset);
  conversations are persisted per user with a model picker per conversation.
- **URL-driven UI** — search, filters, pagination, sorting and tabs all live in
  URL search params, so every view is shareable and back/forward-safe.

## Quick start (development)

Requirements: Node 22+, PostgreSQL.

```sh
cp .env.example .env   # fill in DATABASE_URL, SESSION_SECRET, Google credentials, ADMIN_EMAILS
npm install
npm run dev            # one process: http://localhost:5173
```

Migrations run automatically at boot, and every `ADMIN_EMAILS` entry is seeded
as an active admin. Sign in with the matching Google account.

### Google OAuth setup

Create an OAuth client (type "Web application") at
[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
and add the redirect URI `{APP_URL}/auth/google/callback`
(e.g. `http://localhost:5173/auth/google/callback` for dev).

## Deployment (Docker)

```sh
cp .env.example .env   # set SESSION_SECRET, Google credentials, ADMIN_EMAILS, APP_URL
docker compose up -d   # app + PostgreSQL 17 with a persistent volume
```

The image is a multi-stage build (`node:24-alpine`, non-root, healthcheck on
`/healthz`). The server waits for Postgres and applies migrations before
listening. Set `APP_URL` to the public HTTPS URL — it is the OAuth issuer.

## Connecting an MCP client

The MCP endpoint is `{APP_URL}/mcp` (Streamable HTTP).
After signing in, open `/integrations` for client-specific commands,
configuration files, authentication steps and troubleshooting.

- **OAuth 2.1 (recommended):** point the client at the URL; it discovers the
  authorization server via `/.well-known/oauth-protected-resource`, registers
  itself, and sends you to the consent screen. Manage/revoke access on the
  **OAuth Clients** page.
- **Personal access token:** create one on the **Access Tokens** page and send
  it as `Authorization: Bearer mcp_…`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (SPA + backend, single process) |
| `npm run build` / `npm start` | Production build / run |
| `npm run typecheck` · `npm run lint` · `npm run test` | Checks (run in CI) |
| `node scripts/smoke.mjs` | End-to-end smoke test against a running dev server |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |

## Architecture

See [`docs/PLAN.md`](docs/PLAN.md) for the full design and [`CLAUDE.md`](CLAUDE.md)
for project conventions (notably: URL search params are the source of truth for
all page-level UI state).
