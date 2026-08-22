# Dashboard Pages

The dashboard is the human half of every feature the MCP tools expose. Same
database rows, same vocabulary.

| Page | What it does |
|---|---|
| `/` | Overview |
| `/activity` | Recent activity |
| `/connector-setup` | Copy-ready setup guides per MCP client, OAuth and token both |
| `/tools` | Every registered MCP tool with its full input schema, read live from the server |
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
