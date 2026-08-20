# Docker Deployment

The repository ships a multi-stage `Dockerfile` (`node:24-alpine`, non-root, a
healthcheck on `/healthz`) and two compose files: one that builds from source and
one that pulls the published image from GHCR.

The server waits for PostgreSQL and applies Drizzle migrations before it starts
listening, so a fresh volume needs no manual migration step.

## Option A — the published image

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to GHCR by CI. See
[Docker Image Publishing](/operations/docker-image) for the tag scheme.

```bash
git clone https://github.com/ShinChven/finance-mcp-server.git
cd finance-mcp-server
cp .env.example .env      # set SESSION_SECRET, Google credentials, ADMIN_EMAILS, APP_URL

docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

`docker-compose.ghcr.yml` defaults to
`ghcr.io/shinchven/finance-mcp-server:latest`, which tracks the default branch
and may be newer than the latest release. For a stable deployment, pin a version
in `.env`:

```ini
APP_IMAGE=ghcr.io/shinchven/finance-mcp-server:0.1.0
```

## Option B — build from source

```bash
cp .env.example .env
docker compose up -d --build   # app + PostgreSQL 17 with a persistent volume
```

Both compose files start the same two services:

- `app` on `5173` (follows `PORT`)
- `db` — `postgres:17-alpine`, with a healthcheck and a named `pgdata` volume

The app's `DATABASE_URL` is built by compose from the bundled `db` service, so
the `DATABASE_URL` in `.env` is ignored there — it is for local development only.
Set `POSTGRES_PASSWORD` in `.env` for anything but a throwaway stack.

## Environment

`docker compose` refuses to start without `SESSION_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `ADMIN_EMAILS` — they are declared with `:?` so a
missing value fails loudly instead of booting a broken deployment.

`APP_URL` must be the **public** URL you actually open. It is the OAuth issuer
and the base of the Google redirect URI, and MCP clients discover the
authorization server from it. Behind a reverse proxy this is your HTTPS origin,
not `http://localhost:5173`.

```ini
APP_URL=https://finance.example.com
```

Then register `https://finance.example.com/auth/google/callback` in Google Cloud
Console — Google matches it as an exact string.

## Behind a reverse proxy

Terminate TLS at the proxy and forward to the container's port. The MCP endpoint
is Streamable HTTP, so the proxy must not buffer responses:

```nginx
location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

## Logs, updates and health

```bash
docker compose logs -f app
docker compose -f docker-compose.ghcr.yml pull && \
  docker compose -f docker-compose.ghcr.yml up -d      # update to a newer image
curl -fsS http://localhost:5173/healthz
```

The container healthcheck polls `/healthz` every 30s after a 15s start period, so
`docker compose ps` reports `healthy` once migrations are done and the server is
listening. See [Upgrading](/operations/upgrading) for what to check across
versions.
