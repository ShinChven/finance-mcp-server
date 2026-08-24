/**
 * The product name, in one place.
 *
 * Pure string constants — no config, no imports — so both the Hono server and
 * the React bundle can pull from the same source. Renaming the product should
 * mean editing this file plus the assets it cannot reach (the repository name,
 * the GHCR image path, the Postgres role in `docker-compose*.yml`).
 *
 * The slug is deliberately distinct from the display name: it is what appears
 * in machine-readable positions — outbound `User-Agent` headers, and the
 * suggested config key in the connector setup guides — where a lowercase,
 * URL- and shell-safe token is expected.
 */

/** Display name, for page titles, headings and prose. */
export const BRAND_NAME = "Fintools";

/** Lowercase machine-safe form: config keys, User-Agent strings, CLI args. */
export const BRAND_SLUG = "fintools";

/**
 * The name this server reports in the MCP `initialize` handshake. Clients show
 * it when they list connected servers, so it is user-facing despite being a
 * protocol field.
 */
export const MCP_SERVER_NAME = BRAND_SLUG;
