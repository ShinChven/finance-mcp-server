/**
 * Stored daily bars, and the on-demand backfill that fills them.
 *
 * The reasoning is the same one `funds/ondemand.ts` sets out for fund holdings,
 * applied to prices: a reader who opens an instrument has already named it, so
 * fetching it there and then is right — provided the fetch is de-duplicated,
 * bounded, and cheap the second time.
 *
 * What makes it cheap the second time is that a closed session's bar never
 * changes. Once a day is stored it is answered from Postgres forever, and a
 * process restart costs a query rather than a burst of upstream requests. Only
 * the tail is ever re-fetched.
 */

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import { priceBarMeta, priceBars, priceEvents } from "../db/schema.js";
import type { DailyBar, MarketDataProvider, PriceEvent } from "./provider.js";
import { toExchangeDate } from "./timezone.js";

type Db = typeof Database;

/**
 * How long a symbol's tail is trusted before the provider is asked again.
 *
 * Long enough that clicking through a list costs nothing, short enough that a
 * chart opened after the close catches the day's bar. Intraday never comes from
 * here, so this does not govern how fresh a live price is — the quote does.
 */
export const BAR_FRESHNESS_MS = 15 * 60 * 1_000;

/**
 * Beyond this many fetches in flight, callers are refused rather than queued.
 *
 * A queue that grows without bound turns one agent looping over symbols into an
 * hour of scraping that everybody else waits behind. Refusing is recoverable;
 * an unbounded queue is not.
 */
export const MAX_IN_FLIGHT = 8;

export class BarFetchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarFetchRefused";
  }
}

export interface StoredBars {
  timezone: string;
  currency: string | null;
  bars: DailyBar[];
  events: PriceEvent[];
  /**
   * The full extent held, regardless of the slice returned.
   *
   * A caller windowing back from the series' own last observation needs to know
   * what that observation is before it can ask for the right slice — and asking
   * for a slice that turns out to be empty tells it nothing.
   */
  firstBar: string | null;
  lastBar: string | null;
}

/** The earliest date worth holding for any window the product offers. */
export function earliestUseful(now: Date = new Date()): string {
  // Ten years covers every range in the UI with room for the `max` case on a
  // listing younger than that; beyond it the rows stop earning their storage.
  return new Date(now.getTime() - 3_660 * 86_400_000).toISOString().slice(0, 10);
}

export interface BarStore {
  read(symbol: string, since: string): Promise<StoredBars | null>;
  ensure(symbol: string, since: string): Promise<StoredBars>;
  readMany(symbols: string[], since: string): Promise<Map<string, DailyBar[]>>;
}

