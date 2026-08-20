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
| `/admin/funds` | Admin: what is cached, per-category sync, per-fund portfolios |

## Fund Cache (admin)

Admin-only, and admin-only on the server too: the cache is shared
infrastructure — one copy of the holdings serves every user's tools — and
filling it costs hours of outbound requests against hosts that rate limit.
Everyone else reads what it produced, through the fund tools over MCP and the
pages built on them.

The page shows what is actually cached — fund count, holdings rows, distinct stocks,
latest report date — and lists every fund with its holdings count and cache age,
filterable by category and by cached / not cached / failing. Clicking a fund
opens its stored portfolio.

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
