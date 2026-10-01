/**
 * Defensive readers for upstream payloads.
 *
 * Yahoo declares nearly every field optional and coverage varies by listing,
 * so every normaliser in this directory reads through these rather than
 * trusting a declared type: a field that is missing, mistyped or non-finite
 * comes back as null, and null is rendered as absent rather than as zero.
 */

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}

export function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Some modules wrap numbers as `{ raw, fmt }` when asked for formatted output.
  if (isRecord(value)) return num(value["raw"]);
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A fraction as a percentage, rounded to keep payloads honest. */
export function pct(value: unknown, digits = 2): number | null {
  const fraction = num(value);
  return fraction === null ? null : round(fraction * 100, digits);
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * A date as `YYYY-MM-DD`.
 *
 * Yahoo hands back `Date`s from the validated modules, epoch seconds from some
 * raw fields and epoch milliseconds from others; anything past 1e11 can only
 * be milliseconds.
 */
export function isoDate(value: unknown): string | null {
  const instant = isoInstant(value);
  return instant === null ? null : instant.slice(0, 10);
}

export function isoInstant(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value > 1e11 ? value : value * 1_000).toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (isRecord(value)) return isoInstant(value["raw"]);
  return null;
}
