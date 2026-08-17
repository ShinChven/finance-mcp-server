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
- **Finance MCP endpoint** — Streamable HTTP at `/mcp` with 10 read-only Yahoo
  Finance tools plus `whoami`; requests use the same PAT/OAuth 2.1 authorization
  layer as the rest of the MCP service.
- **China fund relationship layer** — 6 further tools that answer *which fund
  gives me exposure to this stock, sector or theme*, using an offline-ingested
  index of disclosed fund holdings rather than keyword search over fund names.
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
npm run dev            # one process: http://localhost:5173 (follows PORT)
```

Migrations run automatically at boot, and every `ADMIN_EMAILS` entry is seeded
as an active admin. Sign in with the matching Google account.

### Google OAuth setup

Create an OAuth client (type "Web application") at
[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
and add the redirect URI `{APP_URL}/auth/google/callback`
(e.g. `http://localhost:5173/auth/google/callback` for dev). Dev and production
share one port, so a single `APP_URL` and one registered redirect URI cover both.

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

### Available MCP tools

| Tool | Purpose |
|---|---|
| `search` | Find symbols, companies and related news |
| `quote` | Current or near-current quotes for up to 50 symbols |
| `quoteSummary` | Selected company, price, ownership, filing and fund modules |
| `chart` | Historical/intraday OHLCV data and market events |
| `screener` | Predefined screens such as gainers, losers and most active |
| `trendingSymbols` | Region-specific trending instruments |
| `options` | Option expiration dates and call/put chains |
| `insights` | Analyst research, developments and technical outlooks |
| `recommendationsBySymbol` | Related and similar instruments |
| `fundamentalsTimeSeries` | Financial statement data over time |

Yahoo covers CN and HK listings through symbol suffixes (`600519.SS`,
`0700.HK`), so the tools above already span the A-share, Hong Kong and US
markets. What Yahoo does not carry is China's domestic public funds — that is
what the tools below are for.

#### Fund relationship tools

| Tool | Purpose |
|---|---|
| `fundExposure` | Break a fund into sector/market exposure, with coverage and holdings stability |
| `fundsByStock` | Reverse index — which funds hold a given stock, ranked by weight |
| `fundsBySector` | Funds ranked by measured exposure to a sector or theme |
| `similarFunds` | Substitutes for a fund, by cosine similarity of exposure vectors |
| `themeToFunds` | Theme → tracking index / sector exposure / market exposure, in one call |
| `compareFunds` | Fees, size, top sectors and pairwise portfolio overlap for 2-10 funds |
| `fundPerformance` | Cumulative/annualized return, max drawdown and volatility from NAV history |

Two numbers accompany every holdings-derived answer, and both matter:

- **coverage** — the share of a fund's disclosed weight that could be
  classified. A 60% sector weight at 0.3 coverage is a much weaker claim than
  the same weight at 0.95.
- **holdings stability** — how much of the previous report the fund still
  holds. Index funds sit near 1.0; a low score means last quarter's portfolio no
  longer describes the fund and its inferred exposure should be discounted.

`themeToFunds` reports index-tracking matches separately from holdings-derived
ones because a declared mandate does not drift, while a holdings snapshot can.
The mandate itself (`跟踪标的`) comes from the fund profile page and is only
populated from that field — never from `业绩比较基准`, which for an active fund
is a blended benchmark and would make every active fund look like an index fund.

`fundPerformance` measures from cumulative NAV (累计净值) whenever the series
has it, so distributions are not read as losses — over a multi-year horizon that
difference compounds into a materially wrong number. The response states which
basis was used.

### Fund data ingest

The relationship tools read local tables only — no tool call ever hits an
upstream data source. Populate them from the **Fund Cache** page in the
dashboard, or from the CLI:

```sh
npm run build
npm run ingest:cn -- --limit=200            # QDII funds by default
npm run ingest:cn -- --types=index          # qdii | index | equity | all
npm run ingest:cn -- --types=qdii --dry-run # counts only, fetches nothing
npm run ingest:cn -- --codes=162411,270042  # specific funds
npm run ingest:cn -- --codes=162411 --skip-universe
npm run ingest:cn -- --types=qdii --force   # ignore the freshness windows
```

The job runs six steps: fund universe → per-fund profile detail (including
`跟踪标的`) → holdings → NAV history → sector classification via Yahoo
`assetProfile` (which covers CN, HK and US listings under one taxonomy) →
recomputed exposure.

**Freshness windows.** Each fund carries a per-step watermark, and a run skips
whatever is still current: profile detail for 30 days, holdings for 7, NAV for
1. The three differ because they age differently — a fund's profile barely
moves, portfolios are disclosed quarterly (re-checked weekly so a new quarter
lands within days of publication), and NAV changes every trading day. This is
what makes a repeat run cheap; `--force` overrides it.

**Share classes are ingested per fund code.** A fund's A/C/现汇/现钞 classes
share a portfolio, so fetching holdings once per class is redundant — but
deduplicating means inferring the grouping from the fund name, and there is no
share-class identifier in the upstream payload. A wrong grouping writes one
fund's holdings under another's code, and nothing surfaces it. Since NAV and
fees genuinely differ per class and must be fetched per code anyway, the
deduplication would only save about 14% of a run's requests. Correct by
construction beat it.

Per-fund failures are collected rather than fatal: the summary lists them and
the process exits non-zero, while everything that succeeded is still committed.
The last failure is also written to `funds.last_sync_error` so the dashboard can
show which funds are failing.

**Unparseable holdings are counted, not swallowed.** `holdingsDropped` in the
summary reports rows the parser could not read. A non-zero value means an
upstream format drift — the failure mode that once made Tokyo-coded positions
(`285A`) vanish from QDII portfolios with no error at all.

### Fund Cache dashboard page

`/funds` shows what is actually cached — fund count, holdings rows, distinct
stocks, latest report date — and lists every fund with its holdings count and
cache age, filterable by category and by cached / not cached / failing. Clicking
a fund opens its stored portfolio.

Admins can start a sync per category. Picking one opens a confirmation showing
how many funds it matches, how many are already fresh, how many will actually be
fetched, the request count and an estimated duration — nothing is fetched until
that is confirmed. A run is tracked in `ingest_jobs` with live progress and can
be stopped; it is single-flight, since two concurrent runs would double the
request rate against hosts that already throttle.

Syncs run in the server process, so a restart interrupts one; jobs left running
are marked failed at boot rather than appearing stuck forever.

> **Note on upstream formats.** The Eastmoney endpoints are undocumented and
> their response shapes were implemented from their known structure, not
> verified against live responses. All shape knowledge is isolated in
> `src/server/china/parse.ts` as pure functions with fixture-based tests, so a
> format change is a fixture-plus-parser fix that touches nothing else.

The theme crosswalk in `src/server/china/crosswalk.ts` is the one piece that
cannot be scraped — it maps a theme onto Eastmoney board names, Yahoo GICS
sectors and index names, which is what lets a single "半导体" query return both
onshore sector funds and QDII funds holding the same sector offshore. Extend it
by adding entries there.
| `whoami` | Current MCP user and authorization method |

Market data is provided through the unofficial `yahoo-finance2` integration and
may be delayed, unavailable, changed, or removed for delisted symbols. Tool
responses are capped at 1 MB; narrow large requests by symbol count, date range,
or summary modules.

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
