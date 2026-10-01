# Dashboard Pages

The dashboard is the human half of every feature the MCP tools expose. Same
database rows, same vocabulary.

| Page | What it does |
|---|---|
| `/` | Overview |
| `/activity` | Recent activity |
| `/connector-setup` | Copy-ready setup guides per MCP client, OAuth and token both |
| `/tools` | Every registered MCP tool with its full input schema, read live from the server |
| `/markets` | Benchmarks across regions and your watchlist, priced live |
| `/symbol/:symbol` | One listing in depth: candles, indicators, statements, earnings, analysts, options, news, holders, filings |
| `/watchlist` | Saved lists, priced per request |
| `/notes` | Notes, collections, tag and symbol facets |
| `/skills` | Saved procedures — and where a draft written over MCP gets published |
| `/tokens` | Personal access tokens |
| `/clients` | The user's own OAuth grants |
| `/settings` | Account settings |
| `/admin/users` · `/admin/clients` · `/admin/audit` | User management, all registered clients, the full audit log |
| `/funds` | Fund search and portfolios; **Batch sync** tab (admin) for per-category runs |

## Funds

Open to every signed-in user. Search by fund code, name, tracked index or a
stock the fund holds, filter by market and category, and click a fund to open
its stored portfolio. A fund nobody has opened yet is
[fetched on the spot](/concepts/on-demand).

### Batch sync (admin)

A second tab on the same page, and the only restricted part. The split is by
cost, not by subject: opening one fund is a handful of throttled requests for a
fund already named, while a category run is hours of outbound requests against
hosts that rate limit, filling a cache every user shares, and single-flight
across the process — one person starting one blocks everyone else's.

The tab shows what is actually cached — fund count, holdings rows, distinct
stocks, latest report date — the funds whose last sync failed, and each
provider's index state. `/api/sync/*` and the cache statistics are admin-only
on the server, so hiding the tab is a courtesy rather than the check.

A sync is started per category. Picking one opens a confirmation showing
how many funds it matches, how many are already fresh, how many will actually be
fetched, the request count and an estimated duration — **nothing is fetched until
that is confirmed**.

A run is tracked in `ingest_jobs` with live progress and can be stopped. It is
single-flight: two concurrent runs would double the request rate against hosts
that already throttle.

Syncs run in the server process, so a restart interrupts one. Jobs left running
are marked failed at boot rather than appearing stuck forever.

## Markets and the symbol page

`/markets` is the board: US, Asian and European indices, rates, the dollar,
gold, oil and crypto, priced in one batched quote every thirty seconds, with
your watchlist beside it. Every tile opens that symbol's page.

`/symbol/NVDA` (or `0700.HK`, `600519.SS`, `BTC-USD`, `%5EGSPC`) is the page for
watching one name. Top to bottom:

- **Header** — price, change, pre/post-market print, session figures and the
  day and 52-week ranges. The quote refreshes every 15 seconds while its
  exchange is trading and every two minutes when it is not.
- **Chart** — candles or a line over 1D…Max. Daily candles up to a year,
  weekly over five, monthly over the whole history (or pick the width). MA
  20/50/200, EMA 20, Bollinger bands and VWAP (intraday) overlay the price;
  volume, MACD and RSI get their own panes. Indicators are computed in the
  browser from candles that include 200 periods of history before the window,
  so a 200-day average is defined at the left edge and toggling one never
  fetches. Your own levels, entry price, and the research provider's
  support/resistance are drawn across it. The forming daily candle follows the
  live quote.
- **Tabs** — Summary (key statistics, the business, a fund's holdings and
  sectors, your levels and notes, headlines, related names), Financials
  (income/balance/cash flow, annual or quarterly), Earnings (surprises,
  consensus, revisions), Analysis (targets, rating trend, technical outlook,
  bull/bear case, rating changes), Options (straddle chain, put/call ratios,
  max pain), News, Held by funds (the local holdings index plus institutional
  and insider tables) and SEC filings. Tabs a listing cannot fill — options or
  EDGAR outside the US, statements on an index — are not offered.

Every setting is a URL param (`tab`, `range`, `interval`, `style`, `ind`,
`statement`, `period`, `expiry`, `form`, `list`), so any view is a link. The
watchlist rides along the left; <kbd>j</kbd> / <kbd>k</kbd> step through it,
carrying the chart settings to the next name.

Each upstream read is cached in the server process for as long as it plausibly
stays the same (a quote for ten seconds, an options chain for a minute, a
profile for half an hour, statements for six hours), concurrent readers share
one fetch, and a per-user budget is charged only on a cache miss. Quotes come
from Yahoo Finance and may be delayed.

## Watchlists

Lists on the left, the selected list priced in the middle, and one item's price
levels in a third pane. Which list is open, the search text, the kind and level
filters, the sort and the open item all live in URL search params, so a
particular reading of a particular holding is a link.

Both the lists and the items in them are **dragged into order**, and that order
is stored — it is the one thing about a watchlist no computed column expresses.
Each row has a grab handle: a handle rather than the whole row, because on a
phone a draggable row and a scrollable page want the same gesture and only one
of them can have it. The handle works with mouse, finger and pen alike, scrolls
the page when a drag reaches the edge of the screen, and takes the arrow keys
for anyone not using a pointer at all.

Dragging is offered only in that manual order. Sorting by a column, searching or
filtering hides the rows a dropped item would be placed between, so the handles
go inert and a **My order** button appears to clear the view and hand them back.
Something newly added goes to the top, where it can be seen.

## Notes

Collections on the left with their counts, the tag and symbol facets under them,
results in the middle, and one note open in a dialog with a markdown preview.
Search text, collection, tag, symbol, status, sort, page and the open note all
live in URL search params — so a filtered view, or a specific note, is a link.

Cards show the summary and, when a search matched further down, a snippet
windowed around the hit. Bodies are fetched only for the note actually opened,
which is the same split the MCP tools use.

A note written by an assistant is marked as such. Deleting a collection keeps its
notes: they fall back to unfiled rather than disappearing with the folder.

## Tools

The tool list is not a hand-maintained page. It runs `tools/list` against a
metadata-only MCP server over an in-memory transport, so what you read is exactly
what a client sees — it cannot drift from the real registrations.
