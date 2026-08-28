/**
 * The boundary between "a price series" and "where prices come from".
 *
 * The fund pipeline already earns this shape: adding a market there means
 * adding a provider, never a branch inside the pipeline. Market data had no
 * such boundary — Yahoo was reached directly from every call site — which is
 * fine right up until the upstream changes shape or a licensed feed becomes
 * worth paying for, at which point the change is everywhere at once. It costs
 * one indirection now.
 *
 * Nothing above this interface may import the Yahoo client, and nothing in this
 * file may know what Yahoo calls its fields.
 */

/** One closed session. Every field is nullable: feeds do publish gaps. */
export interface DailyBar {
  /** Calendar date at the exchange — see `timezone.ts` for why that matters. */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  /** The raw print, which is what a price level was set against. */
  close: number | null;
  /** Dividend- and split-adjusted, which is what a return must be measured on. */
  adjClose: number | null;
  volume: number | null;
}

/** A point inside a session, carried as an instant rather than a date. */
export interface IntradayPoint {
  /** Epoch milliseconds; the axis renders it in the exchange's zone. */
  at: number;
  close: number | null;
}

export interface PriceEvent {
  date: string;
  kind: "split" | "dividend";
  /** Split only: new shares per old, so a four-for-one is 4. */
  factor: number | null;
  /** Dividend only, per share. */
  amount: number | null;
}

/** What a listing is, as far as a price series needs to know. */
export interface ListingMeta {
  /** IANA zone the bars' dates are computed in. */
  timezone: string;
  currency: string | null;
}

export interface DailyBarsResult extends ListingMeta {
  bars: DailyBar[];
  events: PriceEvent[];
}

export interface IntradayResult extends ListingMeta {
  points: IntradayPoint[];
  /** The regular session's previous close, so a 1D chart has a baseline. */
  previousClose: number | null;
}

/**
 * One upstream source of quoted prices.
 *
 * Implementations own every detail of their upstream — auth, throttling,
 * response shape, which of its fields mean what — and hand back only the shapes
 * above. A failure is thrown; callers decide whether that degrades a row or
 * fails a request.
 */
export interface MarketDataProvider {
  readonly id: string;
  /** Daily bars from `from` (inclusive) to the latest available. */
  fetchDailyBars(symbol: string, options: { from: string }): Promise<DailyBarsResult>;
  /** Intraday points over the last session, or the last five. */
  fetchIntraday(symbol: string, options: { days: 1 | 5 }): Promise<IntradayResult>;
}
