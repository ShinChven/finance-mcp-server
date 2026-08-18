/**
 * Caching one fund, on demand.
 *
 * Both places a user can meet an uncached fund — a dashboard drill-down and an
 * MCP tool — come through here, instead of being told to go run a batch job for
 * something they have already named. Four things make that safe to do on a
 * request path:
 *
 * - **One shared Eastmoney client**, so an on-demand fetch and a running
 *   category sync share the same 300ms throttle rather than each keeping their
 *   own and doubling the rate against a host that throttles hard.
 * - **In-flight de-duplication**, so ten agents asking about the same fund at
 *   once cause one fetch, not ten.
 * - **The existing freshness watermarks**, so a fund cached an hour ago costs
 *   nothing and the common case stays free.
 * - **A queue ceiling**, so an agent looping over a hundred codes is refused
 *   rather than silently enqueuing an hour of scraping.
 *
 * Sector classification is bounded by a deadline instead of being run to
 * completion. What it misses shows up as lower `coverage` on the exposure rows,
 * which is exactly the signal coverage exists to carry — better than making the
 * caller wait through a serial Yahoo walk of every holding.
 */

import { eq, inArray } from "drizzle-orm";
import { isFresh, type SyncStep } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import { fundHoldings, funds } from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { getEastmoneyClient } from "./eastmoney.js";
import {
  emptySummary,
  ingestFundDetails,
  ingestHoldings,
  ingestNav,
  ingestSectors,
  recomputeExposure,
} from "./ingest.js";

type Db = typeof Database;

/** Beyond this many fetches waiting, callers are refused instead of queued. */
const MAX_PENDING = 8;
/** Ceiling on the serial Yahoo walk that classifies a new fund's holdings. */
const CLASSIFY_BUDGET_MS = 8_000;

export type EnsureStatus =
  /** Already inside its freshness window; nothing was fetched. */
  | "fresh"
  /** Fetched now. */
  | "cached"
  /** No such fund in the universe index. */
  | "unknown"
  /** Too many fetches already waiting. */
  | "busy"
  | "failed";

export interface EnsureResult {
  code: string;
  status: EnsureStatus;
  fetched: SyncStep[];
  symbolsClassified: number;
  /** Holdings the classifier did not reach before the deadline. */
  unclassified: number;
  error?: string;
  /** One line a tool can hand back to a model verbatim. */
  message: string;
}

export interface EnsureOptions {
  /** Which steps matter to the caller. Defaults to all three. */
  steps?: SyncStep[];
  /** Refetch even if the watermarks are fresh. */
  force?: boolean;
  /** Skip classification and exposure — for callers that only need NAV. */
  classify?: boolean;
}

export interface FundCache {
  ensure(code: string, options?: EnsureOptions): Promise<EnsureResult>;
}

const ALL_STEPS: SyncStep[] = ["details", "holdings", "nav"];

