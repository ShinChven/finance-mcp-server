# Configuration Reference

All configuration is environment variables, validated with zod at boot. An
invalid or missing required value throws before the server listens, listing every
problem at once — there is no partially-configured start.

Copy `.env.example` and fill it in:

```bash
cp .env.example .env
```

## Server

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `5173` | One port for every mode: the Vite dev server, the built server and the Docker image all listen here. |
| `APP_URL` | no | `http://localhost:5173` | Public base URL. The OAuth issuer, and the base of the Google redirect URI. Must match the URL you actually open. |
| `NODE_ENV` | no | `development` | `production` in the image. |

`APP_URL` is the single most consequential value. It is what MCP clients
discover the authorization server from, and `{APP_URL}/auth/google/callback` is
what Google matches as an exact string. A trailing slash is stripped; a mismatch
produces `redirect_uri_mismatch`.

## Database

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string. `docker compose` ignores this and builds its own URL from the bundled `db` service. |
| `POSTGRES_PASSWORD` | compose only | `finance_mcp` | Password for the bundled compose database. |

## Sessions and access

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SESSION_SECRET` | yes | — | 32+ bytes. `openssl rand -base64 32`. Rotating it signs everyone out. |
| `GOOGLE_CLIENT_ID` | yes | — | See [Google OAuth Setup](/guide/google-oauth). |
| `GOOGLE_CLIENT_SECRET` | yes | — | |
| `ADMIN_EMAILS` | yes on a fresh DB | — | Comma-separated emails seeded as active admins at boot. |

Access is invitation-only: an email that is neither in `ADMIN_EMAILS` nor invited
by an admin cannot sign in, even with a valid Google account.

## Upstream data sources

| Variable | Required | Notes |
|---|---|---|
| `SEC_EDGAR_CONTACT_EMAIL` | recommended | EDGAR requires a descriptive `User-Agent` with a contact address on every request, or it starts rejecting them. A maintainer address is compiled in as the default — set your own for any real deployment. |
| `COINGECKO_API_KEY` | no | `cryptoTickers` uses CoinGecko's public tier, which needs no key. A demo key only raises the rate limit. |

Yahoo Finance needs no credentials: the data is read through the unofficial
`yahoo-finance2` integration and may be delayed, unavailable or removed for
delisted symbols.

## Precedence

The server loads `.env` via `process.loadEnvFile()` and falls back to the real
environment when no file exists, so container environments (which set real
variables and ship no `.env`) work unchanged.
