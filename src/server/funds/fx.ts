/**
 * Currency conversion for the one figure that has to be comparable across
 * markets: market capitalization.
 *
 * A holdings index spanning China, Hong Kong, Japan and the US carries market
 * caps in four currencies. Filtering "above 10 billion" over that column
 * unconverted ranks by currency rather than by size — a ¥1.4tn Japanese company
 * outranks a $9bn American one by a factor of 150 for no reason at all. So the
 * enrichment step stores both the native figure and a USD one, and this is
 * where the second comes from.
 *
 * Rates are fetched lazily, once per currency, and memoized for the life of the
 * converter — a run touching 5,000 instruments needs about twenty quotes, not
 * five thousand. A failure is memoized too: an unquotable currency should cost
 * one attempt per run, not one per instrument, and the honest result is a null
 * USD figure rather than a guess.
 */

import type { YahooFinanceClient } from "../mcp/client.js";

export interface FxConverter {
  /** `amount` in `currency`, expressed in USD; null when either is unknown. */
  toUsd(amount: number | null, currency: string | null): Promise<number | null>;
}

interface YahooFxQuote {
  regularMarketPrice?: number | null;
}

export function createFxConverter(yahoo: YahooFinanceClient): FxConverter {
  // `null` is a cached failure, and is deliberately distinct from "absent".
  const rates = new Map<string, number | null>([["USD", 1]]);
  const inFlight = new Map<string, Promise<number | null>>();

  async function fetchRate(currency: string): Promise<number | null> {
    try {
      const quote = (await yahoo.quote(`${currency}USD=X`)) as YahooFxQuote | undefined;
      const price = quote?.regularMarketPrice;
      return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  async function rateFor(currency: string): Promise<number | null> {
    const known = rates.get(currency);
    if (known !== undefined) return known;

    let pending = inFlight.get(currency);
    if (pending === undefined) {
      pending = fetchRate(currency).then((rate) => {
        rates.set(currency, rate);
        inFlight.delete(currency);
        return rate;
      });
      inFlight.set(currency, pending);
    }
    return pending;
  }

  return {
    async toUsd(amount, currency) {
      if (amount === null || !Number.isFinite(amount)) return null;
      if (currency === null || currency.trim() === "") return null;
      const rate = await rateFor(currency.trim().toUpperCase());
      if (rate === null) return null;
      // Rounded to whole dollars: the input is a market cap, and carrying
      // fractional cents through an FX rate implies precision that is not there.
      return Math.round(amount * rate);
    },
  };
}
