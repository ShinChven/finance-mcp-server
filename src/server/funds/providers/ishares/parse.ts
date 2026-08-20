/**
 * Pure parsers for the two iShares JSON planes.
 *
 * Both are keyless and need no session — the only requirement is a browser-like
 * User-Agent, which the client sends:
 *
 * - the **product screener**, one object keyed by portfolio id, ~80 fields per
 *   product, which is the whole US lineup in a single request; and
 * - **get-product-data**, the per-fund plane the product page itself calls,
 *   whose `holdings.all` component carries the complete published portfolio.
 *
 * The holdings plane used to be a CSV download at
 * `<product page>/1467271812596.ajax?fileType=csv`, and that is what this file
 * parsed. That endpoint has been retired: it now answers with the product page's
 * HTML — labelled `text/csv`, so the content type does not give it away — or
 * with a 404 or a redirect to the closed-funds page, depending on the fund.
 * Nothing about that reads as an error to a CSV parser, which simply finds no
 * header row and reports an empty portfolio; the version of this provider that
 * used it could never cache a single US ETF.
 *
 * The response shapes here are undocumented but no longer guesses: they are
 * taken from the request the product page makes, cross-checked against several
 * independent clients of the same endpoints. Every parser is a pure
 * payload→data function, so a format drift is a fixture-plus-parser fix that
 * touches neither the fetch layer nor the ingest.
 */

import type { HoldingEntry } from "../../provider.js";
import { toCanonicalSymbol } from "../../symbols.js";

export interface IsharesProduct {
  /**
   * iShares' internal portfolio id — the key the screener is keyed by, and the
   * only identifier the holdings plane accepts. Not the ticker: a ticker can be
   * reassigned between funds, and `get-product-data` does not take one.
   */
  productId: string;
  ticker: string;
  name: string;
  assetClass: string | null;
  subAssetClass: string | null;
  country: string | null;
  /** Total net assets in USD, as reported. */
  totalNetAssets: number | null;
  productPageUrl: string | null;
}

/**
 * Screener cells are `{ r: <raw>, d: "<display>" }` about half the time and a
 * bare scalar the rest, depending on the field. Both forms mean the same thing.
 */
function cell(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "r" in value) {
    return (value as { r: unknown }).r;
  }
  return value;
}

/**
 * iShares' "no data" sentinels.
 *
 * A missing field is not absent from the payload — it is present as `"-"` or a
 * blank string. Read as a value, `aladdinCountry: "-"` is a country that is not
 * the United States, which is enough to classify a domestic fund as having an
 * offshore mandate.
 */
function isBlank(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  return trimmed === "" || trimmed === "-";
}

function asString(value: unknown): string | null {
  const raw = cell(value);
  if (isBlank(raw)) return null;
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return null;
}

function asNumber(value: unknown): number | null {
  const raw = cell(value);
  if (isBlank(raw)) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.eE+-]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Product rows say so; configuration blocks filed beside them do not. */
function isFundData(row: Record<string, unknown>): boolean {
  const type = row["productType"];
  // Absent on a payload that does not carry the field at all, which is treated
  // as "cannot tell" rather than "not a fund" — the ticker checks still apply.
  return type === undefined || type === "ISHARES_FUND_DATA";
}

/** `productView` is the lineup a product belongs to: `["etf"]`, `["mutualFunds"]`. */
function isEtf(row: Record<string, unknown>): boolean {
  const views = row["productView"];
  if (!Array.isArray(views)) return true;
  return views.some((view) => String(view).toLowerCase() === "etf");
}

/** A product row is anything carrying the two fields that identify a fund. */
function isProductRow(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return "localExchangeTicker" in row || "fundName" in row;
}

/**
 * The product rows, wherever this response happens to keep them.
 *
 * The screener answers with one object keyed by product id, and that is what
 * this reads first. The fallbacks are cheap insurance against the two shapes
 * that would otherwise read as "iShares publishes no funds": an array, and a
 * payload wrapped one level deep under a container key. Rows are recognized by
 * their fields rather than by position, so a sibling key holding configuration
 * — which the screener does carry — is skipped instead of parsed.
 */