export function createBarStore(db: Db, provider: MarketDataProvider): BarStore {
  /**
   * In-flight de-duplication.
   *
   * Ten readers opening the same symbol at once cause one fetch. Keyed by
   * symbol alone rather than by symbol and window, because the fetch always
   * writes everything it got: a narrower request arriving mid-flight is
   * satisfied by the wider one that is already running.
   */
  const inFlight = new Map<string, Promise<StoredBars>>();

  async function readMeta(symbol: string) {
    const [row] = await db
      .select()
      .from(priceBarMeta)
      .where(eq(priceBarMeta.symbol, symbol))
      .limit(1);
    return row ?? null;
  }

  async function readStored(symbol: string, since: string): Promise<StoredBars | null> {
    const meta = await readMeta(symbol);
    if (meta === null) return null;

    const [bars, events] = await Promise.all([
      db
        .select({
          date: priceBars.barDate,
          open: priceBars.open,
          high: priceBars.high,
          low: priceBars.low,
          close: priceBars.close,
          adjClose: priceBars.adjClose,
          volume: priceBars.volume,
        })
        .from(priceBars)
        .where(and(eq(priceBars.symbol, symbol), gte(priceBars.barDate, since)))
        .orderBy(asc(priceBars.barDate)),
      db
        .select({
          date: priceEvents.eventDate,
          kind: priceEvents.kind,
          factor: priceEvents.factor,
          amount: priceEvents.amount,
        })
        .from(priceEvents)
        .where(and(eq(priceEvents.symbol, symbol), gte(priceEvents.eventDate, since)))
        .orderBy(asc(priceEvents.eventDate)),
    ]);

    return {
      timezone: meta.timezone,
      currency: meta.currency,
      bars,
      events,
      firstBar: meta.firstBar,
      lastBar: meta.lastBar,
    };
  }

  async function write(
    symbol: string,
    fetched: { timezone: string; currency: string | null; bars: DailyBar[]; events: PriceEvent[] },
  ): Promise<void> {
    if (fetched.bars.length > 0) {
      // Chunked because a ten-year backfill is ~2,500 rows and one statement
      // with that many parameter groups is not worth the risk of a driver limit.
      for (let i = 0; i < fetched.bars.length; i += 500) {
        const chunk = fetched.bars.slice(i, i + 500);
        await db
          .insert(priceBars)
          .values(chunk.map((bar) => ({ symbol, barDate: bar.date, ...bar, date: undefined })))
          .onConflictDoUpdate({
            target: [priceBars.symbol, priceBars.barDate],
            // The tail is re-fetched on every ensure, and the last bar of a
            // live session changes until the close, so the newer copy wins.
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              adjClose: sql`excluded.adj_close`,
              volume: sql`excluded.volume`,
            },
          });
      }
    }

    if (fetched.events.length > 0) {
      await db
        .insert(priceEvents)
        .values(fetched.events.map((event) => ({ symbol, eventDate: event.date, ...event, date: undefined })))
        .onConflictDoNothing();
    }

    const [range] = await db
      .select({
        first: sql<string | null>`min(${priceBars.barDate})`,
        last: sql<string | null>`max(${priceBars.barDate})`,
      })
      .from(priceBars)
      .where(eq(priceBars.symbol, symbol));

    await db
      .insert(priceBarMeta)
      .values({
        symbol,
        timezone: fetched.timezone,
        currency: fetched.currency,
        firstBar: range?.first ?? null,
        lastBar: range?.last ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: priceBarMeta.symbol,
        set: {
          timezone: fetched.timezone,
          currency: fetched.currency,
          firstBar: range?.first ?? null,
          lastBar: range?.last ?? null,
          syncedAt: new Date(),
        },
      });
  }

  async function fetchAndStore(symbol: string, since: string): Promise<StoredBars> {
    const meta = await readMeta(symbol);

    // The first fetch for a symbol pulls the whole useful history rather than
    // just the window that was asked for. It is one request either way, and it
    // means every later range is answerable from storage — where fetching only
    // the requested window would leave `max` and `5y` re-fetching forever
    // because the stored history never reaches as far back as they ask.
    //
    // After that only the tail moves, stepped back a few days so a revised
    // close or a late-published bar is picked up.
    const from =
      meta !== null && meta.lastBar !== null
        ? new Date(Date.parse(`${meta.lastBar}T00:00:00Z`) - 5 * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : earliestUseful();

    const fetched = await provider.fetchDailyBars(symbol, { from });
    await write(symbol, fetched);
    const stored = await readStored(symbol, since);
    return (
      stored ?? {
        ...fetched,
        firstBar: fetched.bars[0]?.date ?? null,
        lastBar: fetched.bars.at(-1)?.date ?? null,
      }
    );
  }

  return {
    read: readStored,

    async ensure(symbol, since) {
      const meta = await readMeta(symbol);
      // Whatever is stored is the whole history the provider had, because the
      // first fetch asks for all of it. So freshness is only a question of when
      // the tail was last checked — not of how far back this caller asked, which
      // is what would otherwise make `max` re-fetch on every single open.
      const fresh =
        meta !== null &&
        meta.firstBar !== null &&
        Date.now() - meta.syncedAt.getTime() < BAR_FRESHNESS_MS;

      if (fresh) {
        const stored = await readStored(symbol, since);
        if (stored !== null) return stored;
      }

      const running = inFlight.get(symbol);
      if (running !== undefined) return running;

      if (inFlight.size >= MAX_IN_FLIGHT) {
        throw new BarFetchRefused(
          "Too many price histories are being fetched at once. Try again in a moment.",
        );
      }

      const promise = fetchAndStore(symbol, since).finally(() => inFlight.delete(symbol));
      inFlight.set(symbol, promise);
      return promise;
    },

    /**
     * Bars for many symbols at once, from storage only.
     *
     * Never fetches: this serves the list view, where a missing history means a
     * column renders without that row rather than fifty symbols each firing a
     * request behind a throttle two deep.
     */
    async readMany(symbols, since) {
      const out = new Map<string, DailyBar[]>();
      if (symbols.length === 0) return out;

      const rows = await db
        .select({
          symbol: priceBars.symbol,
          date: priceBars.barDate,
          open: priceBars.open,
          high: priceBars.high,
          low: priceBars.low,
          close: priceBars.close,
          adjClose: priceBars.adjClose,
          volume: priceBars.volume,
        })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, symbols), gte(priceBars.barDate, since)))
        .orderBy(priceBars.symbol, asc(priceBars.barDate));

      for (const row of rows) {
        const { symbol, ...bar } = row;
        const series = out.get(symbol);
        if (series === undefined) out.set(symbol, [bar]);
        else series.push(bar);
      }
      return out;
    },
  };
}

/** The exchange-local date a symbol's bars are current to, for staleness. */
export function barStaleness(lastBar: string | null, timezone: string, now = new Date()): string {
  if (lastBar === null) return "cached";
  return lastBar >= toExchangeDate(now.getTime(), timezone) ? "live" : "cached";
}
