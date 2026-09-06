/**
 * Browsing, for when the reader cannot name what they are looking for.
 *
 * Search answers "where is 易方达". This answers the question people actually
 * open a markets app with — *show me something* — and it is the half that was
 * missing: until now the only route into a watchlist was typing a code, so the
 * dashboard could tell you how your eleven holdings were doing and nothing at
 * all about the other forty thousand instruments it can price.
 *
 * Four ways in, because there are four different amounts a reader can already
 * know. `trending` and `movers` need nothing — the market picks. `themes` takes
 * an idea ("semiconductors") and walks the crosswalk to funds. `related` starts
 * from what is already tracked. `random` is the deliberate one: one instrument,
 * chosen by nobody, for the reader who just wants to look at something.
 *
 * Everything returns `DiscoverIdea` rows, so one component renders all of them
 * and one star adds any of them to a list. What differs between the tabs is
 * only where the rows came from — which is exactly what `source` records.
 *
 * Cost discipline: every route here is one upstream call plus at most one quote
 * batch. The screener returns quotes already and is not re-priced; trending
 * returns bare symbols and is; funds price from the local NAV cache, which
 * costs a query and no network at all.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { PredefinedScreenerModules } from "yahoo-finance2/modules/screener";
import {
  DEFAULT_MOVER_SCREEN,
  DEFAULT_TRENDING_REGION,
  DISCOVER_DEFAULT_LIMIT,
  ideaKey,
  moversQuerySchema,
  relatedQuerySchema,
  themeQuerySchema,
  trendingQuerySchema,
  type DiscoverIdea,
  type IdeaListResult,
  type ThemeSummary,
} from "../../shared/discover.js";
import { seriesQuerySchema } from "../../shared/series.js";
import { WATCHLIST_ITEM_KINDS, type WatchlistItemKind } from "../../shared/watchlist.js";
import { THEMES, findTheme } from "../funds/crosswalk.js";
import { createLazyFundRepo, type FundMatch } from "../funds/repo.js";
import type { Fund } from "../db/schema.js";
import {
  ideaFromFund,
  ideaFromQuote,
  mergeIdeas,
  pickRandom,
  priceIdeas,
  trackedIndex,
  type QuoteLike,
} from "../discover/ideas.js";
import type { AppEnv } from "../lib/http.js";
import { BarFetchRefused } from "../market/bars.js";
import { loadSeriesDeps, seriesBudget } from "../market/deps.js";
import { priceSeries } from "../market/series.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { SCREENER_IDS } from "../mcp/tools/screener.js";
import { yahooRequestOptions } from "../mcp/tools/runtime.js";
import { requireAuth } from "../middleware/session.js";
import { currentValues } from "../watchlist/live.js";
import { createLazyWatchlistRepo } from "../watchlist/repo.js";

const repo = createLazyWatchlistRepo();
const fundRepo = createLazyFundRepo();

/** How many of the reader's own holdings seed the related list. */
const RELATED_SEED_SYMBOLS = 8;
/** Candidates the random pick chooses among, per source. */
const RANDOM_POOL = 30;

/**
 * Narrows a validated screen id to the union the client's own signature wants.
 *
 * The shared list is plain strings — `shared/` cannot import a server module,
 * let alone the upstream's types — so the union is recovered here by finding
 * the id in the tool's list rather than asserted with a cast that would survive
 * the two lists drifting apart.
 */
function screenerId(value: string): PredefinedScreenerModules | null {
  return SCREENER_IDS.find((candidate) => candidate === value) ?? null;
}

/**
 * An upstream that did not answer, said twice.
 *
 * `degraded` is the structured half a caller can branch on; `error` is the
 * sentence a reader sees, and it has to be there because the client's fetch
 * helper falls back to the bare HTTP status text without it — "Bad Gateway"
 * tells nobody which list failed or why.
 */