function productRows(data: object): [string, Record<string, unknown>][] {
  const entries = Array.isArray(data)
    ? data.map((row, index) => [String(index), row] as [string, unknown])
    : Object.entries(data as Record<string, unknown>);

  const direct = entries.filter((entry): entry is [string, Record<string, unknown>] =>
    isProductRow(entry[1]),
  );
  if (direct.length > 0) return direct;

  for (const [, value] of entries) {
    if (value === null || typeof value !== "object") continue;
    const nested = productRows(value);
    if (nested.length > 0) return nested;
  }
  return [];
}

/**
 * The screener returns one object keyed by product id, not an array.
 *
 * Products without a listing ticker are share classes and mutual funds that
 * have no holdings file to fetch; dropping them here keeps the universe equal
 * to "things this provider can actually cache".
 */
export function parseProductScreener(payload: string | unknown): IsharesProduct[] {
  let data: unknown = payload;
  if (typeof payload === "string") {
    try {
      // The leading BOM these files carry is not valid JSON, and dropping the
      // whole response over one invisible character is not a trade worth making.
      data = JSON.parse(payload.replace(/^\uFEFF/, ""));
    } catch {
      return [];
    }
  }
  if (data === null || typeof data !== "object") return [];

  const rows = productRows(data);
  const products: IsharesProduct[] = [];
  for (const [productId, row] of rows) {
    // The screener carries more than the ETF lineup — mutual-fund share classes
    // and other BlackRock products sit alongside it, and they have tickers too.
    // They have no holdings plane, so keeping them would fill the universe with
    // funds that can only ever fail to cache.
    if (!isFundData(row) || !isEtf(row)) continue;

    const ticker = asString(row["localExchangeTicker"]);
    const name = asString(row["fundName"]);
    if (ticker === null || name === null) continue;
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker.toUpperCase())) continue;

    products.push({
      // The row's own id wins over the key it is filed under; they agree, and
      // the field is the one the holdings plane documents.
      productId: asString(row["portfolioId"]) ?? productId,
      ticker: ticker.toUpperCase(),
      name,
      assetClass: asString(row["aladdinAssetClass"]),
      subAssetClass: asString(row["aladdinSubAssetClass"]),
      country: asString(row["aladdinCountry"]),
      totalNetAssets: asNumber(row["totalNetAssets"]),
      productPageUrl: asString(row["productPageUrl"]),
    });
  }
  return products;
}

/**
 * Why a holdings row was not stored.
 *
 * `excluded` is not a failure: a holdings file legitimately carries cash,
 * futures and FX rows that are not positions in an instrument. Keeping it apart
 * from `dropped` is what lets a non-zero drop count stay an actual alarm about
 * format drift rather than a number that is always large.
 */
export interface IsharesHoldingStats {
  /** Row had a weight but no usable ticker. */
  noTicker: number;
  /** A venue the table has never seen. Remedy: add a rule. */
  unmappedExchange: number;
  /**
   * A venue family that maps to more than one Yahoo suffix, named without
   * saying which board. Counted apart from `unmappedExchange` because the
   * remedy differs: the source changed how it labels a board, and guessing
   * would attach the fund to the wrong company.
   */
  ambiguousExchange: number;
  /** Ticker present but the weight cell was unreadable. */
  noWeight: number;
  /** Cash, derivative and FX rows, skipped on purpose. */
  excluded: number;
}

export interface IsharesHoldingsResult {
  entries: HoldingEntry[];
  stats: IsharesHoldingStats;
  /** The file's "as of" date, ISO. Null when the preamble did not carry one. */
  asOf: string | null;
  /**
   * Whether the payload was a holdings response at all.
   *
   * The difference between "this is not the holdings plane" and "this fund
   * holds nothing" is the difference between a broken fetch and an answer, and
   * both arrive here as an empty entry list. The client raises the first;
   * nothing downstream has to guess.
   */
  holdingsFound: boolean;
}

export function totalDrops(stats: IsharesHoldingStats): number {
  return stats.noTicker + stats.unmappedExchange + stats.ambiguousExchange + stats.noWeight;
}

/** Asset-class values that are not positions in a listed instrument. */
const NON_EQUITY_CLASSES = new Set([
  "cash",
  "cash and/or derivatives",
  "money market",
  "futures",
  "forwards",
  "fx",
  "currency",
  "swap",
  "swaps",
  "option",
  "options",
]);

