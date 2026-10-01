/**
 * An options chain, laid out as a straddle: calls and puts side by side by strike.
 *
 * The upstream returns two separate lists per expiry. A reader compares a call
 * and a put at the same strike far more often than two calls, so they are
 * joined here on the strike, and the summary figures a chain is usually read
 * for — put/call ratios and max pain — are computed once on the server rather
 * than by every client.
 */

import type { OptionChainView, OptionQuote } from "../../shared/symbol.js";
import { isoDate, num, pct, record, records, round, str } from "./read.js";

function readOption(row: Record<string, unknown>): OptionQuote {
  return {
    contract: str(row["contractSymbol"]) ?? "",
    last: num(row["lastPrice"]),
    change: num(row["change"]),
    changePercent: num(row["percentChange"]),
    bid: num(row["bid"]),
    ask: num(row["ask"]),
    volume: num(row["volume"]),
    openInterest: num(row["openInterest"]),
    impliedVolatilityPercent: pct(row["impliedVolatility"]),
    inTheMoney: row["inTheMoney"] === true,
  };
}

/**
 * The strike at which the options expiring would pay their holders least.
 *
 * For each candidate settlement price P (every listed strike), the intrinsic
 * value of every open contract is summed — calls pay P − K above their strike,
 * puts pay K − P below theirs — weighted by open interest. The minimum is max
 * pain. It is a reading of where open interest sits, not a forecast, and the
 * page labels it that way.
 */
export function maxPain(
  rows: { strike: number; callOpenInterest: number; putOpenInterest: number }[],
): number | null {
  const live = rows.filter((row) => row.callOpenInterest > 0 || row.putOpenInterest > 0);
  if (live.length === 0) return null;
  let best: number | null = null;
  let bestPain = Infinity;
  for (const candidate of live) {
    const price = candidate.strike;
    let pain = 0;
    for (const row of live) {
      if (price > row.strike) pain += (price - row.strike) * row.callOpenInterest;
      if (price < row.strike) pain += (row.strike - price) * row.putOpenInterest;
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = price;
    }
  }
  return best;
}

export function buildOptionChain(symbol: string, result: unknown): OptionChainView {
  const root = record(result);
  const quote = record(root["quote"]);
  const chain = records(root["options"])[0] ?? {};
  const underlying = num(quote["regularMarketPrice"]);

  const byStrike = new Map<number, { call: OptionQuote | null; put: OptionQuote | null }>();
  const place = (rows: unknown, side: "call" | "put") => {
    for (const row of records(rows)) {
      const strike = num(row["strike"]);
      if (strike === null) continue;
      const entry = byStrike.get(strike) ?? { call: null, put: null };
      entry[side] = readOption(row);
      byStrike.set(strike, entry);
    }
  };
  place(chain["calls"], "call");
  place(chain["puts"], "put");

  const rows = [...byStrike.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([strike, sides]) => ({ strike, ...sides }));

  let atmStrike: number | null = null;
  if (underlying !== null && rows.length > 0) {
    atmStrike = rows.reduce((best, row) =>
      Math.abs(row.strike - underlying) < Math.abs(best.strike - underlying) ? row : best,
    ).strike;
  }

  const sum = (pick: (row: (typeof rows)[number]) => number | null | undefined) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const callVolume = sum((row) => row.call?.volume);
  const putVolume = sum((row) => row.put?.volume);
  const callOpenInterest = sum((row) => row.call?.openInterest);
  const putOpenInterest = sum((row) => row.put?.openInterest);

  const expirations = (Array.isArray(root["expirationDates"]) ? root["expirationDates"] : [])
    .map(isoDate)
    .filter((date): date is string => date !== null);

  return {
    symbol,
    currency: str(quote["currency"]),
    underlyingPrice: underlying,
    expirations,
    expiry: isoDate(chain["expirationDate"]) ?? expirations[0] ?? null,
    rows,
    atmStrike,
    totals: {
      callVolume,
      putVolume,
      callOpenInterest,
      putOpenInterest,
      putCallVolumeRatio: callVolume > 0 ? round(putVolume / callVolume, 2) : null,
      putCallOpenInterestRatio:
        callOpenInterest > 0 ? round(putOpenInterest / callOpenInterest, 2) : null,
      maxPain: maxPain(
        rows.map((row) => ({
          strike: row.strike,
          callOpenInterest: row.call?.openInterest ?? 0,
          putOpenInterest: row.put?.openInterest ?? 0,
        })),
      ),
    },
  };
}