export function createFundCache(db: Db, yahoo: YahooFinanceClient): FundCache {
  // Keyed by code, not by (code, options): a second caller wanting more steps
  // than the one in flight is rare, and waiting for a slightly narrower fetch
  // beats issuing a duplicate one.
  const inFlight = new Map<string, Promise<EnsureResult>>();

  async function run(code: string, options: EnsureOptions): Promise<EnsureResult> {
    const steps = options.steps ?? ALL_STEPS;
    const result: EnsureResult = {
      code,
      status: "cached",
      fetched: [],
      symbolsClassified: 0,
      unclassified: 0,
      message: "",
    };

    const [fund] = await db.select().from(funds).where(eq(funds.code, code)).limit(1);
    if (!fund) {
      // `fund_holdings.fund_code` is a foreign key into `funds`, so fetching a
      // code the universe has never seen would fail on a bare constraint
      // violation. Say so instead.
      return {
        ...result,
        status: "unknown",
        message: `Fund ${code} is not in the fund universe index. Check the code, or run a universe refresh.`,
      };
    }

    const now = Date.now();
    const stale = (step: SyncStep): boolean => {
      if (!steps.includes(step)) return false;
      if (options.force === true) return true;
      const watermark =
        step === "details" ? fund.detailsSyncedAt : step === "holdings" ? fund.holdingsSyncedAt : fund.navSyncedAt;
      return !isFresh(watermark, step, now);
    };

    const wanted = ALL_STEPS.filter(stale);
    if (wanted.length === 0) {
      return {
        ...result,
        status: "fresh",
        message: `Fund ${code} was already cached and still fresh.`,
      };
    }

    const client = getEastmoneyClient();
    const summary = emptySummary();

    try {
      if (wanted.includes("details")) await ingestFundDetails(db, client, [code], summary);
      if (wanted.includes("holdings")) await ingestHoldings(db, client, [code], summary);
      if (wanted.includes("nav")) await ingestNav(db, client, [code], summary);
      result.fetched = wanted;
    } catch (error) {
      return {
        ...result,
        status: "failed",
        error: (error as Error).message,
        message: `Could not cache fund ${code}: ${(error as Error).message}`,
      };
    }

    if (wanted.includes("holdings") && options.classify !== false) {
      const symbols = await db
        .selectDistinct({ symbol: fundHoldings.symbol })
        .from(fundHoldings)
        .where(eq(fundHoldings.fundCode, code));

      // Deadline rather than completion: exposure is computed either way, and
      // whatever went unclassified is reported through `coverage`.
      const deadline = Date.now() + CLASSIFY_BUDGET_MS;
      const pending = symbols.map((row) => row.symbol);
      const reached: string[] = [];
      for (const symbol of pending) {
        if (Date.now() > deadline) break;
        reached.push(symbol);
      }
      await ingestSectors(db, yahoo, reached, summary);
      await recomputeExposure(db, [code], summary);
      result.symbolsClassified = summary.symbolsClassified;
      result.unclassified = pending.length - reached.length;
    }

    // Whatever the steps did or did not manage, the fund's own error column is
    // the honest record of it.
    const [after] = await db
      .select({ error: funds.lastSyncError })
      .from(funds)
      .where(eq(funds.code, code))
      .limit(1);

    return {
      ...result,
      ...(after?.error ? { error: after.error } : {}),
      message: `Cached fund ${code} (${wanted.join(", ")}) on demand.`,
    };
  }

  return {
    async ensure(code, options = {}) {
      const existing = inFlight.get(code);
      if (existing !== undefined) return existing;

      if (inFlight.size >= MAX_PENDING) {
        return {
          code,
          status: "busy",
          fetched: [],
          symbolsClassified: 0,
          unclassified: 0,
          message:
            `Too many funds are being cached right now (${inFlight.size}). ` +
            `Ask again shortly, or cache a category from the dashboard instead of one fund at a time.`,
        };
      }

      const promise = run(code, options).finally(() => inFlight.delete(code));
      inFlight.set(code, promise);
      return promise;
    },
  };
}

/**
 * Defers the database import until something actually needs a fund cached, so
 * building an MCP server in a test never requires a configured database.
 */
export function createLazyFundCache(): FundCache {
  let cached: Promise<FundCache> | undefined;

  const load = async (): Promise<FundCache> => {
    cached ??= (async () => {
      const [{ db }, { yahooFinanceClient }] = await Promise.all([
        import("../db/index.js"),
        import("../mcp/client.js"),
      ]);
      return createFundCache(db, yahooFinanceClient);
    })();
    return cached;
  };

  return {
    async ensure(code, options) {
      return (await load()).ensure(code, options);
    },
  };
}

/** Codes that are in the universe but have never had holdings cached. */
export async function uncachedCodes(db: Db, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .select({ code: funds.code, holdingsSyncedAt: funds.holdingsSyncedAt })
    .from(funds)
    .where(inArray(funds.code, codes));
  return rows.filter((row) => row.holdingsSyncedAt === null).map((row) => row.code);
}