/**
 * Exchange names to Yahoo symbol suffixes.
 *
 * Matched on a normalized, lowercased venue string, **most specific rule
 * first**. That ordering is load-bearing: several venue families map to more
 * than one Yahoo suffix, and a loose match on the family name would produce a
 * symbol that looks valid and points at the wrong instrument — or at nothing.
 * The two that bite:
 *
 * - Korea Exchange operates both KOSPI (`.KS`) and KOSDAQ (`.KQ`).
 * - The London Stock Exchange runs the domestic book (`.L`) and the
 *   International Order Book of depositary receipts (`.IL`).
 *
 * A venue that names such a family without saying which board is reported as
 * ambiguous and dropped, never guessed. Silently wrong is the one outcome this
 * parser must not produce: a wrong symbol joins a fund to somebody else's
 * company, which no downstream coverage figure would reveal.
 */
interface VenueRule {
  /** Lowercased fragments; any one of them identifies this venue. */
  match: readonly string[];
  /** Yahoo suffix, empty for US listings. */
  suffix: string;
}

const VENUE_RULES: readonly VenueRule[] = [
  // --- 1. Venue families with more than one board. These must precede the
  //        general rule for the same family or the general one wins.
  { match: ["kosdaq"], suffix: ".KQ" },
  { match: ["kospi", "korea exchange (stock market)"], suffix: ".KS" },
  { match: ["international order book", "(iob)"], suffix: ".IL" },
  { match: ["tsx venture", "tsx-v"], suffix: ".V" },

  // --- 2. Nasdaq's Nordic venues, before the bare "nasdaq" rule below. The
  //        operator brand is shared with the US market; the listings are not.
  { match: ["nasdaq stockholm", "stockholm stock exchange"], suffix: ".ST" },
  { match: ["nasdaq copenhagen", "copenhagen stock exchange"], suffix: ".CO" },
  { match: ["nasdaq helsinki", "helsinki stock exchange"], suffix: ".HE" },
  { match: ["nasdaq iceland"], suffix: ".IC" },
  { match: ["nasdaq riga"], suffix: ".RG" },
  { match: ["nasdaq tallinn"], suffix: ".TL" },
  { match: ["nasdaq vilnius"], suffix: ".VS" },

  // --- 3. Everything else outside the US, one board per family. Fragments are
  //        long enough to be unambiguous on their own.
  { match: ["hong kong"], suffix: ".HK" },
  { match: ["tokyo stock exchange"], suffix: ".T" },
  { match: ["shanghai stock exchange"], suffix: ".SS" },
  { match: ["shenzhen stock exchange"], suffix: ".SZ" },
  { match: ["xetra", "deutsche boerse", "deutsche börse"], suffix: ".DE" },
  { match: ["london stock exchange"], suffix: ".L" },
  { match: ["euronext paris"], suffix: ".PA" },
  { match: ["euronext amsterdam"], suffix: ".AS" },
  { match: ["euronext brussels"], suffix: ".BR" },
  { match: ["euronext lisbon"], suffix: ".LS" },
  { match: ["euronext dublin", "irish stock exchange"], suffix: ".IR" },
  { match: ["borsa italiana", "euronext milan"], suffix: ".MI" },
  { match: ["bolsa de madrid", "bme spanish", "sociedad de bolsas"], suffix: ".MC" },
  { match: ["six swiss", "swiss exchange"], suffix: ".SW" },
  { match: ["oslo bors", "oslo børs"], suffix: ".OL" },
  { match: ["vienna stock exchange", "wiener boerse", "wiener börse"], suffix: ".VI" },
  { match: ["toronto stock exchange"], suffix: ".TO" },
  { match: ["australian securities exchange", "asx"], suffix: ".AX" },
  { match: ["new zealand exchange", "nzx"], suffix: ".NZ" },
  { match: ["taiwan stock exchange"], suffix: ".TW" },
  { match: ["national stock exchange of india"], suffix: ".NS" },
  { match: ["bombay stock exchange", "bse limited"], suffix: ".BO" },
  { match: ["bolsa mexicana"], suffix: ".MX" },
  { match: ["b3 s.a.", "bm&fbovespa", "bovespa"], suffix: ".SA" },
  { match: ["santiago stock exchange", "bolsa de comercio de santiago"], suffix: ".SN" },
  { match: ["bolsa de valores de colombia"], suffix: ".CL" },
  { match: ["singapore exchange"], suffix: ".SI" },
  { match: ["bursa malaysia"], suffix: ".KL" },
  { match: ["stock exchange of thailand"], suffix: ".BK" },
  { match: ["indonesia stock exchange"], suffix: ".JK" },
  { match: ["philippine stock exchange"], suffix: ".PS" },
  { match: ["ho chi minh stock exchange"], suffix: ".VN" },
  { match: ["johannesburg stock exchange"], suffix: ".JO" },
  { match: ["tel aviv stock exchange"], suffix: ".TA" },
  { match: ["tadawul", "saudi exchange"], suffix: ".SR" },
  { match: ["borsa istanbul"], suffix: ".IS" },
  { match: ["warsaw stock exchange"], suffix: ".WA" },
  { match: ["prague stock exchange"], suffix: ".PR" },
  { match: ["budapest stock exchange"], suffix: ".BD" },
  { match: ["athens stock exchange"], suffix: ".AT" },
  { match: ["qatar exchange", "qatar stock exchange"], suffix: ".QA" },
  { match: ["abu dhabi securities"], suffix: ".AD" },
  { match: ["dubai financial market"], suffix: ".DU" },

  // --- 4. US venues last. Their fragments are the shortest and most generic
  //        in the table, so anything they could wrongly swallow has already
  //        been claimed above.
  { match: ["new york stock exchange", "nyse"], suffix: "" },
  { match: ["nasdaq"], suffix: "" },
  { match: ["cboe", "bats"], suffix: "" },
];

