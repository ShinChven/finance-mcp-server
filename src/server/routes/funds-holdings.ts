/**
 * The holdings vocabulary the fund list is built from.
 *
 * Split out of `routes/funds.ts` for two reasons. Every one of these queries
 * answers the same question — what does this fund hold *now* — and they have to
 * agree on the answer: a list that counts one thing, filters on another, and
 * explains a match with a third is three bugs waiting. And they are raw enough
 * SQL that they need a test with Postgres behind them, which this module can
 * have because it takes its database as an argument and never touches config.
 */

import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import { fundHoldings, funds, instruments } from "../db/schema.js";
import { toCanonicalSymbol } from "../funds/symbols.js";
import { escapeLike } from "../lib/listing.js";

type Db = typeof Database;

/**
 * Restricts `fund_holdings` rows to each fund's newest disclosed report.
 *
 * Older quarters stay in the table, and none of the page's questions are about
 * them: a fund that held NVDA in 2022 and has since sold it is not an answer to
 * "who holds NVDA", and counting a position held for a year once per cached
 * quarter turns a 20-name portfolio into 80. The drill-down and
 * `findFundsByStock` already read the table this way.
 *
 * Raw SQL with its own `latest` alias rather than a joined subquery: it can
 * then be dropped into a `where`, a derived table, and a correlated `exists`
 * alike, and the alias keeps the inner `report_date` unambiguous — the
 * regression `funds/repo-sql.test.ts` exists for.
 */
export const onLatestReport = sql`${fundHoldings.reportDate} = (select max(report_date) from fund_holdings latest where latest.fund_code = ${fundHoldings.fundCode})`;

/**
 * What makes a holding row match a search term: its own symbol or name, the
 * canonical form of the symbol, or the name of the instrument behind it.
 *
 * Shared by the list filter and the matched-holding lookup, so a fund that came
 * back for its holdings can always say which one. Were the two to drift, a fund
 * matched by one predicate and explained by neither would look like a bug in
 * the search.
 */
export function holdingMatches(q: string): SQL {
  const like = `%${escapeLike(q)}%`;
  const canonical = toCanonicalSymbol(q);

  const parts: SQL[] = [ilike(fundHoldings.symbol, like), ilike(fundHoldings.name, like)];
  if (canonical) parts.push(eq(fundHoldings.symbol, canonical));
  parts.push(sql`exists (
    select 1 from ${instruments}
    where ${instruments.symbol} = ${fundHoldings.symbol}
      and ${ilike(instruments.name, like)}
  )`);

  return or(...parts)!;
}

/** Does this fund's current portfolio contain something matching `q`? */
export function currentlyHolds(q: string): SQL {
  return sql`exists (
    select 1 from ${fundHoldings}
    where ${fundHoldings.fundCode} = ${funds.code}
      and ${onLatestReport}
      and (${holdingMatches(q)})
  )`;
}

/**
 * Holdings coverage per fund: how many names it discloses, and when.
 *
 * Grouping by the report date as well as the code is what keeps this one row
 * per fund — `onLatestReport` has already pinned the date to one value — while
 * making that date available to the list alongside the count.
 */
export function holdingsCoverage(db: Db) {
  return db
    .select({
      fundCode: fundHoldings.fundCode,
      n: count().as("n"),
      reportDate: fundHoldings.reportDate,
    })
    .from(fundHoldings)
    .where(onLatestReport)
    .groupBy(fundHoldings.fundCode, fundHoldings.reportDate)
    .as("holdings_count");
}

/** The holding that caused a fund to match a search. */
export interface MatchedHolding {
  symbol: string;
  name: string | null;
  weight: number;
  reportDate: string;
}

/**
 * Look up why each of `codes` matched `q`.
 *
 * DISTINCT ON keeps one row per fund — the heaviest matching name in its latest
 * report — so a fund holding both NVDA and NVDA-adjacent names still explains
 * itself in a single line. Called with the page's own codes, not the whole
 * result set, so it stays one small round trip.
 */
export async function matchedHoldings(
  db: Db,
  codes: string[],
  q: string,
): Promise<Map<string, MatchedHolding>> {
  const found = new Map<string, MatchedHolding>();
  if (codes.length === 0) return found;

  const rows = await db
    .selectDistinctOn([fundHoldings.fundCode], {
      fundCode: fundHoldings.fundCode,
      symbol: fundHoldings.symbol,
      name: fundHoldings.name,
      weight: fundHoldings.weight,
      reportDate: fundHoldings.reportDate,
    })
    .from(fundHoldings)
    .where(and(inArray(fundHoldings.fundCode, codes), holdingMatches(q), onLatestReport))
    .orderBy(fundHoldings.fundCode, desc(fundHoldings.weight));

  for (const row of rows) {
    found.set(row.fundCode, {
      symbol: row.symbol,
      name: row.name,
      weight: row.weight,
      reportDate: row.reportDate,
    });
  }
  return found;
}
