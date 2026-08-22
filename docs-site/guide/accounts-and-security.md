# Accounts & Security

## Access is invitation-only

There is no self-service signup. An account exists because `ADMIN_EMAILS` seeded
it at boot, or because an admin invited that email. Signing in with an
unrecognised Google account fails at the door.

Admins manage users from **Admin → Users**: invite by email, enable or disable an
account, and change a role. Disabling an account cuts off the dashboard and every
token that account issued.

## Personal access tokens

Created on the **Access Tokens** page, with optional expiry.

- The full token is shown **once**, at creation. It is never retrievable
  afterwards.
- Only a **SHA-256 hash** is stored. A database dump does not yield usable
  credentials.
- Each token can be disabled, re-enabled, revoked or deleted, and carries a
  last-access timestamp so an unused token is easy to spot.

Send one as `Authorization: Bearer mcp_…`.

## OAuth 2.1 clients

The server is a full OAuth 2.1 authorization server for MCP clients:

- **PKCE (S256) required** — no plain challenges, no implicit grant
- **Dynamic client registration** (RFC 7591), so a client can onboard itself
- **Discovery metadata** (RFC 8414 / RFC 9728) at the well-known endpoints
- **Refresh token rotation with reuse detection** — a replayed refresh token
  invalidates the chain, outside a short grace window that exists so an ordinary
  retry (a deploy mid-refresh, two requests refreshing at once) is not mistaken
  for theft
- **Revocation** (RFC 7009)
- **An explicit consent screen** before any client gets a token

Users see and revoke their own grants on the **OAuth Clients** page; admins see
every registered client under **Admin → Clients**.

## Dashboard requests

Every state-changing API route requires session auth **and** CSRF protection, and
every request body and query is validated with zod through
`@hono/zod-validator`. Nothing is trusted because it came from the SPA.

## Audit log

Every security-relevant action writes an `audit_log` row — sign-ins, token
lifecycle, client registration and consent, user administration. **Admin → Audit**
reads it, filtered and paginated through URL search params like every other list
in the dashboard.

## What an agent is not allowed to do

The write tools are deliberately narrow, and the limits are the same in spirit
across features:

- An agent **cannot delete a watchlist or a note collection** — that discards
  accumulated notes and targets, so it lives on the dashboard behind a
  confirmation.
- An agent **will not fork a list or collection from a near-miss name** — an
  unrecognised name is an error listing the real ones, unless creation is asked
  for explicitly. Otherwise one typo silently starts a parallel list.
- A **skill written over MCP is a draft** and stays invisible to the tools until a
  person publishes it in the dashboard, so an agent cannot write itself an
  instruction and then follow it in the same session.

Nothing an agent writes is hidden: the same rows appear on `/notes`,
`/watchlist` and `/skills`.
