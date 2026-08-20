# Market Data Tools

Thirteen read-only tools over Yahoo Finance. They cover US, A-share and Hong Kong
listings through symbol suffixes (`600519.SS`, `0700.HK`), plus crypto pairs like
`BTC-USD`.

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
| `earningsAnalysis` | Beats/misses, estimate revisions and the next report date |
| `cryptoTickers` | The crypto universe by market cap, with a Yahoo symbol per asset |

## `earningsAnalysis` — four calls collapsed into one

It stitches together four `quoteSummary` modules and does the arithmetic, so
answering *did they beat, and are estimates moving up or down* takes one call
instead of four plus manual work.

It reports estimate **revisions**, not just a current snapshot. A single estimate
says nothing about direction; the revision trend does.

## `cryptoTickers` — the one gap Yahoo leaves

Crypto needs no separate price tools: Yahoo quotes and charts pair symbols like
`BTC-USD` through `quote` and `chart`. What Yahoo does not publish is a
**directory** — a way to ask what the universe contains.

`cryptoTickers` fills exactly that gap. It lists assets by market cap from
CoinGecko's public tier and hands back the Yahoo symbol for each one, to chain
into the tools above. No API key is needed; `COINGECKO_API_KEY` is optional and
only raises the rate limit.

## What Yahoo does not carry

Yahoo publishes a top-ten list for US ETFs and nothing at all for China's
domestic public funds, and it has no way to ask the question backwards — *which
funds hold this stock*. That is what the [fund relationship
tools](/mcp/funds) are for, and why they read a locally ingested index instead
of an upstream API.

For as-reported rather than vendor-normalised US financials, and for a citable
filing URL, reach for the [SEC EDGAR tools](/mcp/sec-edgar) instead of
`fundamentalsTimeSeries`.

## Caveats

Market data comes through the unofficial `yahoo-finance2` integration and may be
delayed, unavailable, changed, or removed for delisted symbols. Tool responses
are capped at 1 MB — narrow a large request by symbol count, date range or
summary modules.
