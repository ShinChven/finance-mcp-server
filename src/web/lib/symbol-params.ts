/**
 * The symbol page's URL params: the one reader and writer.
 *
 * The same rule as `useListParams`, for a page whose state is not a list:
 * every setting lives in the URL, parsed by the shared zod helper with its
 * defaults, and a value equal to its default is left out so the URL stays the
 * short one a reader would type.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { serializeIndicators } from "../../shared/indicators.js";
import {
  parseSymbolParams,
  SYMBOL_PARAM_DEFAULTS,
  type SymbolPageParams,
} from "../../shared/symbol.js";

/** Settings that describe a view rather than a symbol, and so survive switching symbols. */
const CARRIED: (keyof SymbolPageParams)[] = ["tab", "range", "style", "interval", "ind", "list", "statement", "period"];

/** Writes a patch onto existing params, dropping anything that equals its default. */
export function applySymbolPatch(
  previous: URLSearchParams,
  patch: Partial<SymbolPageParams>,
): URLSearchParams {
  const next = new URLSearchParams(previous);
  for (const [key, value] of Object.entries(patch) as [keyof SymbolPageParams, unknown][]) {
    if (key === "ind") {
      const serialized = serializeIndicators(value as SymbolPageParams["ind"]);
      if (serialized === "") next.delete("ind");
      else next.set("ind", serialized);
      continue;
    }
    if (value === undefined || value === "" || value === SYMBOL_PARAM_DEFAULTS[key]) next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

/**
 * The query string to carry onto another symbol's page.
 *
 * The chart settings and the open tab go along — flicking down a watchlist at
 * weekly candles with MACD showing should stay at weekly candles with MACD
 * showing. An options expiry or a filing filter does not: they belong to the
 * symbol they were chosen on.
 */
export function carriedQuery(search: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of CARRIED) {
    const value = search.get(key);
    if (value !== null && value !== "") next.set(key, value);
  }
  const query = next.toString();
  return query === "" ? "" : `?${query}`;
}

export function useSymbolParams() {
  const [search, setSearch] = useSearchParams();
  const values = useMemo(() => parseSymbolParams(search), [search]);

  /**
   * Discrete choices push history, so back steps through the tabs, ranges
   * and expiries a reader tried; `replace` is for anything keystroke-driven.
   */
  const update = useCallback(
    (patch: Partial<SymbolPageParams>, options: { replace?: boolean } = {}) => {
      setSearch((previous) => applySymbolPatch(previous, patch), { replace: options.replace });
    },
    [setSearch],
  );

  return { ...values, update, search };
}
