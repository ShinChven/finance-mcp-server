/**
 * Caching one fund, on demand.
 *
 * Both places a user can meet an uncached fund — a dashboard drill-down and an
 * MCP tool — come through here, instead of being told to go run a batch job for
 * something they have already named. Four things make that safe to do on a
 * request path:
 *
 * - **One shared client per provider**, so an on-demand fetch and a running
 *   category sync share the same throttle rather than each keeping their own
 *   and doubling the rate against a host that throttles hard.
 * - **In-flight de-duplication**, so ten agents asking about the same fund at
 *   once cause one fetch, not ten.
 * - **The existing freshness watermarks**, so a fund cached an hour ago costs
 *   nothing and the common case stays free.
 * - **A queue ceiling**, so an agent looping over a hundred codes is refused
 *   rather than silently enqueuing an hour of scraping.
 *
 * Instrument enrichment is bounded by a deadline instead of being run to
 * completion. What it misses shows up as lower `coverage` on the exposure rows,
 * which is exactly the signal coverage exists to carry — better than making the
 * caller wait through a serial Yahoo walk of every holding.
 */

import { eq, inArray } from "drizzle-orm";
import { isFresh, normalizeFundCode, type SyncStep } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import { fundHoldings, funds } from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import {
  emptySummary,
  ingestFundDetails,
  ingestHoldings,
  ingestNav,
  countStaleInstrumentProfiles,
  ingestInstrumentProfiles,
  recomputeExposure,
} from "./ingest.js";
import { getProvider } from "./providers/index.js";
import { seedEmptyFundIndexes } from "./universe.js";
import { publishAdminChange } from "../realtime/bus.js";

type Db = typeof Database;

/** Beyond this many fetches waiting, callers are refused instead of queued. */
const MAX_PENDING = 8;
/** Ceiling on the serial Yahoo walk that classifies a new fund's holdings. */
const CLASSIFY_BUDGET_MS = 8_000;
/** How often an unrecognized code may trigger a listing call. */
const INDEX_SEED_INTERVAL_MS = 5 * 60 * 1000;
/** `funds.last_sync_error` is a display column, not a log. */
const MAX_ERROR_LENGTH = 300;

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

/** The watermark each step writes, read back off a fund row. */
function watermarkOf(
  row: { detailsSyncedAt: Date | null; holdingsSyncedAt: Date | null; navSyncedAt: Date | null },
  step: SyncStep,
): Date | null {
  if (step === "details") return row.detailsSyncedAt;
  if (step === "holdings") return row.holdingsSyncedAt;
  return row.navSyncedAt;
}

