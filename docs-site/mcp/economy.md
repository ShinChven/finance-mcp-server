# Economic Data Tools

Every other tool family here prices an instrument. These two read the economy
the instrument trades in — inflation, unemployment, GDP, policy rates, the
Treasury curve, money supply, sentiment, housing.

| Tool | Purpose |
|---|---|
| `economicSeries` | History for one indicator, with optional year-over-year or period-over-period transform |
| `economicRelease` | The latest print for up to eight indicators at once, with change, year-over-year move and staleness |

## No API key

The upstream is [DBnomics](https://db.nomics.world), a free aggregator run by
CEPREMAP that re-serves FRED, BLS, Eurostat, ECB, IMF, OECD and a long tail of
national statistics offices behind one JSON API. It needs no key and no
registration, which is the reason it was chosen: FRED's catalogue is reachable
without a FRED key, so every upstream in this server stays free.

There is no configuration. There is also no published rate limit, which is not
the same as there being none — responses are cached for an hour, because the
data underneath moves monthly at best.

## Two ways to name a series

**A catalogue id.** `indicator: "us-core-pce"` — a curated shortlist of the
series people actually ask for, because nothing knows offhand that core PCE is
`PCEPILFE`. Each entry carries its unit, its frequency, and an opinion about how
the number should be read.

**A raw path.** `seriesId: "Eurostat/prc_hicp_midx/M.I15.CP00.EA"` — any series
DBnomics holds, addressed as `provider/dataset/code`. The catalogue is a
convenience, never a limit; browse identifiers at
[db.nomics.world](https://db.nomics.world).

The catalogue is US-first because that is what "key economic data" usually
means in practice. Everything else goes through `seriesId`.

## Index series are returned as a change, not a level

"CPI is 320.4" answers no question anyone asked. Series marked as an index
therefore default to a year-over-year transform, while rates and levels are
reported exactly as published. Override with `transform`, which takes `none`,
`pop_pct` (period-over-period) or `yoy_pct`.

Changes are matched **by date, never by counting back N rows**. A daily yield
series skips weekends and holidays, a monthly series can carry a suspended
period, and a survey can be discontinued and resume — indexing back twelve rows
to find "a year ago" is right only for a series with no gaps.

## Read `staleDays` before calling a figure current

Economic data lags the period it measures: a CPI print lands weeks after the
month it describes, and a quarterly GDP revision months after the quarter. Every
`economicRelease` row reports how many days old the latest reading is, so a
three-month-old print is never mistaken for today's inflation.

`economicRelease` also survives partial failure: one indicator failing leaves
the rest of the snapshot intact, with the error reported on that row.
