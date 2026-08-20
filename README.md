# MCP Server

A containerized **Model Context Protocol (MCP) server** with a management dashboard.
Users sign in with Google, manage their own access tokens and OAuth 2.1 clients;
admins manage users. The MCP endpoint (Streamable HTTP at `/mcp`) accepts both
personal access tokens and OAuth 2.1 access tokens issued by the built-in
authorization server.

**Stack:** Hono · Vite · React 19 · React Router · TanStack Query · Tailwind CSS 4 ·
Drizzle ORM · PostgreSQL · TypeScript. One process serves everything — in dev,
Hono runs inside the Vite dev server; in production, Hono serves the built SPA.

**Documentation:** <https://shinchven.github.io/finance-mcp-server/> — built from
[`docs-site/`](docs-site/) with VitePress and deployed to GitHub Pages on every
push to `main`.

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
- **Cross-market fund relationship layer** — 6 further tools that answer *which
  fund gives me exposure to this stock, sector or theme*, using an
  offline-ingested index of disclosed fund holdings rather than keyword search
  over fund names. China public funds and US ETFs share one index, so asking
  who holds NVDA returns both, tagged with the market each fund trades in.
- **Notes with full-text search** — a place the assistant writes down what a
  conversation established (a thesis, a decision, the reasoning behind it) and
  finds it again later. Notes carry a summary for scanning, tags, links to the
  symbols they are about, and optional collections; 6 MCP tools read and write
  them, and the **Notes** page browses and edits the same rows. Search is
  Postgres full text over a stored `tsvector`, paired with substring matching so
  Chinese phrases and partial words match too.
- **Connector Setup guides** — in-dashboard, copy-ready setup guides for
  Claude, Claude Code, Codex, Cursor, VS Code, Antigravity 2, Gemini Spark and generic MCP clients,
  with both OAuth and personal-token instructions.
