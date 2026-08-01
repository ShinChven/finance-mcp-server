const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:"]);

/**
 * OAuth 2.1 redirect URI policy: https always; http only for loopback;
 * private-use schemes (vscode:, cursor:, …) allowed for native apps.
 */
export function validRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (FORBIDDEN_SCHEMES.has(parsed.protocol)) return false;
  if (parsed.protocol === "http:") return LOOPBACK_HOSTS.has(parsed.hostname);
  return true;
}
