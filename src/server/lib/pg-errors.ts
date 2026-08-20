/**
 * Postgres error classification, in one place.
 *
 * There were three copies of this check and all three were wrong the same way,
 * which is the argument for the file existing.
 */

/** `unique_violation` — a unique index rejected a write. */
const UNIQUE_VIOLATION = "23505";

/**
 * True when `error`, or anything it wraps, is a unique-constraint violation.
 *
 * The cause chain is the whole point. Drizzle wraps driver errors in its own
 * `Failed query: …` error, so the SQLSTATE that pg reported lives on `cause`
 * rather than on the error actually thrown. A check that reads only
 * `error.code` never matches — which meant every "that name is taken" branch in
 * this codebase was unreachable, and a duplicate surfaced to the dashboard as a
 * 500 instead of the 409 it knows how to render.
 *
 * Walking the chain rather than reaching for `cause` once keeps this true if a
 * future driver or pool adds another layer of wrapping.
 */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = error; current !== null && current !== undefined; ) {
    // A malformed `cause` cycle must not spin here.
    if (seen.has(current)) return false;
    seen.add(current);

    if (typeof current !== "object") return false;
    if ("code" in current && current.code === UNIQUE_VIOLATION) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
