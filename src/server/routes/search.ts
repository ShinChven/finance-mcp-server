/**
 * One search box over everything this server can address.
 *
 * The watchlist page's search filters the list you are looking at, which is the
 * right behaviour for a list and the wrong one for the question people actually
 * arrive with: *what is there*. Typing "易方达" into a filter over eleven rows
 * you already track returns nothing, and an empty list is indistinguishable
 * from a broken one. This route is the other half — it searches what you do not
 * have yet — and the palette that calls it is mounted in the shell, so it is
 * reachable from every page rather than only from the one that owns a list.
 *
 * Two sources, merged: the local fund index, which knows names, companies and
 * tracked indices in Chinese, and Yahoo's search, which knows every listed
 * instrument on earth. Neither alone answers "易方达" *and* "the chip company
 * Jensen runs", which is why both are queried on every keystroke.
 *
 * Results come back unpriced. A search runs per keystroke behind a debounce and
 * a quote batch would add an upstream round trip to every one of them; the
 * preview prices the single thing the reader opens instead. Pricing here would
 * make the palette slower at exactly the moment it has to feel instant.
 */

import { zValidator } from "@hono/zod-validator";
import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import {
  SEARCH_LIMIT_PER_SOURCE,
  searchQuerySchema,
  type DiscoverIdea,
  type IdeaListResult,
} from "../../shared/discover.js";
import { db } from "../db/index.js";
import { funds } from "../db/schema.js";
import { ideaFromFund, ideaFromQuote, mergeIdeas, rankSearchIdeas, trackedIndex } from "../discover/ideas.js";
import type { QuoteLike } from "../discover/ideas.js";
import { escapeLike } from "../lib/listing.js";
import type { AppEnv } from "../lib/http.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { yahooRequestOptions } from "../mcp/tools/runtime.js";
import { requireAuth } from "../middleware/session.js";
import { createLazyWatchlistRepo } from "../watchlist/repo.js";

const repo = createLazyWatchlistRepo();

/**
 * Funds by their own identity only — code, name, company, tracked index.
 *
 * Deliberately not the holdings reverse-lookup the Funds page offers: matching
 * "NVDA" against every cached portfolio is a join worth running when someone
 * asked for it on a page built to explain the result, and is the wrong default
 * for a box that fires on every keystroke and shows ten rows with no room to
 * say why a fund is in them.
 */
async function searchFunds(query: string, limit: number) {
  const like = `%${escapeLike(query)}%`;
  const filters: SQL[] = [
    or(
      ilike(funds.code, like),
      ilike(funds.name, like),
      ilike(funds.company, like),
      ilike(funds.trackingIndex, like),
    )!,
  ];

  return db
    .select({
      code: funds.code,
      name: funds.name,
      market: funds.market,
      currency: funds.currency,
      fundType: funds.fundType,
    })
    .from(funds)
    .where(and(...filters))
    // Cached funds first: a fund whose portfolio is already here can be opened
    // and read immediately, where an uncached one costs a fetch to look at.
    .orderBy(sql`${funds.holdingsSyncedAt} desc nulls last`, funds.code)
    .limit(limit);
}

async function searchSymbols(query: string, limit: number): Promise<QuoteLike[]> {
  const result = await yahooFinanceClient.search(
    query,
    { quotesCount: limit, newsCount: 0, enableFuzzyQuery: false },
    yahooRequestOptions(),
  );
  return (result.quotes ?? []) as QuoteLike[];
}

export const searchRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", searchQuerySchema), async (c) => {
    const user = c.get("user");
    const { q, kind, limit } = c.req.valid("query");
    const cap = limit ?? SEARCH_LIMIT_PER_SOURCE * 2;

    const wantSymbols = kind !== "fund";
    const wantFunds = kind !== "symbol";

    // Settled rather than raced: half a result set is a useful answer, and a
    // Yahoo outage should not take the local fund index down with it.
    const [symbolResult, fundResult, trackedRows] = await Promise.allSettled([
      wantSymbols ? searchSymbols(q, SEARCH_LIMIT_PER_SOURCE) : Promise.resolve([]),
      wantFunds ? searchFunds(q, SEARCH_LIMIT_PER_SOURCE) : Promise.resolve([]),
      repo.listTrackedRefs(user.id),
    ]);

    const degraded: { source: string; message: string }[] = [];
    const failed = (source: string, result: PromiseSettledResult<unknown>) => {
      if (result.status === "rejected") {
        degraded.push({ source, message: (result.reason as Error).message });
      }
    };
    failed("symbols", symbolResult);
    failed("funds", fundResult);

    // The star only renders filled when this succeeded; a failure here shows
    // every row as untracked, which re-adding handles as a no-op anyway.
    const tracked = trackedIndex(
      trackedRows.status === "fulfilled" ? trackedRows.value : [],
    );

    const symbolIdeas: DiscoverIdea[] =
      symbolResult.status === "fulfilled"
        ? symbolResult.value
            .map((quote) => ideaFromQuote(quote, "search", tracked))
            .filter((idea): idea is DiscoverIdea => idea !== null)
        : [];
    const fundIdeas: DiscoverIdea[] =
      fundResult.status === "fulfilled"
        ? fundResult.value.map((fund) => ideaFromFund(fund, "search", tracked))
        : [];

    // Symbols ahead of funds, so a US ETF that is both resolves to its live
    // quote — the rule `detectItemKind` already applies when a ref is added.
    const items = rankSearchIdeas(mergeIdeas([symbolIdeas, fundIdeas], cap), q);

    const body: IdeaListResult = { items, ...(degraded.length > 0 && { degraded }) };
    return c.json(body);
  })

  /**
   * Whether a bare ref is addressable, for the "add anyway" path.
   *
   * The palette lets someone add a code that matched nothing — the index lags
   * new listings, and being unable to track something you can name would be a
   * worse failure than an unrecognised row. This says which of the two kinds
   * the ref would be stored as, so the row can label itself honestly.
   */
  .get("/resolve/:ref", async (c) => {
    const ref = c.req.param("ref").trim();
    if (ref === "" || ref.length > 32) return c.json({ error: "invalid ref" }, 400);

    const [fund] = await db
      .select({
        code: funds.code,
        name: funds.name,
        market: funds.market,
        currency: funds.currency,
        fundType: funds.fundType,
      })
      .from(funds)
      .where(eq(funds.code, ref.toUpperCase()))
      .limit(1);

    return c.json({ ref, fund: fund ?? null });
  });