- **Admin** — user management (invite/enable/disable/role), all registered OAuth
  clients, full audit log, and the fund cache console.
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
docker compose up -d   # build from source: app + PostgreSQL 17, persistent volume
```

Or run the published image instead of building it:

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

`docker-compose.ghcr.yml` defaults to
`ghcr.io/shinchven/finance-mcp-server:latest`, which tracks `main`; pin a release
with `APP_IMAGE=ghcr.io/shinchven/finance-mcp-server:0.1.0` in `.env`. CI builds
multi-arch (`linux/amd64`, `linux/arm64`) images on every push to `main` and
publishes SemVer tags plus a GitHub Release for every `v*` tag — see
[`.github/workflows/docker.yml`](.github/workflows/docker.yml).

The image is a multi-stage build (`node:24-alpine`, non-root, healthcheck on
`/healthz`). The server waits for Postgres and applies migrations before
listening. Set `APP_URL` to the public HTTPS URL — it is the OAuth issuer.

## Connecting an MCP client

The MCP endpoint is `{APP_URL}/mcp` (Streamable HTTP).
After signing in, open `/connector-setup` for client-specific commands,
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
| `companyNews` | Recent headlines for a company, symbol or topic, newest first |
| `quote` | Current or near-current quotes for up to 50 symbols |
| `quoteSummary` | Selected company, price, ownership, filing and fund modules |
| `chart` | Historical/intraday OHLCV data and market events |
| `screener` | Predefined screens such as gainers, losers and most active |
| `trendingSymbols` | Region-specific trending instruments |
| `options` | Option expiration dates and call/put chains |
| `insights` | Analyst research, developments and technical outlooks |
| `recommendationsBySymbol` | Related and similar instruments |
| `fundamentalsTimeSeries` | Financial statement data over time |
| `earningsAnalysis` | Beats/misses, estimate revisions and the next report date, in one call |
| `cryptoTickers` | The crypto universe by market cap, with the Yahoo symbol for each asset |

`earningsAnalysis` stitches together four `quoteSummary` modules and does the
arithmetic, so answering "did they beat, and are estimates moving up or down"
takes one call instead of four plus manual work. It reports estimate
*revisions*, not just a current snapshot — a single estimate says nothing about
direction.

Crypto needs no separate price tools: Yahoo quotes and charts pair symbols like
`BTC-USD` through `quote` and `chart`. What it does not publish is a directory,
so `cryptoTickers` fills that one gap — it lists the universe by market cap from
CoinGecko's public tier and hands back the Yahoo symbol for each asset to chain
into the tools above. No API key: `COINGECKO_API_KEY` is optional and only
raises the rate limit.

Yahoo covers CN and HK listings through symbol suffixes (`600519.SS`,
`0700.HK`), so the tools above already span the A-share, Hong Kong and US
markets. What Yahoo does not carry is the *inside* of a fund: it publishes a
top-ten list for US ETFs and nothing at all for China's domestic public funds,
and it has no way to ask the question backwards. That is what the tools below
are for.

#### SEC EDGAR tools

For US issuers, EDGAR is the source of record that Yahoo mirrors — late,
partially, and without provenance. These tools read it directly.

| Tool | Purpose |
|---|---|
| `secFilings` | An issuer's filing index, newest first, with direct document URLs |
| `secFinancials` | As-reported XBRL financials as a time series, with the filing behind every value |

Reach for these over the Yahoo statement tools when you need as-reported rather
than vendor-normalised figures, restatement-accurate history, or a citable
filing URL. `secFinancials` deduplicates each period to its latest restatement
and carries the `us-gaap` concept and accession number for every value.

Coverage is SEC registrants only: non-US listings and most ADRs have no CIK, and
filers predating XBRL have no company facts. Both tools say so explicitly rather
than returning an empty result. EDGAR requires a contact address in the
`User-Agent` on every request — set `SEC_EDGAR_CONTACT_EMAIL`.

#### Fund relationship tools

| Tool | Purpose |
|---|---|
| `fundExposure` | Break a fund into sector/market exposure, with coverage and holdings stability |
| `fundsByStock` | Reverse index — which funds hold a given stock, ranked by weight |
| `fundsBySector` | Funds ranked by measured exposure to a sector or theme |
| `fundsByHoldings` | Funds ranked by weight in positions matching symbol / sector / country / market-cap criteria |
| `similarFunds` | Substitutes for a fund, by cosine similarity of exposure vectors |
| `themeToFunds` | Theme → tracking index / sector exposure / market exposure, in one call |
| `compareFunds` | Fees, size, top sectors and pairwise portfolio overlap for 2-10 funds |
| `fundPerformance` | Cumulative/annualized return, max drawdown and volatility from NAV history |

> **Query-shape tests.** The repo's SQL typechecks whatever it emits, and the
> tool tests mock the repo away, so a statement Postgres rejects at parse time
> can pass the whole suite — one did, and `fundsByStock` failed on every call in
> production while CI was green. `repo-sql.test.ts` pins the shape offline;
> `npm run test:db` (with `DATABASE_URL` set) executes every repo query with
> every filter combination against a real database, inside a transaction that is
> always rolled back. It is skipped when `DATABASE_URL` is unset.

`fundsByHoldings` is the tool that federated data makes possible: it goes back
to the raw positions and joins them against the enriched instrument table, so
criteria that were never precomputed — company size, country, an explicit basket
of symbols — can be combined in one query. Rank its results by
`shareOfDisclosedPercent` rather than `matchedWeightPercent`; the latter is a
share of net assets and is structurally smaller for a fund that discloses only
its largest positions.

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

#### Watchlist tools

The only tools that write. They read and edit the authenticated user's own
saved lists — the same rows the **Watchlists** page shows, so an assistant and
the dashboard are never looking at different things.

| Tool | Purpose |
|---|---|
| `watchlists` | The user's lists, with item counts — the cheap "what exists" call |
| `watchlist` | One list, priced: live quotes, fund NAV, notes, targets and a breadth summary |
| `watchlistAdd` | Add instruments or funds, with a note saying why |
| `watchlistRemove` | Drop items by symbol or fund code |

A list holds both kinds of thing at once: Yahoo symbols and 6-digit China fund
codes. A bare 6-digit ref is read as a fund code, since Yahoo's CN listings
always carry an exchange suffix (`600519.SS`), and `kind` overrides the guess.

Three deliberate limits on what an agent can do:

- **It cannot delete a list.** Removing one item is a small correction;
  discarding a list throws away accumulated notes and targets. That lives on
  the dashboard, behind a confirmation.
- **It will not fork a list from a near-miss name.** With lists already in
  place, an unrecognised name is an error listing the real ones unless
  `create: true` is passed — otherwise a single typo silently starts a parallel
  list, and the split only surfaces later. A user with no lists at all gets
  their first one made automatically; there is nothing to confuse it with.
- **It will not guess between several lists.** With more than one and no name
  given, the call fails and names the candidates.

Items store no prices. Values are fetched per request — Yahoo for instruments,
the local fund cache for funds — and the two are labelled `basis: "market"` and
`basis: "nav"` rather than blended: an intraday quote and a once-daily net asset
value are not the same measurement. Anything that could not be priced comes
back with `available: false` and a reason, so one bad symbol never costs you the
rest of the list. The summary weights every item equally; a watchlist records no
position sizes, so it cannot express a portfolio return.
#### Note tools

The assistant's long-term memory, and the other half of the **Notes** page.
Six tools, because storing and finding are different jobs:

| Tool | Purpose |
|---|---|
| `noteCollections` | Collections, tag vocabulary and tagged symbols with counts — the orientation call |
| `notesSearch` | Search and browse: full text, tags, symbols, collection, status, dates |
| `noteRead` | Full bodies for up to 5 notes, by id |
| `noteCreate` | Save what a conversation established |
| `noteUpdate` | Edit, append to, re-tag, file or archive one |
| `noteDelete` | Remove one note permanently |

**The summary is the load-bearing field.** `notesSearch` returns titles,
summaries and a snippet — never bodies — so an agent can scan fifty notes for
the two that matter and spend its context on those, via `noteRead`. The tool
descriptions ask for a summary on every write for exactly that reason.

**Searching works in both languages.** Bodies are indexed as a generated
`tsvector` (weighted title > summary > body, `simple` configuration) and matched
with `websearch_to_tsquery`, OR-ed with a substring match over title, summary,
body, tags and symbols. The vector finds whole words anywhere in a long body and
is GIN-indexed; the substring branch is what finds 降息 inside a Chinese
sentence, which no stock text-search parser will tokenize apart, and what
catches a half-remembered partial word. Ranking is `ts_rank_cd` plus a bump for a
title or summary hit, since the substring branch scores zero on its own.

**Filters compose, and the two composition rules differ on purpose.** `tags`
narrows — a note must carry every tag listed — because adding a tag is how you
cut a result set down. `symbols` widens — a note matches any symbol listed —
because "notes about NVDA or AMD" is the question people actually ask; a note is
rarely about every ticker in a basket.

Symbols use the watchlist's own vocabulary: a bare 6-digit code is a China fund,
anything else a Yahoo symbol, uppercased. One spelling serves both features, so
a note about `000834` and a watchlist item for it agree.

Three deliberate limits, mirroring the watchlist rules:

- **An agent cannot delete a collection.** That would unfile everything in it;
  it lives on the dashboard behind a confirmation. Deleting one *note* — a row
  it could equally have written — is allowed.
- **Archiving is the recommended default.** `status: "archived"` keeps a note
  searchable and out of the listing, and is reversible; deletion is not.
- **It will not fork a collection from a near-miss name.** An unrecognised name
  is an error listing the real ones unless `createCollection: true` is passed.

Nothing an agent writes is hidden from the person who owns it: the same rows are
listed, edited, filed and deleted on `/notes`.

#### Fetching a fund on demand

Naming a fund is request enough for its data. Opening an uncached fund in the
fund cache console, or calling `fundExposure`, `fundPerformance` or
`similarFunds` on one, fetches it there and then — three requests, a couple of seconds — instead
of returning an empty result and telling you to go run a batch job.

Four things keep that safe on a request path:

- **One shared client per provider.** The throttle is per client instance, so an
  on-demand fetch holding its own while a category sync held another would
  quietly double the request rate. Everything fetches through one per upstream.
- **In-flight de-duplication.** Ten agents asking about the same fund at once
  cause one fetch.
- **The existing watermarks.** A fund synced before is never refetched here —
  the test is "has this ever synced", not "does the data look useful", so a fund
  with one NAV point or a thin portfolio does not re-fetch on every call.
- **A queue ceiling.** Past 8 pending fetches, callers are refused with a clear
  message rather than silently enqueuing an hour of scraping.

Sector classification runs against a deadline rather than to completion, so a
first touch does not wait through a serial walk of every holding. Whatever it
misses shows up as lower `coverage` on the exposure rows, and the tool response
says so.

### Fund data ingest

The relationship tools read local tables only — no tool call ever hits an
upstream data source. An admin populates them from the **Fund Cache** page in the
dashboard, or from the CLI:

```sh
npm run build
npm run ingest -- --provider=eastmoney --scope=qdii --limit=200
npm run ingest -- --provider=ishares --scope=all
npm run ingest -- --provider=eastmoney --scope=index --dry-run  # counts only
npm run ingest -- --provider=eastmoney --codes=162411,270042
npm run ingest -- --provider=ishares --codes=IVV --skip-universe
npm run ingest -- --provider=eastmoney --scope=qdii --force     # ignore freshness
npm run ingest -- --provider=ishares --probe                    # diagnose a source
```

**`--probe` is the first thing to run when a provider caches nothing.** It makes
the same four calls the ingest does — listing, profile, holdings, NAV — against
one fund, writes nothing, and prints what each returned or how it failed. The
pipeline is deliberately tolerant (a fund that fails is collected into a summary
so a run of thousands survives it), and that tolerance is what hides a blocked
endpoint or a changed response format; the probe removes it.

The job runs six steps: fund universe → per-fund profile detail → holdings →
NAV history → instrument enrichment from Yahoo → recomputed exposure. The first
four are the provider's; the last two are shared, which is what makes exposure
vectors from different markets directly comparable.

**Instrument enrichment is the join to everything else.** One `quoteSummary`
call per instrument yields the GICS sector (which covers CN, HK and US listings
under one taxonomy) *and* the attributes that make a cross-source question
answerable in SQL — ISIN, country of domicile, exchange, market capitalization.
The step is watermark-driven on `instruments.profile_synced_at` with a 7-day
window, and the watermark is set even when Yahoo returns nothing, so an
uncovered symbol costs one request a week rather than one per run.

Market caps are stored twice: as reported, and converted to USD. The native
column cannot be compared across markets — filtering "above 10 billion" over a
mixed JPY/USD/CNY column ranks by currency, not by size — so every size filter
uses the USD one. Rates come from Yahoo, fetched once per currency per run.

**Providers.** A provider is one upstream source, declared in
`src/shared/funds.ts` and implemented in `src/server/funds/providers/`:

| Provider | Universe | Holdings | Cadence |
|---|---|---|---|
| `eastmoney` | China public funds, 6-digit codes | Quarterly report, top holdings only | re-checked weekly |
| `ishares` | iShares US ETFs, listing tickers | Full published portfolio | daily |

Each declares its own scopes and freshness windows, because they age
differently: re-fetching a China quarterly report every day is waste, and
caching an iShares file for a week serves stale positions as current. Adding a
third means implementing `FundProvider` and adding a descriptor — no change to
the pipeline, the tables, or the tools.

**Disclosure conventions differ, and the tools say so.** `funds.holdings_completeness`
records whether a fund's weights cover its whole book (`full`) or only its
largest positions (`top_holdings`). Tool responses carry a note derived from it,
and a result mixing both gets an explicit warning — ranking funds by a disclosed
sector weight across conventions measures reporting rules, not portfolios.

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

### Notes page

`/notes` is the dashboard half of the note tools. Collections on the left with
their counts, the tag and symbol facets under them, results in the middle, and
one note open in a dialog with a markdown preview. Search text, collection, tag,
symbol, status, sort, page and the open note all live in URL search params, so a
filtered view — or a specific note — is a link.

Cards show the summary and, when a search matched further down, a snippet
windowed around the hit. Bodies are fetched only for the note actually opened,
which is the same split the MCP tools use. A note written by an assistant is
marked as such, and deleting a collection keeps its notes: they fall back to
unfiled rather than disappearing with the folder.

### Fund cache page (admin)

`/admin/funds` shows what is actually cached — fund count, holdings rows, distinct
stocks, latest report date — and lists every fund with its holdings count and
cache age, filterable by category and by cached / not cached / failing. Clicking
a fund opens its stored portfolio.

The page is admin-only, and so is its API: the cache is shared infrastructure —
one copy of the holdings serves every user's tools — and filling it costs hours
of outbound requests against hosts that rate limit. Everyone else reads what it
produced, through the fund tools over MCP and the pages built on them.

A sync is started per category. Picking one opens a confirmation showing
how many funds it matches, how many are already fresh, how many will actually be
fetched, the request count and an estimated duration — nothing is fetched until
that is confirmed. A run is tracked in `ingest_jobs` with live progress and can
be stopped; it is single-flight, since two concurrent runs would double the
request rate against hosts that already throttle.

Syncs run in the server process, so a restart interrupts one; jobs left running
are marked failed at boot rather than appearing stuck forever.

> **Note on upstream formats.** The Eastmoney and iShares endpoints are undocumented and
> their response shapes were implemented from their known structure, not
> verified against live responses. All shape knowledge is isolated in
> each provider's `parse.ts` as pure functions with fixture-based tests, so a
> format change is a fixture-plus-parser fix that touches nothing else.

**When a source fails, it says so rather than reading as empty.** The parsers
answer an unreadable payload with an empty list — right for a pure function, and
dangerous one layer up, where "no funds" is a statement no real provider makes.
So each fetch layer raises what its parser cannot: an HTML challenge page, a
screener that yields no products, a holdings download with no positions table. A
listing that returns nothing never records as a loaded index — it leaves the
error on `fund_index_state` and the previous watermark in place, so the next
attempt is immediate and the Fund Cache page shows the reason next to the
provider's counts. On-demand fetches report the same way: a fund whose upstream
failed comes back `failed` with the reason, not `cached` with an empty
portfolio.

The theme crosswalk in `src/server/funds/crosswalk.ts` is the one piece that
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
| `npm run docs:install` / `docs:dev` / `docs:build` | The VitePress site in `docs-site/` |

## Architecture

See [`docs/PLAN.md`](docs/PLAN.md) for the full design and [`CLAUDE.md`](CLAUDE.md)
for project conventions (notably: URL search params are the source of truth for
all page-level UI state).

The [documentation site](https://shinchven.github.io/finance-mcp-server/) covers
deployment, configuration, every tool group and the fund pipeline in more depth;
its sources are in [`docs-site/`](docs-site/README.md).
