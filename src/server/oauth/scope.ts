/** Everything this server grants. `mcp` is the only gate every tool sits behind. */
export const SUPPORTED_SCOPES = ["mcp"];

/**
 * Narrows a requested scope to what this server actually grants.
 *
 * RFC 6749 §3.3 lets an authorization server issue a token with a *smaller*
 * scope than was asked for, and says so in the response. Failing the whole
 * authorization instead is what an unknown scope used to do here, and it locked
 * out clients that ask for extras as a matter of course: `offline_access` for a
 * refresh token, or `openid`/`profile` from an OIDC-shaped client. None of
 * those change what the caller can reach -- every MCP tool is behind `mcp` --
 * so dropping them is both correct and the difference between a client that
 * connects and one that cannot.
 *
 * Returns null only when nothing recognisable was asked for, which is a real
 * `invalid_scope`: the client wanted something this server does not have.
 */
export function narrowScope(requested: string): string | null {
  const asked = requested.split(/\s+/).filter(Boolean);
  if (asked.length === 0) return SUPPORTED_SCOPES.join(" ");
  // Ordered by SUPPORTED_SCOPES, not by the request, so the stored scope string
  // is stable -- the consent-skip check compares it for equality.
  const granted = SUPPORTED_SCOPES.filter((scope) => asked.includes(scope));
  return granted.length > 0 ? granted.join(" ") : null;
}
