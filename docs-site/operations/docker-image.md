# Docker Image Publishing

Images are built and pushed by
[`.github/workflows/docker.yml`](https://github.com/ShinChven/finance-mcp-server/blob/main/.github/workflows/docker.yml)
to the GitHub Container Registry:

```
ghcr.io/shinchven/finance-mcp-server
```

## When it runs, and what it produces

| Trigger | Platforms | Pushed | Tags |
|---|---|---|---|
| Pull request | `linux/amd64` | no | — |
| Push to `main` | `amd64` + `arm64` | yes | `latest`, `pr-<n>` where applicable |
| Push of a `v*` tag | `amd64` + `arm64` | yes | `1.2.3`, `1.2`, `1` |
| Manual dispatch | `amd64` + `arm64` | yes | as above |

A pull request builds `amd64` only. It exists to prove the `Dockerfile` still
builds, and cross-building `arm64` under QEMU doubles the wait for no extra
signal.

Changes touching only `docs-site/`, `docs/` or Markdown files skip the workflow —
those cannot change the image, and `.dockerignore` keeps them out of the build
context anyway.

Layer caching uses the GitHub Actions cache (`type=gha`, `mode=max`), so a
rebuild that only changed application source reuses the `npm ci` layer.

## Tag scheme

| Tag | Points at | Use it for |
|---|---|---|
| `latest` | The newest successful build of the default branch | Trying things out; it may be ahead of any release |
| `1.2.3` | An exact release | **Production** |
| `1.2` | The newest patch of that minor | Automatic patch updates |
| `1` | The newest minor of that major | Automatic minor updates |

Semver tags come from `docker/metadata-action`, which strips the leading `v` from
the git tag: pushing `v1.2.3` publishes `1.2.3`, `1.2` and `1`.

## Cutting a release

```bash
git tag v1.2.3
git push origin v1.2.3
```

That single push builds and pushes the multi-arch image, then creates a GitHub
Release with generated notes and the pull command for the new tag.

## Permissions

The workflow authenticates with the built-in `GITHUB_TOKEN` — no secret to
configure. It requests `packages: write` to push and `contents: write` to create
the release.

The first published image is **private** by default. To let others pull it
without credentials, open the package under the repository's *Packages*, then
**Package settings → Change visibility → Public**. It is a one-time change; later
pushes keep the setting.

## Pulling and running

```bash
docker pull ghcr.io/shinchven/finance-mcp-server:latest

APP_IMAGE=ghcr.io/shinchven/finance-mcp-server:1.2.3 \
  docker compose -f docker-compose.ghcr.yml up -d
```

For a private package, authenticate first with a personal access token that has
`read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <username> --password-stdin
```

See [Docker Deployment](/guide/docker-deployment) for the full stack.

## What is in the image

A multi-stage build on `node:24-alpine`:

1. **build** — `npm ci`, `npm run build`, then `npm prune --omit=dev`
2. **runtime** — `node_modules`, `dist`, `drizzle` and `package.json` only

It runs as the non-root `node` user, exposes `PORT` (default `5173`) and
healthchecks `/healthz` every 30s after a 15s start period. On start the server
waits for PostgreSQL and applies Drizzle migrations before it listens.
