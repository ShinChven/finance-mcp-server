# Google OAuth Setup

The dashboard has **no password login**. Google sign-in is the only way in, so
these credentials are required before anyone can use the deployment.

## 1. Create the client

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
create an OAuth client of type **Web application**.

## 2. Register the redirect URI

Add exactly one authorized redirect URI, derived from `APP_URL`:

```
{APP_URL}/auth/google/callback
```

| Deployment | Redirect URI |
|---|---|
| Local development | `http://localhost:5173/auth/google/callback` |
| Production | `https://finance.example.com/auth/google/callback` |

Google matches this as an exact string. A different port, a missing path segment
or `http` where you configured `https` all produce `redirect_uri_mismatch`.

Development and production share one port by design, so a single `APP_URL` and a
single registered redirect URI cover both — you only need a second entry if you
actually run a second public origin.

## 3. Put the credentials in the environment

```ini
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_URL=https://finance.example.com
ADMIN_EMAILS=you@example.com
```

Every address in `ADMIN_EMAILS` is seeded as an active admin at boot. Sign in
with the matching Google account, then invite the rest of your users from
**Admin → Users**.

## Not to be confused with the MCP OAuth server

This page is about *signing in to the dashboard*. The OAuth 2.1 flow that an
**MCP client** uses is a separate, built-in authorization server that this
deployment runs itself — no Google client involved. See
[Authorization](/mcp/authorization).
