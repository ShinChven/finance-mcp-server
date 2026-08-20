/**
 * Pure parsers for iShares product-screener JSON and holdings CSV.
 *
 * IMPORTANT: as with the Eastmoney parsers, these response shapes are
 * undocumented and were written from the known structure of those endpoints,
 * **not** verified against live responses (the build sandbox has no egress to
 * those hosts). They are deliberately defensive — unreadable rows are counted
 * and skipped rather than thrown on — and every parser is a pure string→data
 * function, so a format drift is fixed here with a fixture and touches neither
 * the fetch layer nor the ingest.
 */

import type { HoldingEntry } from "../../provider.js";
import { toCanonicalSymbol } from "../../symbols.js";

export interface IsharesProduct {
  /** iShares' internal product id — the path segment holdings are fetched by. */
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

function asString(value: unknown): string | null {
  const raw = cell(value);
  if (typeof raw === "string") return raw.trim() === "" ? null : raw.trim();
  if (typeof raw === "number") return String(raw);
  return null;
}

function asNumber(value: unknown): number | null {
  const raw = cell(value);
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.eE+-]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
      data = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  if (data === null || typeof data !== "object") return [];

  const products: IsharesProduct[] = [];
  for (const [productId, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;

    const ticker = asString(row["localExchangeTicker"]);
    const name = asString(row["fundName"]);
    if (ticker === null || name === null) continue;
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker.toUpperCase())) continue;

    products.push({
      productId,
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

export type VenueLookup =
  | { kind: "known"; suffix: string }
  /** The family is recognized but the board is not identified. */
  | { kind: "ambiguous" }
  /** No rule matched — a venue the table has never seen. */
  | { kind: "unknown" };

export function lookupVenue(exchange: string | undefined): VenueLookup {
  if (exchange === undefined) return { kind: "unknown" };
  const needle = exchange.toLowerCase().replace(/\s+/g, " ").trim();
  if (needle === "" || needle === "-") return { kind: "unknown" };

  for (const rule of VENUE_RULES) {
    if (rule.match.some((fragment) => needle.includes(fragment))) {
      return { kind: "known", suffix: rule.suffix };
    }
  }
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

/** One CSV line into cells, honouring quoted fields and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** `"Aug 15, 2026"` / `"15-Aug-2026"` / `"2026-08-15"` → `2026-08-15`. */
export function parseAsOfDate(raw: string): string | null {
  const text = raw.trim().replace(/^"|"$/g, "");
  if (text === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The holdings CSV: a short preamble of fund-level facts, a blank line, then a
 * header row and the positions.
 *
 * The header is located by content rather than by line number — the preamble's
 * length varies by product, and counting lines is how this kind of parser
 * silently starts reading the wrong rows.
 */
export function parseHoldingsCsv(source: string, fallbackDate: string): IsharesHoldingsResult {
  const stats: IsharesHoldingStats = {
    noTicker: 0,
    unmappedExchange: 0,
    ambiguousExchange: 0,
    noWeight: 0,
    excluded: 0,
  };
  const lines = source.split(/\r?\n/);

  let asOf: string | null = null;
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (asOf === null && /holdings as of/i.test(line)) {
      const cells = splitCsvLine(line);
      const value = cells.slice(1).find((entry) => entry !== "");
      if (value !== undefined) asOf = parseAsOfDate(value);
    }
    if (/(^|,)\s*"?ticker"?\s*(,|$)/i.test(line) && /weight/i.test(line)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return { entries: [], stats, asOf };

  const header = splitCsvLine(lines[headerIndex] ?? "").map((cellName) =>
    cellName.toLowerCase().replace(/\s+/g, " ").trim(),
  );
  const indexOf = (...candidates: string[]): number => {
    for (const candidate of candidates) {
      const found = header.findIndex((name) => name === candidate);
      if (found !== -1) return found;
    }
    for (const candidate of candidates) {
      const found = header.findIndex((name) => name.startsWith(candidate));
      if (found !== -1) return found;
    }
    return -1;
  };

  const tickerAt = indexOf("ticker");
  const nameAt = indexOf("name");
  const weightAt = indexOf("weight (%)", "weight");
  const classAt = indexOf("asset class");
  const exchangeAt = indexOf("exchange");
  // Present in some products' files and absent from others, so it is read when
  // offered and never required.
  const isinAt = indexOf("isin");
  const reportDate = asOf ?? fallbackDate;

  const entries: HoldingEntry[] = [];
  const seen = new Set<string>();

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const cells = splitCsvLine(line);
    // The file ends with a disclaimer block; a row shorter than the header is
    // prose, not a position.
    if (cells.length < header.length - 2) continue;

    const assetClass = (classAt === -1 ? "" : (cells[classAt] ?? "")).toLowerCase();
    if (NON_EQUITY_CLASSES.has(assetClass)) {
      stats.excluded += 1;
      continue;
    }

    const rawTicker = (tickerAt === -1 ? "" : (cells[tickerAt] ?? "")).toUpperCase();
    const weightRaw = weightAt === -1 ? "" : (cells[weightAt] ?? "");
    const weight = Number(weightRaw.replace(/[^0-9.eE+-]/g, ""));

    if (rawTicker === "" || rawTicker === "-") {
      // A cash line without an asset-class column looks like this; treat a
      // weightless one as excluded rather than as drift.
      if (!Number.isFinite(weight) || weight === 0) stats.excluded += 1;
      else stats.noTicker += 1;
      continue;
    }
    if (!Number.isFinite(weight)) {
      stats.noWeight += 1;
      continue;
    }

    const venue = lookupVenue(exchangeAt === -1 ? undefined : cells[exchangeAt]);
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

    const isin = readIsin(isinAt === -1 ? undefined : cells[isinAt]);
    entries.push({
      symbol,
      name: nameAt === -1 ? null : ((cells[nameAt] ?? "") || null),
      weight,
      reportDate,
      ...(isin === null ? {} : { isin }),
    });
  }

  return { entries, stats, asOf };
}
