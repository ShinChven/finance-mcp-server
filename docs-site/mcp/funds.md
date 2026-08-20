# Fund Relationship Tools

Eight tools that answer *which fund gives me exposure to this stock, sector or
theme* — from an offline-ingested index of **disclosed holdings**, not keyword
search over fund names.

China public funds and US ETFs share one index, so asking who holds NVDA returns
both, tagged with the market each fund trades in.

| Tool | Purpose |
|---|---|
| `fundExposure` | Break a fund into sector/market exposure, with coverage and holdings stability |
| `fundsByStock` | Reverse index — which funds hold a given stock, ranked by weight |
| `fundsBySector` | Funds ranked by measured exposure to a sector or theme |
| `fundsByHoldings` | Funds ranked by weight in positions matching symbol / sector / country / market-cap criteria |
| `similarFunds` | Substitutes for a fund, by cosine similarity of exposure vectors |
| `themeToFunds` | Theme → tracking index / sector exposure / market exposure, in one call |
| `compareFunds` | Fees, size, top sectors and pairwise portfolio overlap for 2–10 funds |
| `fundPerformance` | Cumulative/annualized return, max drawdown and volatility from NAV history |

::: tip No tool call hits an upstream source
These tools read local tables only. Populate them from the **Funds** page or the
[ingest CLI](/operations/ingest) — or simply name a fund, which triggers an
[on-demand fetch](/concepts/on-demand).
:::

## `fundsByHoldings` — what federated data makes possible

It goes back to the raw positions and joins them against the enriched instrument
table, so criteria that were never precomputed — company size, country of
domicile, an explicit basket of symbols — can be combined in one query.

**Rank its results by `shareOfDisclosedPercent`, not `matchedWeightPercent`.**
The latter is a share of net assets and is structurally smaller for a fund that
discloses only its largest positions, so ranking by it compares disclosure
regimes rather than portfolios.

## `themeToFunds` — mandates and snapshots, reported separately

Index-tracking matches are reported apart from holdings-derived ones, because a
declared mandate does not drift while a holdings snapshot can.

The mandate itself (`跟踪标的`) is read from the fund profile page and only from
that field — never from `业绩比较基准`, which for an active fund is a blended
benchmark and would make every active fund look like an index fund.

The theme crosswalk in `src/server/funds/crosswalk.ts` is the one piece that
cannot be scraped: it maps a theme onto Eastmoney board names, Yahoo GICS sectors
and index names, which is what lets a single `半导体` query return both onshore
sector funds and QDII funds holding the same sector offshore. Extend it by adding
entries there.

## `fundPerformance` — measured from cumulative NAV

Whenever the series has it, returns are measured from cumulative NAV (累计净值),
so distributions are not read as losses — over a multi-year horizon that
difference compounds into a materially wrong number. The response states which
basis was used.

## Two numbers accompany every answer

Both matter, and both are in the response:

- **coverage** — the share of a fund's disclosed weight that could be classified.
- **holdings stability** — how much of the previous report the fund still holds.

See [Coverage & Stability](/concepts/coverage-and-stability) for how to read
them.

## Disclosure conventions differ, and the tools say so

`funds.holdings_completeness` records whether a fund's weights cover its whole
book (`full`) or only its largest positions (`top_holdings`). Tool responses
carry a note derived from it, and a result mixing both gets an explicit warning:
ranking funds by a disclosed sector weight across conventions measures reporting
rules, not portfolios.
