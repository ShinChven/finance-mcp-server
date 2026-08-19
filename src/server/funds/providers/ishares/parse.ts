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
  /** Ticker present but no market could be assigned — a new exchange string. */
  unmappedExchange: number;
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
  return stats.noTicker + stats.unmappedExchange + stats.noWeight;
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
 * Exchange strings to Yahoo suffixes.
 *
 * Matched by substring, lowercased, because iShares writes the same venue
 * several ways ("Nasdaq", "NASDAQ/NGS (Global Select Market)"). US venues map
 * to the empty suffix, which is what a Yahoo US symbol looks like.
 */
const EXCHANGE_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ["new york stock exchange", ""],
  ["nyse", ""],
  ["nasdaq", ""],
  ["cboe", ""],
  ["bats", ""],
  ["hong kong", ".HK"],
  ["tokyo stock exchange", ".T"],
  ["shanghai stock exchange", ".SS"],
  ["shenzhen stock exchange", ".SZ"],
  ["xetra", ".DE"],
  ["deutsche boerse", ".DE"],
  ["london stock exchange", ".L"],
  ["euronext paris", ".PA"],
  ["euronext amsterdam", ".AS"],
  ["six swiss", ".SW"],
  ["toronto stock exchange", ".TO"],
  ["australian securities exchange", ".AX"],
  ["asx", ".AX"],
  ["korea exchange", ".KS"],
  ["taiwan stock exchange", ".TW"],
  ["national stock exchange of india", ".NS"],
  ["bolsa mexicana", ".MX"],
  ["b3 s.a.", ".SA"],
  ["singapore exchange", ".SI"],
  ["bursa malaysia", ".KL"],
  ["stock exchange of thailand", ".BK"],
];

function suffixFor(exchange: string | undefined): string | null {
  if (exchange === undefined || exchange.trim() === "") return null;
  const needle = exchange.toLowerCase();
  for (const [fragment, suffix] of EXCHANGE_SUFFIXES) {
    if (needle.includes(fragment)) return suffix;
  }
  return null;
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
  return new Date(parsed).toISOString().slice(0, 10);
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

    const suffix = suffixFor(exchangeAt === -1 ? undefined : cells[exchangeAt]);
    if (suffix === null) {
      stats.unmappedExchange += 1;
      continue;
    }

    const symbol = toCanonicalSymbol(suffix === "" ? rawTicker : `${rawTicker}${suffix}`);
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

    entries.push({
      symbol,
      name: nameAt === -1 ? null : ((cells[nameAt] ?? "") || null),
      weight,
      reportDate,
    });
  }

  return { entries, stats, asOf };
}
