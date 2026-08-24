# What Is Fintools

Fintools is a containerized [Model Context
Protocol](https://modelcontextprotocol.io) server with a management dashboard.
It gives an AI client — Claude, Claude Code, Codex, Cursor, VS Code, Antigravity,
or anything that speaks MCP — a set of read-only market data tools, direct access
to SEC EDGAR, a cross-market index of disclosed fund holdings, and a small number
of tools that write: watchlists, notes and skills that belong to the signed-in
user.

Users sign in with Google and manage their own access tokens and OAuth 2.1
clients; admins manage users. Access is invitation-only.

## What it covers

| Area | What you get |
|---|---|
| Market data | 13 read-only Yahoo Finance tools — quotes, charts, screeners, options, fundamentals, news, insights, earnings analysis, crypto directory |
| Filings | 2 SEC EDGAR tools reading as-reported XBRL and the filing index |
| Funds | 8 tools over an offline-ingested holdings index spanning China public funds and US ETFs |
| Watchlists | 4 tools over the user's own saved lists, priced per request |
| Notes | 6 tools — the assistant's long-term memory, with bilingual full-text search |
| Skills | 3 tools plus MCP resources — procedures the user wrote for doing a task their way |
| Identity | `whoami` — the current MCP user and how they authorized |

## What makes it different from a data wrapper

**The fund relationship layer answers questions backwards.** Yahoo publishes a
top-ten list for US ETFs and nothing at all for China's domestic public funds,
and it has no way to ask *which funds hold this stock*. This server ingests
disclosed holdings into local tables, enriches every position with a GICS
sector, ISIN, country, exchange and USD market cap, and then answers exposure
questions in SQL — across markets, in one index.

**Every holdings-derived answer carries its own uncertainty.** Coverage (how
much of a fund's disclosed weight could be classified) and holdings stability
(how much of the previous report still stands) accompany the numbers, because a
60% sector weight at 0.3 coverage is a much weaker claim than the same weight at
0.95. See [Coverage & Stability](/concepts/coverage-and-stability).

**Notes and watchlists are shared state, not agent-private storage.** The rows an
agent writes are the rows `/notes` and `/watchlist` show, so a conversation and
the dashboard never diverge.

**No tool call hits an upstream source for fund data.** The relationship tools
read local tables only. Population is an explicit act — a sync from the
dashboard, a CLI run, or an on-demand fetch triggered by naming a fund.

## Stack

Hono · Vite · React 19 · React Router · TanStack Query · Tailwind CSS 4 ·
Drizzle ORM · PostgreSQL · TypeScript. One process serves everything: in
development Hono runs inside the Vite dev server, and in production Hono serves
the built SPA. See [Architecture](/guide/architecture).

## Next steps

- [Local Development](/guide/local-development) — run it on your machine
- [Docker Deployment](/guide/docker-deployment) — run it as a container
- [Connecting a Client](/mcp/connecting) — point an MCP client at it
