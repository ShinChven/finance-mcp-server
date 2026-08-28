/**
 * Exchange time.
 *
 * Nothing else in this server has needed a timezone: a quote carries a UTC
 * instant and a NAV carries a bare `YYYY-MM-DD`, so UTC was never wrong, only
 * unexamined. A price chart breaks that. A Hong Kong session drawn on the
 * reader's own clock is a chart that looks correct and is not, and the calendar
 * date a bar belongs to is a fact about the exchange rather than about anyone
 * looking at it: the New York close on 3 March is 04:00 UTC on 4 March, and
 * storing it under the 4th silently shifts every daily bar in the Americas.
 *
 * So every date here is computed in a named IANA zone, taken from the upstream
 * chart metadata rather than guessed from the symbol's suffix. The browser's
 * zone is never consulted, on the server or in the client.
 */

/**
 * Formatters are the expensive part of `Intl`, and a backfill converts
 * thousands of timestamps in the same zone. One per zone, kept for the life of
 * the process — there are a few dozen exchange zones in the world.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatters.set(zone, created);
  return created;
}

/**
 * Whether a zone name is one the runtime actually knows.
 *
 * Upstream metadata is not a trusted input: a zone this Node build cannot
 * resolve would otherwise throw in the middle of a backfill, thousands of bars
 * in. Callers use this to fall back to UTC deliberately instead.
 */
export function isKnownTimeZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    formatters.delete(zone);
    return false;
  }
}

/**
 * The calendar date an instant falls on, at the exchange.
 *
 * `en-CA` because it formats as `YYYY-MM-DD` natively, which is the shape every
 * date in this codebase already has. An unknown zone falls back to UTC rather
 * than throwing: a bar under a slightly wrong date is recoverable, a backfill
 * that dies halfway is not.
 */
export function toExchangeDate(epochMs: number, zone: string): string {
  try {
    return formatterFor(zone).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

/**
 * The first day of the current year, at the exchange.
 *
 * This is what makes a YTD window mean the same thing to a reader in Shanghai
 * and one in Chicago: the year turns over when it turns over on the exchange,
 * not when it turns over in UTC or on the reader's laptop.
 */
export function yearStartInZone(zone: string, now: Date = new Date()): string {
  return `${toExchangeDate(now.getTime(), zone).slice(0, 4)}-01-01`;
}

/**
 * A short label for the zone, for the caption under a chart.
 *
 * The zone is named on screen because an intraday axis is meaningless without
 * it — "10:30" is a different moment in three of the markets this app covers.
 */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
  } catch {
    return "UTC";
  }
}
