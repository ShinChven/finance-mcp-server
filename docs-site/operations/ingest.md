# Fund Data Ingest

The [fund relationship tools](/mcp/funds) read local tables only — no tool call
ever hits an upstream data source. This page is how those tables get populated on
purpose, rather than by an
[on-demand fetch](/concepts/on-demand).

Two ways in: the **Funds** page in the dashboard, or the CLI.

## From the dashboard

Admins start a sync per category on `/funds`. Picking one opens a confirmation
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