function unavailable(source: string, error: unknown): IdeaListResult & { error: string } {
  const message = (error as Error).message;
  // The page supplies the "unavailable" framing; this supplies only the reason,
  // so the two do not read as the same sentence twice.
  return {
    items: [],
    error: `Yahoo Finance did not answer: ${message}`,
    degraded: [{ source, message }],
  };
}

/** Prices ideas of either kind through the same path a watchlist row uses. */
async function withPrices(ideas: DiscoverIdea[]): Promise<DiscoverIdea[]> {
  if (ideas.length === 0) return ideas;
  try {
    const { values, names } = await currentValues(
      ideas.map((idea) => ({ kind: idea.kind, ref: idea.ref })),
      { client: yahooFinanceClient, repo },
    );
    const priced = priceIdeas(ideas, values);
    // The fund cache knows names the upstream lists do not carry.
    return priced.map((idea) =>
      idea.name === null ? { ...idea, name: names.get(idea.ref) ?? null } : idea,
    );
  } catch {
    // An unpriced row still names something worth looking at; a failed batch
    // must not empty the page.
    return ideas;
  }
}

async function trackedFor(userId: string) {
  try {
    return trackedIndex(await repo.listTrackedRefs(userId));
  } catch {
    return trackedIndex([]);
  }
}

/** Fund rows, however the theme routes found them, as ideas. */
function fundIdeas(
  funds: (Fund | FundMatch)[],
  tracked: Map<string, { listId: string; listName: string }[]>,
): DiscoverIdea[] {
  return funds.map((entry) => {
    const fund = "fund" in entry ? entry.fund : entry;
    return ideaFromFund(fund, "theme", tracked);
  });
}

