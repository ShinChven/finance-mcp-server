# Tool Index

Every tool the server registers, grouped by what it is for. The dashboard's
**Tools** page lists the same set with full input schemas, read live from the
running server through `tools/list` — so it can never drift from the real
registrations.

All tools are read-only except the watchlist, note and skill writers marked
below.

## Market data — [details](/mcp/market-data)

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

## SEC EDGAR — [details](/mcp/sec-edgar)

| Tool | Purpose |
|---|---|
| `secFilings` | An issuer's filing index, newest first, with direct document URLs |
| `secFinancials` | As-reported XBRL financials as a time series, with the filing behind every value |

## Fund relationships — [details](/mcp/funds)

| Tool | Purpose |
|---|---|
| `fundExposure` | Break a fund into sector/market exposure, with coverage and holdings stability |
| `fundsByStock` | Reverse index — which funds hold a given stock, ranked by weight |
| `fundsBySector` | Funds ranked by measured exposure to a sector or theme |
| `fundsByHoldings` | Funds ranked by weight in positions matching symbol / sector / country / market-cap criteria |
| `similarFunds` | Substitutes for a fund, by cosine similarity of exposure vectors |
| `themeToFunds` | Theme → tracking index / sector exposure / market exposure, in one call |
| `compareFunds` | Fees, size, top sectors and pairwise portfolio overlap for 2–10 funds |
| `fundPerformance` | Trailing returns (1D→5Y, max), cumulative/annualized return, max drawdown and volatility from NAV history |

## Watchlists — [details](/mcp/watchlists)

| Tool | Purpose | Writes |
|---|---|---|
| `watchlists` | The user's lists, with item counts | |
| `watchlist` | One list, priced: quotes, NAV, notes, targets, breadth summary | |
| `watchlistAdd` | Add instruments or funds, with a note saying why | ✓ |
| `watchlistRemove` | Drop items by symbol or fund code | ✓ |

## Notes — [details](/mcp/notes)

| Tool | Purpose | Writes |
|---|---|---|
| `noteCollections` | Collections, tag vocabulary and tagged symbols with counts | |
| `notesSearch` | Search and browse: full text, tags, symbols, collection, status, dates | |
| `noteRead` | Full bodies for up to 5 notes, by id | |
| `noteCreate` | Save what a conversation established | ✓ |
| `noteUpdate` | Edit, append to, re-tag, file or archive one | ✓ |
| `noteDelete` | Remove one note permanently | ✓ |

## Skills — [details](/mcp/skills)

| Tool | Purpose | Writes |
|---|---|---|
| `skills` | Find the user's saved procedures — names and when each applies | |
| `skillRead` | Read one skill's full procedure | |
| `skillSave` | Draft a skill (invisible until a person publishes it) | ✓ |

## Identity

| Tool | Purpose |
|---|---|
| `whoami` | Current MCP user and authorization method |
