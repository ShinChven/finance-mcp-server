# Database & Migrations

PostgreSQL, accessed through Drizzle ORM with the `pg` driver. One connection
string: `DATABASE_URL`.

## Migrations apply themselves

The server applies pending Drizzle migrations at boot, before it starts
listening. A fresh volume needs no manual step — `docker compose up -d` on an
empty database produces a working deployment.

The migrator reads `drizzle/meta/_journal.json` and the `.sql` files. It never
reads the snapshot JSONs.

## Changing the schema

```bash
# 1. edit src/server/db/schema.ts
npm run db:generate   # emits a new migration under drizzle/
npm run db:migrate    # apply it locally (or just restart the server)
```

Two rules:

- **Never edit an applied migration file.** Add a new one.
- **The snapshot files stay in the repository.** `drizzle-kit generate` diffs
  `schema.ts` against the newest snapshot to work out the next migration;
  dropping them makes it re-emit the entire schema as if nothing existed.

`.gitattributes` marks the snapshots `linguist-generated` with `-diff`, so a
one-line column addition does not land as a ~2,400-line diff that buries the
actual review. `git diff --text` still shows them when you need it.

## Admin seeding

Every address in `ADMIN_EMAILS` is seeded as an active admin at boot, on every
start — so recovering access to a locked-out deployment means adding an address
there and restarting.

## Backups

The bundled compose stack keeps data in the named `pgdata` volume. Back it up the
ordinary way:

```bash
docker compose exec db pg_dump -U finance_mcp finance_mcp | gzip > backup.sql.gz

gunzip -c backup.sql.gz | docker compose exec -T db psql -U finance_mcp finance_mcp
```

The ingested fund tables are the largest part of a dump and are fully
reproducible from an [ingest run](/operations/ingest) — restoring them is a
convenience, not a requirement.

## Testing against a real database

```bash
npm run test:db   # requires DATABASE_URL
```

It executes every repo query with every filter combination inside a transaction
that is always rolled back, and is skipped when `DATABASE_URL` is unset. See
[The Fund Pipeline](/concepts/fund-pipeline#query-shape-tests) for why it exists.
