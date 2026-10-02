/**
 * A quote, read for the symbol page and the market board.
 *
 * The price itself is read by `liveFromQuote` — the same function the
 * watchlist uses — so the header of a symbol page can never disagree with the
 * row it was opened from. What this adds is the rest of the payload the row
 * has no room for: what the listing is, and the session detail around the
 * price.
 */

import type { SymbolIdentity, SymbolSession } from "../../shared/symbol.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { yahooRequestOptions } from "../mcp/tools/runtime.js";
import { liveFromQuote, type LiveValue } from "../watchlist/live.js";
import { isoInstant, num, str, type Json } from "./read.js";

export interface SymbolQuote {
  identity: SymbolIdentity;
  live: LiveValue;
  session: SymbolSession;
}

export function identityFromQuote(quote: Json): SymbolIdentity {
  return {
    symbol: str(quote["symbol"]) ?? "",
    // The long name where Yahoo has one: "NVIDIA Corporation" over "NVIDIA Corp".
    name: str(quote["longName"]) ?? str(quote["shortName"]) ?? str(quote["displayName"]),
    exchange: str(quote["fullExchangeName"]) ?? str(quote["exchange"]),
    quoteType: str(quote["quoteType"]),
    market: str(quote["market"]),
    currency: str(quote["currency"]),
    timezone: str(quote["exchangeTimezoneName"]),
  };
}

export function sessionFromQuote(quote: Json): SymbolSession {
  return {
    open: num(quote["regularMarketOpen"]),
    bid: num(quote["bid"]),
    ask: num(quote["ask"]),
    bidSize: num(quote["bidSize"]),
    askSize: num(quote["askSize"]),
    averageVolume10Day: num(quote["averageDailyVolume10Day"]),
    epsTrailing: num(quote["epsTrailingTwelveMonths"]),
    epsForward: num(quote["epsForward"]),
    forwardPe: num(quote["forwardPE"]),
    priceToBook: num(quote["priceToBook"]),
    sharesOutstanding: num(quote["sharesOutstanding"]),
    fiftyTwoWeekChangePercent: num(quote["fiftyTwoWeekChangePercent"]),
    earningsAt: isoInstant(quote["earningsTimestamp"]) ?? isoInstant(quote["earningsTimestampStart"]),
  };
}

export function symbolQuoteFrom(quote: Json): SymbolQuote {
  return {
    identity: identityFromQuote(quote),
    live: liveFromQuote(quote),
    session: sessionFromQuote(quote),
  };
}

/**
 * One batched quote for any number of symbols.
 *
 * Yahoo silently drops symbols it does not know rather than failing the batch,
 * so a symbol missing from the map is one that does not resolve; the caller
 * decides whether that is a 404 or a gap on a board.
 */
export async function quoteMany(
  client: YahooFinanceClient,
  symbols: string[],
): Promise<Map<string, SymbolQuote>> {
  const out = new Map<string, SymbolQuote>();
  if (symbols.length === 0) return out;
  const rows = (await client.quote(symbols, {}, yahooRequestOptions())) as unknown;
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    if (typeof row !== "object" || row === null) continue;
    const quote = symbolQuoteFrom(row as Json);
    if (quote.identity.symbol !== "") out.set(quote.identity.symbol.toUpperCase(), quote);
  }
  return out;
}
