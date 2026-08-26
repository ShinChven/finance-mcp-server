/**
 * Yahoo Finance as a market-data provider.
 *
 * Everything Yahoo-shaped lives here: which field carries the adjusted close,
 * that a split arrives as a numerator over a denominator rather than a factor,
 * that the zone is on the chart metadata rather than the rows. Above this file
 * a bar is a bar.
 *
 * The client is injected rather than imported so the same throttle and cookie
 * jar are shared with the MCP tools and the fund pipeline — a second client
 * would double the rate against a host that already answers 403 when it feels
 * crowded.
 */

import type { ChartOptionsWithReturnArray } from "yahoo-finance2/modules/chart";
import type { YahooFinanceClient } from "../../mcp/client.js";
import { yahooRequestOptions } from "../../mcp/tools/runtime.js";
import { isKnownTimeZone, toExchangeDate } from "../timezone.js";
import type { DailyBar, IntradayPoint, MarketDataProvider, PriceEvent } from "../provider.js";

/** Yahoo's own fallback when the metadata carries no usable zone. */
const FALLBACK_ZONE = "UTC";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function instant(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1_000;
  }
  return null;
}

function readMeta(result: Record<string, unknown>): { timezone: string; currency: string | null } {
  const meta = (result["meta"] ?? {}) as Record<string, unknown>;
  const zone = typeof meta["exchangeTimezoneName"] === "string" ? meta["exchangeTimezoneName"] : "";
  const currency = typeof meta["currency"] === "string" ? meta["currency"] : null;
  return { timezone: zone !== "" && isKnownTimeZone(zone) ? zone : FALLBACK_ZONE, currency };
}

/**
 * Splits arrive as a ratio, and the two spellings disagree.
 *
 * `splitRatio` is a display string ("4:1") whose order Yahoo has not always
 * been consistent about, while numerator and denominator are numbers. Deriving
 * the factor from the numbers is the only version that cannot be read
 * backwards, and a backwards split factor would rescale a level the wrong way.
 */
function splitFactor(event: Record<string, unknown>): number | null {
  const numerator = num(event["numerator"]);
  const denominator = num(event["denominator"]);
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function readEvents(result: Record<string, unknown>, zone: string): PriceEvent[] {
  const events = (result["events"] ?? {}) as Record<string, unknown>;
  const out: PriceEvent[] = [];

  const splits = events["splits"];
  if (Array.isArray(splits)) {
    for (const entry of splits as Record<string, unknown>[]) {
      const at = instant(entry["date"]);
      const factor = splitFactor(entry);
      if (at === null || factor === null) continue;
      out.push({ date: toExchangeDate(at, zone), kind: "split", factor, amount: null });
    }
  }

  const dividends = events["dividends"];
  if (Array.isArray(dividends)) {
    for (const entry of dividends as Record<string, unknown>[]) {
      const at = instant(entry["date"]);
      const amount = num(entry["amount"]);
      if (at === null || amount === null) continue;
      out.push({ date: toExchangeDate(at, zone), kind: "dividend", factor: null, amount });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function createYahooMarketProvider(client: YahooFinanceClient): MarketDataProvider {
  async function chart(
    symbol: string,
    options: Omit<ChartOptionsWithReturnArray, "return">,
  ): Promise<Record<string, unknown>> {
    const result = await client.chart(
      symbol,
      { ...options, return: "array" } as ChartOptionsWithReturnArray,
      yahooRequestOptions(),
    );
    return result as unknown as Record<string, unknown>;
  }

  return {
    id: "yahoo",

    async fetchDailyBars(symbol, { from }) {
      const result = await chart(symbol, {
        period1: from,
        interval: "1d",
        // Requested by name because the adjusted series alone cannot explain a
        // fall: a level set before a split needs the split itself.
        events: "div|split",
      });
      const { timezone, currency } = readMeta(result);

      const quotes = Array.isArray(result["quotes"]) ? (result["quotes"] as unknown[]) : [];
      const bars: DailyBar[] = [];
      for (const row of quotes) {
        if (typeof row !== "object" || row === null) continue;
        const quote = row as Record<string, unknown>;
        const at = instant(quote["date"]);
        if (at === null) continue;
        bars.push({
          date: toExchangeDate(at, timezone),
          open: num(quote["open"]),
          high: num(quote["high"]),
          low: num(quote["low"]),
          close: num(quote["close"]),
          adjClose: num(quote["adjclose"]),
          volume: num(quote["volume"]),
        });
      }

      return { timezone, currency, bars, events: readEvents(result, timezone) };
    },

    async fetchIntraday(symbol, { days }) {
      // Yahoo serves intraday over a short window only — a few days at
      // 5-minute granularity — so this is the whole of what it can answer, and
      // the reason nothing here is persisted.
      const start = new Date(Date.now() - (days + 2) * 86_400_000);
      const result = await chart(symbol, {
        period1: start.toISOString().slice(0, 10),
        interval: "5m",
      });
      const { timezone, currency } = readMeta(result);
      const meta = (result["meta"] ?? {}) as Record<string, unknown>;

      const quotes = Array.isArray(result["quotes"]) ? (result["quotes"] as unknown[]) : [];
      const points: IntradayPoint[] = [];
      for (const row of quotes) {
        if (typeof row !== "object" || row === null) continue;
        const quote = row as Record<string, unknown>;
        const at = instant(quote["date"]);
        const close = num(quote["close"]);
        // A gap inside the session is dropped rather than carried forward: a
        // flat run invented from nulls is a claim the feed never made.
        if (at === null || close === null) continue;
        points.push({ at, close });
      }

      return {
        timezone,
        currency,
        points,
        previousClose: num(meta["chartPreviousClose"]) ?? num(meta["previousClose"]),
      };
    },
  };
}
