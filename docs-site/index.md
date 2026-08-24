---
layout: home

hero:
  name: Fintools
  text: Market data, filings and fund relationships over MCP
  tagline: A self-hosted Model Context Protocol server with a management dashboard — Yahoo Finance, SEC EDGAR, a cross-market fund holdings index, watchlists, notes and skills, behind Google sign-in and OAuth 2.1.
  actions:
    - theme: brand
      text: What It Is
      link: /guide/introduction
    - theme: alt
      text: Deploy with Docker
      link: /guide/docker-deployment
    - theme: alt
      text: View on GitHub
      link: https://github.com/ShinChven/finance-mcp-server

features:
  - icon: 📈
    title: Market Data Tools
    details: Quotes, charts, screeners, options, fundamentals, news and an earnings analysis that stitches four modules into one answer — covering US, A-share and Hong Kong listings through Yahoo symbol suffixes.
    link: /mcp/market-data
    linkText: Market data tools
  - icon: 🗂️
    title: SEC EDGAR, Directly
    details: As-reported XBRL financials and the filing index, with the accession number and document URL behind every value — the source of record, not a vendor-normalised mirror.
    link: /mcp/sec-edgar
    linkText: EDGAR tools
  - icon: 🔎
    title: Cross-Market Fund Index
    details: Which fund gives me exposure to this stock, sector or theme — answered from an offline-ingested index of disclosed holdings. China public funds and US ETFs share one index, so asking who holds NVDA returns both.
    link: /mcp/funds
    linkText: Fund relationships
  - icon: 📝
    title: Notes & Watchlists
    details: The assistant's long-term memory and saved lists, backed by Postgres full-text search that works in English and Chinese. The same rows the dashboard shows — an agent and a person are never looking at different data.
    link: /mcp/notes
    linkText: Notes and search
  - icon: 🔐
    title: OAuth 2.1 Authorization Server
    details: PKCE S256, dynamic client registration, discovery metadata, refresh token rotation with reuse detection, and personal access tokens stored only as SHA-256 hashes.
    link: /mcp/authorization
    linkText: How auth works
  - icon: 🐳
    title: Self-Hosted, One Container
    details: One process serves the API, the SPA and the MCP endpoint. Multi-arch images are published to GHCR on every tag, and docker compose brings up the app with PostgreSQL 17.
    link: /guide/docker-deployment
    linkText: Deploy it
---

## One server, two audiences

The same rows are served to an MCP client and to a person:

- An **MCP endpoint** at `/mcp` (Streamable HTTP), authorized with either a
  personal access token or an OAuth 2.1 access token issued by the built-in
  authorization server.
- A **management dashboard** where the same user manages their tokens, OAuth
  clients, watchlists, notes and skills — and where admins invite users, review
  registered clients and read the audit log.

Nothing an agent writes is hidden from the person who owns it, and no tool call
reaches an upstream data source for fund questions: the relationship tools read
local tables that an explicit ingest run populated.

## Found a bug or have a request?

Please report it on
[GitHub Issues](https://github.com/ShinChven/finance-mcp-server/issues). Clear
reports with steps to reproduce help the most.
