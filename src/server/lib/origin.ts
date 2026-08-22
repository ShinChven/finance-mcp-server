import { config } from "../config.js";

/**
 * The origins that count as this server talking to itself.
 *
 * `APP_URL` is the configured truth; the `Host` header is accepted alongside it
 * so a deployment reached by an alternate hostname still works, which is the
 * same latitude the CSRF check has always taken.
 */
export function selfOrigins(host: string | undefined): Set<string> {
  const origins = new Set([config.appOrigin]);
  // Guarded, not interpolated blindly: without a Host header the templates
  // below would make the literal origins `http://undefined` and
  // `https://undefined` acceptable.
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return origins;
}

export function isSelfOrigin(origin: string, host: string | undefined): boolean {
  return selfOrigins(host).has(origin);
}
