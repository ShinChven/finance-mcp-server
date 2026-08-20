# Providers & Ingest

A **provider** is one upstream source, declared in `src/shared/funds.ts` and
implemented in `src/server/funds/providers/<id>/`.

| Provider | Universe | Holdings | Cadence |
|---|---|---|---|
| `eastmoney` | China public funds, 6-digit codes | Quarterly report, top holdings only | re-checked weekly |
| `ishares` | iShares US ETFs, listing tickers | Full published portfolio | daily |

Each declares its own scopes and freshness windows, because the two age
differently: re-fetching a China quarterly report every day is waste, and caching
an iShares file for a week serves stale positions as current.

## Freshness windows

Every fund carries a per-step watermark, and a run skips whatever is still
current:

| Step | Window | Why |
|---|---|---|
| Profile detail | 30 days | A fund's profile barely moves |
| Holdings | 7 days | Portfolios are disclosed quarterly — re-checked weekly so a new quarter lands within days of publication |
| NAV | 1 day | It changes every trading day |

This is what makes a repeat run cheap. `--force` overrides it.

## Share classes are ingested per fund code

A fund's A/C/现汇/现钞 classes share a portfolio, so fetching holdings once per
class is redundant — but deduplicating means inferring the grouping from the fund
name, and there is no share-class identifier in the upstream payload. A wrong
grouping writes one fund's holdings under another's code, and nothing surfaces
it.

Since NAV and fees genuinely differ per class and must be fetched per code
anyway, the deduplication would only save about 14% of a run's requests. Correct
by construction beat it.

## Adding a provider

1. Implement `FundProvider` under `src/server/funds/providers/<id>/`, keeping all
   response-shape knowledge in a `parse.ts` of pure functions with fixture-based
   tests.
2. Add a descriptor to `src/shared/funds.ts` — scopes, freshness windows, code
   shape, units.

Nothing in the pipeline, the tables or the tools changes.

::: warning Upstream formats are undocumented
The Eastmoney and iShares endpoints are undocumented and change without notice.
All shape knowledge is isolated in each provider's `parse.ts`, so a format
change is a fixture-plus-parser fix that touches nothing else — and each fetch
layer raises what its parser cannot read, so a retired endpoint surfaces as an
error rather than as a source that appears to publish nothing.
:::

### The iShares planes

Two keyless JSON endpoints, both needing only a browser-like `User-Agent` (the
default one gets an HTML interstitial):

| Plane | Use |
|---|---|
| `product-screener-v3.1.jsn` | The whole US lineup in one request — the universe index and every fund's profile |
| `get-product-data?component=holdings.all` | One fund's complete published portfolio, keyed by portfolio id |

The per-fund holdings CSV at `…/1467271812596.ajax?fileType=csv` — which this
provider originally used — is retired. It answers with the product page's HTML
under a `text/csv` content type, or a 404, or a redirect to the closed-funds
page, depending on the fund. Read as CSV that is simply a file with no rows in
it, which is how the provider came to report every US ETF as holding nothing.

## Running an ingest

From the dashboard's admin **Fund Cache** page, or the CLI — see
[Fund Data Ingest](/operations/ingest).
