# The Fund Pipeline

The fund relationship tools read local tables. This page is how those tables get
filled, and why the design is shaped the way it is.

## Six steps

An ingest run executes:

1. **Fund universe** — which funds exist in the requested scope
2. **Per-fund profile detail** — name, category, fees, size, tracking index
3. **Holdings** — disclosed positions with weights
4. **NAV history** — the price series
5. **Instrument enrichment** — from Yahoo, shared across providers
6. **Exposure recomputation** — the vectors the tools rank on

The first four belong to the provider. **The last two are shared**, which is what
makes exposure vectors from different markets directly comparable.

## Instrument enrichment is the join to everything else

One `quoteSummary` call per instrument yields the GICS sector — which covers CN,
HK and US listings under one taxonomy — *and* the attributes that make a
cross-source question answerable in SQL: ISIN, country of domicile, exchange and
market capitalization.

The step is watermark-driven on `instruments.profile_synced_at` with a 7-day
window, and **the watermark is set even when Yahoo returns nothing**, so an
uncovered symbol costs one request a week rather than one request per run.

### Market caps are stored twice

As reported, and converted to USD. The native column cannot be compared across
markets — filtering *above 10 billion* over a mixed JPY/USD/CNY column ranks by
currency, not by size — so every size filter uses the USD one. Rates come from
Yahoo, fetched once per currency per run.

## Market-agnostic by construction

Two rules keep a second market from leaking into the pipeline:

- Nothing in `src/server/funds/` may know about a specific market.
- Everything market-specific — code shapes, weight and size units, scope
  vocabulary, response parsing — lives in
  `src/server/funds/providers/<id>/`, behind the `FundProvider` interface.

Adding a market means adding a provider plus a descriptor in
`src/shared/funds.ts`. It never means adding a branch to the pipeline, a column
to the tables, or an argument to a tool.

## Failure handling

- **Per-fund failures are collected, not fatal.** The summary lists them and the
  process exits non-zero, while everything that succeeded is still committed. The
  last failure is written to `funds.last_sync_error` so the dashboard can show
  which funds are failing.
- **Unparseable holdings are counted, not swallowed.** `holdingsDropped` in the
  summary reports rows the parser could not read. A non-zero value means upstream
  format drift — the failure mode that once made Tokyo-coded positions (`285A`)
  vanish from QDII portfolios with no error at all.

## Query-shape tests

The SQL layer typechecks whatever it emits, and the tool tests mock the repo
away, so a statement Postgres rejects at parse time can pass the whole suite. One
did: `fundsByStock` failed on every call in production while CI was green.

- `repo-sql.test.ts` pins the statement shape offline.
- `npm run test:db` executes every repo query with every filter combination
  against a real database, inside a transaction that is always rolled back. It is
  skipped when `DATABASE_URL` is unset.