/**
 * Venue families that carry more than one Yahoo suffix. Reaching one of these
 * without a specific rule having matched means the source named the family but
 * not the board, so there is no answer — only a guess.
 */
const AMBIGUOUS_VENUES: readonly string[] = ["korea exchange"];

/**
 * Values that say "this line does not trade anywhere", which iShares writes for
 * rights, when-issued lines and derived entries.
 *
 * They belong with cash and futures in `excluded`, not with the drops. Counted
 * as drift they put a non-zero drop count on essentially every US fund, and a
 * count that is always non-zero stops being read — which is precisely how a
 * real format change goes unnoticed.
 */
const NON_MARKET_VENUES: readonly string[] = [
  "no market",
  "non-nms",
  "nnqs",
  "not applicable",
  "n/a",
];

export type VenueLookup =
  | { kind: "known"; suffix: string }
  /** The family is recognized but the board is not identified. */
  | { kind: "ambiguous" }
  /** The source says the line trades nowhere. Not a position, not drift. */
  | { kind: "none" }
  /** No rule matched — a venue the table has never seen. */
  | { kind: "unknown" };

export function lookupVenue(exchange: string | undefined): VenueLookup {
  if (exchange === undefined) return { kind: "unknown" };
  const needle = exchange.toLowerCase().replace(/\s+/g, " ").trim();
  if (needle === "" || needle === "-") return { kind: "none" };

  for (const rule of VENUE_RULES) {
    if (rule.match.some((fragment) => needle.includes(fragment))) {
      return { kind: "known", suffix: rule.suffix };
    }
  }
  if (NON_MARKET_VENUES.some((value) => needle.includes(value))) return { kind: "none" };
  if (AMBIGUOUS_VENUES.some((family) => needle.includes(family))) return { kind: "ambiguous" };
  return { kind: "unknown" };
}

/**
 * A US share-class ticker in Yahoo's spelling.
 *
 * Yahoo separates the class with a hyphen (`BRK-B`); holdings files use a dot
 * or a slash (`BRK.B`, `BRK/B`). Left alone, the symbol is not wrong so much as
 * absent — it would create an instrument row nothing can classify.
 */
