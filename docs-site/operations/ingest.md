# Fund Data Ingest

The [fund relationship tools](/mcp/funds) read local tables only — no tool call
ever hits an upstream data source. This page is how those tables get populated on
purpose, rather than by an
[on-demand fetch](/concepts/on-demand).

Two ways in: the **Batch sync** tab of the dashboard's Funds page (admin only), or
the CLI. Caching a *single* fund needs neither — any signed-in user opening a fund
on `/funds` fetches it.

## From the dashboard

An admin starts a sync per category on `/funds?tab=sync`. Picking one opens a confirmation
showing how many funds it matches, how many are already fresh, how many will
actually be fetched, the request count and an estimated duration — nothing is
fetched until that is confirmed.

A run is tracked in `ingest_jobs` with live progress and can be stopped. It is
single-flight: two concurrent runs would double the request rate against hosts
that already throttle.

Syncs run in the server process, so a restart interrupts one. Jobs left running
are marked failed at boot rather than appearing stuck forever.

## From the CLI

```bash
npm run build

npm run ingest -- --provider=eastmoney --scope=qdii --limit=200
npm run ingest -- --provider=ishares --scope=all
npm run ingest -- --provider=eastmoney --scope=index --dry-run   # counts only
npm run ingest -- --provider=eastmoney --codes=162411,270042
npm run ingest -- --provider=ishares --codes=IVV --skip-universe
npm run ingest -- --provider=eastmoney --scope=qdii --force      # ignore freshness
npm run ingest -- --provider=ishares --probe                     # diagnose a source
```

In a container:

```bash
docker compose exec app node dist/server/funds/ingest-cli.js \
  --provider=ishares --scope=all
```

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--provider=<id>` | `eastmoney` | `eastmoney` or `ishares` |
| `--scope=<id>` | the provider's default | Which slice of the universe to sync |
| `--codes=a,b,c` | — | Specific fund codes; implies scope `codes` |
| `--limit=<n>` | — | Cap the number of funds in this run |
| `--skip-universe` | off | Skip the universe step — for a known list of codes |
| `--dry-run` | off | Print the counts the dashboard would show, spending no requests |
| `--force` | off | Ignore freshness watermarks and refetch |
| `--probe` | off | Make one request per provider step and print what came back, writing nothing |

### Diagnosing a provider that caches nothing

`--probe` makes the same four calls a run makes — listing, profile, holdings,
NAV — against a single fund, stores nothing, and prints what each returned or
how it failed:

```bash
npm run ingest -- --provider=ishares --probe
npm run ingest -- --provider=ishares --probe --codes=IVV   # a fund of your choosing
```

Reach for it first when a provider's coverage stays at zero. The pipeline is
built to absorb per-fund failures so a run of thousands survives one dead fund,
and the parsers answer an unreadable response with an empty list — between them
they can turn a blocked endpoint into a source that merely looks empty. The
probe removes that tolerance for one fund, and exits non-zero if any step fails.

The Batch sync tab reports the other half: each provider card shows when its
fund index last loaded and the error if the listing failed, which is why a
provider showing zero funds is never ambiguous between "never synced" and
"cannot be reached".

### Scopes

| Provider | Scopes |
|---|---|
| `eastmoney` | `qdii`, `index`, `equity`, `all`, `codes` |
| `ishares` | `international`, `equity`, `fixed_income`, `all`, `codes` |

`--types` is kept as an alias for `--scope`, so existing cron entries do not
silently fall through to the default scope.

## Reading the summary

The CLI prints the run summary as JSON. Two fields deserve attention:

- **`errors`** — per-fund failures. They are collected rather than fatal:
  everything that succeeded is still committed, the process exits non-zero, and
  the last failure per fund is written to `funds.last_sync_error` so the
  dashboard can show which funds are failing.
- **`holdingsDropped`** — rows the parser could not read. A non-zero value means
  upstream format drift, which is worth investigating: this is the failure mode
  that once made Tokyo-coded positions (`285A`) vanish from QDII portfolios with
  no error at all.

The non-zero exit code lets a cron wrapper alert without the job having lost the
work that did land.

## Scheduling

A repeat run is cheap: each fund carries per-step watermarks (profile 30 days,
holdings 7, NAV 1) and a run skips whatever is still current. See
[Providers & Ingest](/concepts/providers#freshness-windows).

A reasonable baseline is a nightly run per provider over the scopes you care
about, sized first with `--dry-run`:

```text
30 2 * * *  cd /srv/finance-mcp-server && npm run ingest -- --provider=ishares --scope=all
0  3 * * *  cd /srv/finance-mcp-server && npm run ingest -- --provider=eastmoney --scope=qdii
```
