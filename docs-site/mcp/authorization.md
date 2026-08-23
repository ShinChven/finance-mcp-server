# Authorization

`/mcp` accepts two credential types in parallel, and both resolve to the same
thing: a user. Every tool that touches user-owned rows — watchlists, notes,
skills — sees only that user's data, whichever method carried the request.

## Personal access tokens

A bearer token created on the **Access Tokens** page:

```
Authorization: Bearer mcp_...
```

Only the SHA-256 hash is stored, the full value is shown once at creation, and
each token carries optional expiry, an enable/disable switch and a last-access
timestamp.

Use these for scripts, self-hosted agents and any client that cannot run a
browser flow.

## OAuth 2.1

The deployment runs its own authorization server — this is unrelated to the
Google client used for dashboard sign-in.

| Feature | Spec |
|---|---|
| Discovery (protected resource) | RFC 9728 — `/.well-known/oauth-protected-resource` |
| Discovery (authorization server) | RFC 8414 — `/.well-known/oauth-authorization-server` |
| Dynamic client registration | RFC 7591 |
| PKCE | S256 required |
| Revocation | RFC 7009 |
| Refresh tokens | Rotated on every use, with reuse detection |

The flow an MCP client runs by itself:

1. It calls `/mcp` unauthenticated and gets a `401` naming the authorization
   server.
2. It fetches the discovery metadata.
3. It registers itself (RFC 7591) if it has no client ID.
4. It opens the authorization URL with a PKCE S256 challenge; you sign in and
   approve on the consent screen.
5. It exchanges the code for an access token and a refresh token, and rotates the
   refresh token from then on.

Exact `redirect_uri` matching is enforced, and a replayed refresh token
invalidates the whole chain rather than silently issuing another access token.

Two details matter if you are debugging a client that will not connect:

- **A refresh token repeated within 30 seconds of its rotation is treated as the
  same exchange arriving twice**, and answered with a fresh pair. Without that
  window, a deploy that interrupts a refresh — or a client that refreshes on two
  requests at once — reads as reuse and disconnects the client until someone
  re-authorizes it by hand. Past the window, or for a token revoked any other
  way, reuse detection still invalidates the family and writes an audit row.
- **Scopes are narrowed, not rejected.** A client that asks for `offline_access`,
  `openid` or anything else this server does not issue gets `mcp` back rather
  than `invalid_scope`, and the token response says what was actually granted.

## Which to choose

| Situation | Use |
|---|---|
| A desktop or web MCP client that supports OAuth | OAuth 2.1 — nothing to copy, revocable per client |
| A headless script or CI job | Personal access token |
| A shared machine | Personal access token with an expiry |

Revoking is symmetric: delete the token on **Access Tokens**, or revoke the grant
on **OAuth Clients**. Disabling the *user* cuts off both at once, and every
action lands in the audit log.
