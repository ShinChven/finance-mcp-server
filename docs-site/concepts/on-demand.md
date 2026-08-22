# On-Demand Fetching

Naming a fund is request enough for its data. Opening an uncached fund in the
fund list on `/funds`, or calling `fundExposure`, `fundPerformance` or
`similarFunds` on one, fetches it there and then — three requests, a couple of seconds — instead of
returning an empty result and telling you to go run a batch job.

Four things keep that safe on a request path.

## One shared client per provider

The throttle is per client instance. An on-demand fetch holding its own client
while a category sync held another would quietly double the request rate against
a host that already throttles. Everything fetches through one client per
upstream.

## In-flight de-duplication

Ten agents asking about the same fund at once cause **one** fetch.

## The existing watermarks

A fund synced before is never re-fetched here. The test is *has this ever
synced*, not *does the data look useful* — so a fund with one NAV point or a thin
portfolio does not re-fetch on every call.

Refreshing genuinely stale data is the ingest run's job, not the request path's.

## A queue ceiling

Past **8 pending fetches**, callers are refused with a clear message rather than
silently enqueuing an hour of scraping.

## A failed fetch is reported as failed

The ingest steps collect per-fund failures rather than throwing, which is right
for a batch run and wrong for a caller waiting on one fund. So this path reads
back the watermarks each step writes and reports only what actually landed: a
fund whose upstream was blocked comes back `failed`, carrying the reason, rather
than `cached` with an empty portfolio behind it. The reason is also written to
the fund's `last_sync_error`, so the console's **failing** filter sees on-demand
failures and not only batch ones.

A code that matches no fund has one more chance before it is called unknown: if
a provider's index has never successfully loaded, it is loaded now and the
lookup retried — throttled, so a typo cannot trigger a listing call each time it
is retried. The previous answer sent people to run a universe refresh, which was
the very thing that had been failing.

## Classification runs against a deadline

Sector classification runs to a deadline rather than to completion, so a first
touch does not wait through a serial walk of every holding.

Whatever it misses shows up as lower [coverage](/concepts/coverage-and-stability)
on the exposure rows, and the tool response says so. The next full ingest fills
in the rest.