export const discoverRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  /**
   * What is being looked at in one market right now.
   *
   * Yahoo returns bare symbols, so this is the one list that has to buy its own
   * quotes — worth it, because "trending" with no prices is a list of tickers
   * and tells the reader nothing about why any of them is on it.
   */
  .get("/trending", zValidator("query", trendingQuerySchema), async (c) => {
    const user = c.get("user");
    const { region, limit } = c.req.valid("query");
    const count = limit ?? DISCOVER_DEFAULT_LIMIT;
    const chosen = region ?? DEFAULT_TRENDING_REGION;

    const tracked = await trackedFor(user.id);
    try {
      const result = await yahooFinanceClient.trendingSymbols(
        chosen,
        { region: chosen, count },
        yahooRequestOptions(),
      );
      const ideas = (result.quotes ?? [])
        .map((quote) => ideaFromQuote(quote as QuoteLike, "trending", tracked))
        .filter((idea): idea is DiscoverIdea => idea !== null);
      const body: IdeaListResult = { items: await withPrices(ideas) };
      return c.json(body);
    } catch (error) {
      return c.json(unavailable("trending", error), 502);
    }
  })

  /** A predefined screen. Its quotes are complete, so nothing is re-priced. */
  .get("/movers", zValidator("query", moversQuerySchema), async (c) => {
    const user = c.get("user");
    const { screen, limit } = c.req.valid("query");
    const id = screenerId(screen ?? DEFAULT_MOVER_SCREEN);
    if (id === null) return c.json({ error: "unknown screen" }, 400);

    const tracked = await trackedFor(user.id);
    try {
      const result = await yahooFinanceClient.screener(
        id,
        { scrIds: id, count: limit ?? DISCOVER_DEFAULT_LIMIT },
        yahooRequestOptions(),
      );
      const items = (result.quotes ?? [])
        .map((quote) => ideaFromQuote(quote as QuoteLike, "screener", tracked))
        .filter((idea): idea is DiscoverIdea => idea !== null);
      const body: IdeaListResult = { items };
      return c.json(body);
    } catch (error) {
      return c.json(unavailable("screener", error), 502);
    }
  })

  /**
   * The themes the crosswalk can resolve.
   *
   * Served rather than hard-coded in the bundle because the crosswalk is
   * hand-maintained server-side: a theme added there should appear on the page
   * without a rebuild, and a page offering a theme the server cannot resolve
   * would be a pill that always returns nothing.
   */
  .get("/themes", (c) => {
    const items: ThemeSummary[] = THEMES.map((theme) => ({
      id: theme.id,
      label: theme.labels[0] ?? theme.id,
      aliases: theme.labels,
    }));
    return c.json({ items });
  })

  /**
   * Theme → funds, by the same three routes the MCP tool uses.
   *
   * Index-tracking funds come first for the reason that tool gives: a fund that
   * declares it tracks an index will still track it next quarter, where
   * holdings-derived exposure is a snapshot that drifts.
   */
  .get("/theme-funds", zValidator("query", themeQuerySchema), async (c) => {
    const user = c.get("user");
    const { theme, limit } = c.req.valid("query");
    const cap = limit ?? DISCOVER_DEFAULT_LIMIT;

    const definition = findTheme(theme);
    if (definition === undefined) {
      return c.json({ error: `No theme matches "${theme}".` }, 404);
    }

    const tracked = await trackedFor(user.id);
    const [byIndex, bySector, byMarket] = await Promise.all([
      fundRepo.findFundsByTrackingIndex(definition.indices, { limit: cap }),
      definition.gicsSectors.length > 0 || definition.cnSectorNames.length > 0
        ? fundRepo.findFundsBySector({
            keys: [...definition.gicsSectors, ...(definition.gicsIndustries ?? [])],
            labels: [...definition.cnSectorNames, ...(definition.gicsIndustries ?? [])],
            limit: cap,
            ...(definition.markets !== undefined ? { markets: definition.markets } : {}),
          })
        : Promise.resolve([] as FundMatch[]),
      definition.markets !== undefined
        ? fundRepo.findFundsByMarketExposure(definition.markets, { limit: cap })
        : Promise.resolve([] as FundMatch[]),
    ]);

    const merged = mergeIdeas(
      [fundIdeas(byIndex, tracked), fundIdeas(bySector, tracked), fundIdeas(byMarket, tracked)],
      cap,
    );
    const body: IdeaListResult = { items: await withPrices(merged) };
    return c.json(body);
  })

  /**
   * Instruments related to what this reader already tracks.
   *
   * Seeded from their own symbols rather than from a global list, which is what
   * makes it the one tab that says something about them. Funds are not seeds:
   * the upstream relates listings, and a China fund code means nothing to it —
   * `similarFunds` over the exposure vectors is the equivalent for those, and
   * it belongs on a fund's own page, not in a row of suggestions.
   *
   * Already-tracked refs are filtered out. "Related to your holdings" that
   * returns your holdings is a mirror, not a suggestion.
   */
  .get("/related", zValidator("query", relatedQuerySchema), async (c) => {
    const user = c.get("user");
    const { limit } = c.req.valid("query");
    const cap = limit ?? DISCOVER_DEFAULT_LIMIT;

    const trackedRows = await repo.listTrackedRefs(user.id);
    const tracked = trackedIndex(trackedRows);
    const seeds = [...new Set(trackedRows.filter((row) => row.kind === "symbol").map((row) => row.ref))]
      .slice(0, RELATED_SEED_SYMBOLS);

    if (seeds.length === 0) {
      const body: IdeaListResult = { items: [] };
      return c.json(body);
    }

    try {
      const results = await yahooFinanceClient.recommendationsBySymbol(
        seeds,
        undefined,
        yahooRequestOptions(),
      );
      const held = new Set(trackedRows.map((row) => ideaKey(row.kind, row.ref)));
      const suggestions: DiscoverIdea[] = [];
      for (const result of results) {
        for (const recommended of result.recommendedSymbols ?? []) {
          if (held.has(ideaKey("symbol", recommended.symbol))) continue;
          const idea = ideaFromQuote({ symbol: recommended.symbol }, "related", tracked);
          if (idea !== null) suggestions.push(idea);
        }
      }
      const body: IdeaListResult = {
        items: await withPrices(mergeIdeas([suggestions], cap)),
      };
      return c.json(body);
    } catch (error) {
      return c.json(unavailable("related", error), 502);
    }
  })

  /**
   * One instrument, chosen at random. The "I just want to look at something"
   * button, and the answer to a discovery page's worst failure mode — a wall of
   * choices for a reader who has not got one.
   *
   * Two pools, picked between evenly: what is trending upstream, and the local
   * fund index. Including funds matters — a purely Yahoo-driven random would
   * only ever show US large caps, and this server's whole point is that the
   * China fund universe is addressable next to them.
   */
  .get("/random", async (c) => {
    const user = c.get("user");
    const tracked = await trackedFor(user.id);
    const preferFunds = Math.random() < 0.5;

    const fromFunds = async (): Promise<DiscoverIdea | null> => {
      const rows = await fundRepo.randomFunds(RANDOM_POOL);
      const fund = pickRandom(rows);
      return fund === null ? null : ideaFromFund(fund, "index", tracked);
    };

    const fromTrending = async (): Promise<DiscoverIdea | null> => {
      const result = await yahooFinanceClient.trendingSymbols(
        DEFAULT_TRENDING_REGION,
        { region: DEFAULT_TRENDING_REGION, count: RANDOM_POOL },
        yahooRequestOptions(),
      );
      const quote = pickRandom(result.quotes ?? []);
      return quote === null ? null : ideaFromQuote(quote as QuoteLike, "trending", tracked);
    };

    // Either source may be empty — a cache nobody has filled, an upstream that
    // is down — so the second is tried rather than returning nothing.
    const order = preferFunds ? [fromFunds, fromTrending] : [fromTrending, fromFunds];
    for (const attempt of order) {
      try {
        const idea = await attempt();
        if (idea !== null) {
          const [priced] = await withPrices([idea]);
          return c.json({ item: priced ?? idea });
        }
      } catch {
        // Try the other pool.
      }
    }
    return c.json({ error: "Nothing to suggest right now. Try again in a moment." }, 503);
  })

  /**
   * One untracked instrument, priced, with its history — what the star's
   * neighbour opens.
   *
   * The point is to be able to look before adding. It deliberately reuses the
   * watchlist's own pricing and series code rather than a lighter path of its
   * own: a preview that disagreed with the row the reader gets after adding
   * would be worse than no preview.
   */
  .get(
    "/preview",
    zValidator(
      "query",
      seriesQuerySchema.extend({
        kind: z.enum(WATCHLIST_ITEM_KINDS),
        ref: z.string().trim().min(1).max(32),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const { kind, ref, range } = c.req.valid("query");
      const item = { kind: kind as WatchlistItemKind, ref };

      const allowed = seriesBudget.take(user.id);
      if (!allowed.ok) {
        return c.json(
          {
            error: "Too many price histories requested. Give it a moment and try again.",
            retryAfterSeconds: allowed.retryAfterSeconds,
          },
          429,
          { "Retry-After": String(allowed.retryAfterSeconds) },
        );
      }

      const [{ values, names }, tracked] = await Promise.all([
        currentValues([item], { client: yahooFinanceClient, repo }),
        trackedFor(user.id),
      ]);
      const live = values.get(ideaKey(item.kind, item.ref)) ?? null;
      const name = names.get(item.ref) ?? null;
      // Carried so the preview's own star renders filled for something the
      // reader already tracks, exactly as the row it was opened from does.
      const lists = tracked.get(ideaKey(item.kind, item.ref)) ?? [];

      try {
        const series = await priceSeries(item, range, await loadSeriesDeps());
        return c.json({ item: { ...item, name }, live, series, tracked: lists });
      } catch (error) {
        if (error instanceof BarFetchRefused) {
          return c.json({ error: error.message }, 503, { "Retry-After": "5" });
        }
        // The quote is the part worth having; a chart that could not be drawn
        // degrades to a null series rather than losing the price with it.
        return c.json({ item: { ...item, name }, live, series: null, tracked: lists });
      }
    },
  );