function usTicker(raw: string): string {
  return raw.replace(/[./]/g, "-");
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** ISIN if the file carries a well-formed one, else null. */
export function readIsin(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim().toUpperCase();
  return ISIN_RE.test(value) ? value : null;
}

/* ── holdings: the `holdings.all` component of get-product-data ────────────── */

/**
 * The payload is columnar, not row-oriented.
 *
 * `componentsByNameMap.holdings.containersByNameMap.all.dataPointsByNameMap`
 * holds one entry per column, each with a `value` array; row `i` is the `i`th
 * element of every column. So the row count is the longest column among the
 * fields every fund has — an equity fund carries no `couponRate`, and taking
 * the length of a bond-only column would read the book as empty.
 */
function dataPoints(payload: unknown): Record<string, { value?: unknown }> {
  const root = payload as
    | {
        componentsByNameMap?: Record<
          string,
          { containersByNameMap?: Record<string, { dataPointsByNameMap?: Record<string, { value?: unknown }> }> }
        >;
      }
    | null
    | undefined;
  return root?.componentsByNameMap?.["holdings"]?.containersByNameMap?.["all"]?.dataPointsByNameMap ?? {};
}

function column(points: Record<string, { value?: unknown }>, name: string): unknown[] {
  const value = points[name]?.value;
  return Array.isArray(value) ? value : [];
}

/** Columns present for every fund, whatever it holds. */
const ROW_COUNT_COLUMNS = ["issueName", "ticker", "holdingPercent", "marketValue", "unitsHeld"];

/** `20260815` (number or string) → `2026-08-15`. */
export function ymdToIso(value: unknown): string | null {
  const raw = cell(value);
  if (isBlank(raw)) return null;
  const digits = String(typeof raw === "number" ? Math.trunc(raw) : raw).trim();
  if (!/^\d{8}$/.test(digits)) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * One `holdings.all` payload into canonical positions.
 *
 * `fallbackDate` is used only when the payload carries no `asOfDate`; it is the
 * caller's today, so a report date is never invented from a different day than
 * the fetch.
 */
export function parseHoldingsPayload(payload: unknown, fallbackDate: string): IsharesHoldingsResult {
  const stats: IsharesHoldingStats = {
    noTicker: 0,
    unmappedExchange: 0,
    ambiguousExchange: 0,
    noWeight: 0,
    excluded: 0,
  };

  const points = dataPoints(payload);
  const rows = ROW_COUNT_COLUMNS.reduce((most, name) => Math.max(most, column(points, name).length), 0);
  const asOf = ymdToIso(points["asOfDate"]?.value);
  // No columns at all is a payload that is not a holdings response — an unknown
  // component, an error envelope, a changed shape. The client raises it; a fund
  // that really holds nothing has columns of length zero and is reported as an
  // empty portfolio, which is an answer rather than a failure.
  if (Object.keys(points).length === 0) {
    return { entries: [], stats, asOf, holdingsFound: false };
  }

  const reportDate = asOf ?? fallbackDate;
  const entries: HoldingEntry[] = [];
  const seen = new Set<string>();

  const at = (name: string, index: number): unknown => column(points, name)[index];

  for (let index = 0; index < rows; index += 1) {
    const assetClass = (asString(at("assetClass", index)) ?? "").toLowerCase();
    if (NON_EQUITY_CLASSES.has(assetClass)) {
      stats.excluded += 1;
      continue;
    }

    const rawTicker = (asString(at("ticker", index)) ?? "").toUpperCase();
    const weight = asNumber(at("holdingPercent", index));

    if (rawTicker === "") {
      // A cash line without an asset class looks like this; a weightless one is
      // an exclusion rather than drift.
      if (weight === null || weight === 0) stats.excluded += 1;
      else stats.noTicker += 1;
      continue;
    }
    if (weight === null) {
      stats.noWeight += 1;
      continue;
    }

    const venue = lookupVenue(asString(at("exchange", index)) ?? undefined);
    if (venue.kind === "none") {
      stats.excluded += 1;
      continue;
    }
    if (venue.kind === "ambiguous") {
      stats.ambiguousExchange += 1;
      continue;
    }
    if (venue.kind === "unknown") {
      stats.unmappedExchange += 1;
      continue;
    }

    const local = venue.suffix === "" ? usTicker(rawTicker) : rawTicker;
    const symbol = toCanonicalSymbol(`${local}${venue.suffix}`);
    if (symbol === undefined) {
      stats.unmappedExchange += 1;
      continue;
    }
    // A dual-listed name can appear twice; the unique index would reject the
    // second row anyway, so fold it here where the weight can be summed.
    if (seen.has(symbol)) {
      const existing = entries.find((entry) => entry.symbol === symbol);
      if (existing) existing.weight = Math.round((existing.weight + weight) * 1e6) / 1e6;
      continue;
    }
    seen.add(symbol);

    const isin = readIsin(asString(at("isin", index)) ?? undefined);
    entries.push({
      symbol,
      name: asString(at("issueName", index)),
      weight,
      reportDate,
      ...(isin === null ? {} : { isin }),
    });
  }

  return { entries, stats, asOf, holdingsFound: true };
}
