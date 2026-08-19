/**
 * The China public-fund provider, backed by Eastmoney / Tiantian Fund.
 *
 * Everything China-shaped stops here: 6-digit codes, 基金类型 strings, 亿元
 * fund sizes, quarterly top-ten disclosure. What leaves this file is normalized
 * to the vocabulary in `../../provider.ts`.
 */

import { PROVIDERS } from "../../../../shared/funds.js";
import type {
  FundDetails,
  FundProvider,
  HoldingsResult,
  NavPoint,
  UniverseEntry,
} from "../../provider.js";
import { getEastmoneyClient, type EastmoneyClient } from "./client.js";
import { fundSizeToMillions, looksLikeIndexFund, looksLikeOffshoreMandate } from "./classify.js";
import { totalDrops } from "./parse.js";
import { eastmoneyScopeFilter } from "./scope.js";

export function createEastmoneyProvider(client: EastmoneyClient = getEastmoneyClient()): FundProvider {
  return {
    id: "eastmoney",
    descriptor: PROVIDERS.eastmoney,
    // Matches the client's own throttle floor; used only for run estimates.
    requestIntervalMs: 300,
    requestsPerFund: 3,

    async listUniverse(): Promise<UniverseEntry[]> {
      const list = await client.fetchFundList();
      return list.map((entry) => ({
        code: entry.code,
        name: entry.name,
        fundType: entry.fundType,
        isIndexFund: looksLikeIndexFund(entry.fundType, entry.name),
        investsOffshore: looksLikeOffshoreMandate(entry.fundType, entry.name),
      }));
    },

    async fetchDetails(code: string): Promise<FundDetails> {
      const basics = await client.fetchFundBasics(code);
      return {
        name: basics.name,
        fundType: basics.fundType,
        trackingIndex: basics.trackingIndex,
        company: basics.company,
        manager: basics.manager,
        feeRate: basics.feeRate,
        fundSize: fundSizeToMillions(basics.fundSize),
        listedSymbol: null,
        // The profile page is the authority the universe heuristic was standing
        // in for: a declared 跟踪标的 settles it.
        isIndexFund: basics.trackingIndex !== null ? true : null,
        investsOffshore: null,
      };
    },

    async fetchHoldings(code: string): Promise<HoldingsResult> {
      const { entries, stats } = await client.fetchHoldingsWithStats(code);
      const dropped = totalDrops(stats);
      return {
        entries,
        dropped,
        ...(dropped > 0
          ? {
              dropReason:
                `no code ${stats.noCode}, unmapped ${stats.unmappedSymbol}, ` +
                `no weight ${stats.noWeight}`,
            }
          : {}),
      };
    },

    async fetchNav(code: string): Promise<NavPoint[]> {
      return client.fetchNavHistory(code);
    },

    scopeFilter: eastmoneyScopeFilter,
  };
}
