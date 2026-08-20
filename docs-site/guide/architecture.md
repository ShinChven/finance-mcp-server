# Architecture

One Node process serves the API, the SPA and the MCP endpoint. There is no
separate frontend server, no worker container and no queue service.

## Request paths

| Prefix | Handled by |
|---|---|
| `/api/*` | Hono JSON API — session cookie auth + CSRF, every body and query validated with zod |
| `/auth/*` | Google sign-in and callback |
| `/oauth/*`, `/.well-known/*` | The built-in OAuth 2.1 authorization server and its discovery metadata |
| `/mcp` | The MCP endpoint (Streamable HTTP), authorized by PAT or OAuth access token |
| `/healthz` | Liveness probe used by the container healthcheck |
| everything else | The React SPA — served by Vite in development, from `dist/web` in production |

In development, `@hono/vite-dev-server` mounts the Hono app inside Vite for the
backend prefixes above, so a single `npm run dev` on a single port serves both
halves. That matters for OAuth: dev and production share one `APP_URL`, so one
registered Google redirect URI covers both.

## Code layout

```
src/
├── server/          # Hono app
│   ├── routes/      # JSON API routes
│   ├── middleware/  # session, CSRF, auth
│   ├── oauth/       # authorization server
│   ├── mcp/         # MCP server, tool registrations, resources
│   │   └── tools/   # one file per tool
│   ├── funds/       # market-agnostic fund pipeline
│   │   └── providers/  # one upstream source each
│   ├── sec/         # EDGAR client
│   ├── crypto/      # CoinGecko client
│   ├── notes/  skills/  watchlist/
│   └── db/          # Drizzle schema, migrations, seed
├── web/             # React SPA (routes, components, lib)
└── shared/          # types and zod schemas used by both halves
```

Two layout rules are load-bearing:

- **Nothing in `src/server/funds/` may know about a specific market.** The
  pipeline (ingest, repo, exposure, on-demand cache) is market-agnostic.
- **Everything market-specific lives in a provider.** Code shapes, weight and
  size units, scope vocabulary and response parsing all belong to
  `src/server/funds/providers/<id>/`, behind the `FundProvider` interface.
  Adding a market means adding a provider plus a descriptor in
  `src/shared/funds.ts` — never a branch in the pipeline.

## Build

`npm run build` runs two steps:

1. `vite build` — the SPA into `dist/web`
2. `node scripts/build-server.mjs` — esbuild bundles `src/server/index.ts` and
   `src/server/funds/ingest-cli.ts` into `dist/server`, ESM, with `node_modules`
   left external

`npm start` runs `dist/server/index.js`, which waits for PostgreSQL, applies
Drizzle migrations, seeds `ADMIN_EMAILS` and then listens.

## Further reading

The full design document lives in the repository at
[`docs/PLAN.md`](https://github.com/ShinChven/finance-mcp-server/blob/main/docs/PLAN.md),
and project conventions in
[`CLAUDE.md`](https://github.com/ShinChven/finance-mcp-server/blob/main/CLAUDE.md).
