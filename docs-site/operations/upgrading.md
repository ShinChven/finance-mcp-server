# Upgrading

## With the published image

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
docker compose -f docker-compose.ghcr.yml logs -f app
```

Migrations apply at boot, before the server listens, so there is no separate
migration step. The container reports `healthy` once `/healthz` answers.

If you pinned `APP_IMAGE` to a release tag, bump it in `.env` first. See
[Docker Image Publishing](/operations/docker-image#tag-scheme) for what each tag
tracks.

## Building from source

```bash
git pull
docker compose up -d --build
```

## Running on the host

```bash
git pull
npm ci
npm run build
npm start        # or restart the service unit
```

## Before you upgrade

- **Back up the database.** Migrations run automatically and are not reversed
  automatically — see [Database & Migrations](/operations/database#backups).
- **Check the release notes.** Each `v*` tag publishes a GitHub Release with
  generated notes and the matching pull command.

## After you upgrade

- `curl -fsS $APP_URL/healthz`
- Sign in, and confirm `/tools` still lists what you expect — it reads the live
  MCP registrations, so a missing tool shows up there immediately.
- Call `whoami` from one MCP client. Existing personal access tokens and OAuth
  grants survive an upgrade; a rotated `SESSION_SECRET` does not — it signs
  everyone out of the dashboard.

## Rolling back

Pin the previous image tag and bring the stack back up:

```bash
APP_IMAGE=ghcr.io/shinchven/finance-mcp-server:1.2.2 \
  docker compose -f docker-compose.ghcr.yml up -d
```

A rollback across a schema migration needs the database restored from the backup
taken before the upgrade — the migrations are forward-only.