export function createFundCache(db: Db, yahoo: YahooFinanceClient): FundCache {
  // Keyed by code, not by (code, options): a second caller wanting more steps
  // than the one in flight is rare, and waiting for a slightly narrower fetch
  // beats issuing a duplicate one.
  const inFlight = new Map<string, Promise<EnsureResult>>();
  let lastIndexSeedAt = 0;

  /**
   * The fund row, loading the provider indexes first if none has ever landed.
   *
   * Without this an unloaded index is a dead end that looks like a bad code:
   * the answer to "cache IVV" was "not in the fund universe index", the
   * suggested remedy — a universe refresh — was the very thing that had been
   * failing, and nothing in the reply said so.
   */
  async function findFund(code: string): Promise<typeof funds.$inferSelect | undefined> {
    const [fund] = await db.select().from(funds).where(eq(funds.code, code)).limit(1);
    if (fund) return fund;

    const now = Date.now();
    if (now - lastIndexSeedAt < INDEX_SEED_INTERVAL_MS) return undefined;
    lastIndexSeedAt = now;
    const seeded = await seedEmptyFundIndexes(db);
    if (seeded.length === 0) return undefined;

    const [retried] = await db.select().from(funds).where(eq(funds.code, code)).limit(1);
    return retried;
  }

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

    const fund = await findFund(code);
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
      // Freshness windows are the provider's: a China quarterly report is worth
      // re-checking weekly, an iShares daily file every day.
      return !isFresh(watermark, step, fund.provider, now);
    };

    const wanted = ALL_STEPS.filter(stale);
    if (wanted.length === 0) {
      return {
        ...result,
        status: "fresh",
        message: `Fund ${code} was already cached and still fresh.`,
      };
    }

    // The fund row knows where it came from, so a caller holding nothing but a
    // code — every MCP tool, and the dashboard drill-down — gets the right
    // upstream without having to care which market the fund is from.
    const provider = getProvider(fund.provider);
    const summary = emptySummary();
    const startedAt = new Date();

    try {
      if (wanted.includes("details")) await ingestFundDetails(db, provider, [code], summary);
      if (wanted.includes("holdings")) await ingestHoldings(db, provider, [code], summary);
      if (wanted.includes("nav")) await ingestNav(db, provider, [code], summary);
    } catch (error) {
      return {
        ...result,
        status: "failed",
        error: (error as Error).message,
        message: `Could not cache fund ${code}: ${(error as Error).message}`,
      };
    }

    // What actually landed, read from the watermarks rather than assumed.
    //
    // The ingest steps collect per-fund failures into the summary instead of
    // throwing — that is what lets a category run survive one dead fund — so
    // every upstream error on this path used to be dropped on the floor here,
    // and a fund whose holdings file 403'd came back as "Cached fund IVV
    // (details, holdings, nav) on demand." with an empty portfolio behind it.
    // A watermark is the honest test: only a step that stored something moves
    // it, and a fetch that legitimately found nothing to store still counts as
    // done. Message-matching would not do — `ingestHoldings` reports dropped
    // rows as an error on a fetch that otherwise succeeded.
    const [after] = await db
      .select({
        detailsSyncedAt: funds.detailsSyncedAt,
        holdingsSyncedAt: funds.holdingsSyncedAt,
        navSyncedAt: funds.navSyncedAt,
      })
      .from(funds)
      .where(eq(funds.code, code))
      .limit(1);

    const landed = after
      ? wanted.filter((step) => {
          const watermark = watermarkOf(after, step);
          return watermark !== null && watermark.getTime() >= startedAt.getTime();
        })
      : [];
    result.fetched = landed;

    const failure = summary.errors.length > 0 ? summary.errors.join("; ") : null;
    // Mirrored onto the fund row for the same reason a batch run does it: the
    // console's "failing" filter, and the next caller, should see why this fund
    // is empty without having to reproduce the request.
    await db
      .update(funds)
      .set({ lastSyncError: failure === null ? null : failure.slice(0, MAX_ERROR_LENGTH) })
      .where(eq(funds.code, code));

    if (landed.length === 0) {
      const reason = failure ?? "the upstream returned nothing";
      return {
        ...result,
        status: "failed",
        error: reason,
        message: `Could not cache fund ${code}: ${reason}`,
      };
    }

    if (landed.includes("holdings") && options.classify !== false) {
      const symbols = await db
        .selectDistinct({ symbol: fundHoldings.symbol })
        .from(fundHoldings)
        .where(eq(fundHoldings.fundCode, code));

      // Deadline rather than completion: exposure is computed either way, and
      // whatever the deadline cut short is reported through `coverage` and the
      // `unclassified` count instead of making the caller wait.
      const pending = symbols.map((row) => row.symbol);
      await ingestInstrumentProfiles(db, yahoo, pending, summary, {
        deadline: Date.now() + CLASSIFY_BUDGET_MS,
      });
      await recomputeExposure(db, [code], summary);
      result.symbolsClassified = summary.symbolsClassified;
      // Counted from the watermarks rather than from what this call processed:
      // an instrument another fund already enriched is not left behind.
      result.unclassified = await countStaleInstrumentProfiles(db, pending);
    }

    // A partial success says so rather than reporting the steps that failed as
    // fetched: the caller can then tell an empty portfolio caused by an
    // upstream failure from one the fund genuinely has.
    const missed = wanted.filter((step) => !landed.includes(step));
    return {
      ...result,
      ...(failure === null ? {} : { error: failure }),
      message:
        `Cached fund ${code} (${landed.join(", ")}) on demand.` +
        (missed.length === 0 ? "" : ` ${missed.join(", ")} failed: ${failure ?? "unknown error"}.`),
    };
  }

  return {
    async ensure(raw, options = {}) {
      // One spelling per fund, at the edge: the map below and every query
      // inside `run` are exact matches on `funds.code`, so `ivv` from a URL
      // path would both miss the in-flight de-duplication and be reported as a
      // fund that does not exist.
      const code = normalizeFundCode(raw);
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

      const promise = run(code, options)
        .then((result) => {
          // An agent touching an uncached fund fills the cache as a side
          // effect; the fund pages should show that without a manual reload.
          if (result.status === "cached") publishAdminChange("funds", "updated", [result.code]);
          return result;
        })
        .finally(() => inFlight.delete(code));
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
