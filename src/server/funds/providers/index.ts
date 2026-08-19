/**
 * The provider registry — the one place that knows every fund source exists.
 *
 * Constructed lazily and memoized so that importing the registry costs nothing:
 * the upstream clients hold throttle state and must be process-wide singletons,
 * which is exactly what a memo on this side gives them.
 */

import type { ProviderId } from "../../../shared/funds.js";
import { yahooFinanceClient } from "../../mcp/client.js";
import type { FundProvider } from "../provider.js";
import { createEastmoneyProvider } from "./eastmoney/index.js";
import { createIsharesProvider } from "./ishares/index.js";

const cache = new Map<ProviderId, FundProvider>();

function construct(id: ProviderId): FundProvider {
  switch (id) {
    case "eastmoney":
      return createEastmoneyProvider();
    case "ishares":
      return createIsharesProvider({ yahoo: yahooFinanceClient });
  }
}

export function getProvider(id: ProviderId): FundProvider {
  let provider = cache.get(id);
  if (provider === undefined) {
    provider = construct(id);
    cache.set(id, provider);
  }
  return provider;
}
