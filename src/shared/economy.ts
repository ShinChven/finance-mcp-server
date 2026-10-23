/**
 * Economic-series vocabulary shared by the server and the SPA.
 *
 * Pure data — no fetch, no drizzle, no config — so the web bundle and the tests
 * can import it without booting anything.
 *
 * The upstream is **DBnomics**, a free aggregator run by CEPREMAP that re-serves
 * FRED, BLS, Eurostat, ECB, IMF, OECD and a long tail of national statistics
 * offices behind one JSON API with no API key and no registration. That is the
 * whole reason it was chosen: it puts FRED's catalogue within reach without a
 * FRED key, so every upstream in this server stays free.
 *
 * A series is addressed the way DBnomics addresses it — `provider/dataset/code`
 * — and the catalogue below is a curated shortlist of the series people
 * actually ask for, because no agent knows offhand that core PCE is `PCEPILFE`.
 * The shortlist is a convenience, never a limit: `economicSeries` takes a raw
 * DBnomics path too, so anything in the aggregator is reachable whether or not
 * it is named here.
 */

/** How often a series publishes. Drives period-over-period arithmetic. */
export type Frequency = "annual" | "quarterly" | "monthly" | "weekly" | "daily";

/**
 * How to read the raw number.
 *
 * The distinction matters because an index level answers no question anyone
 * asked: "CPI is 320.4" is meaningless where "CPI is up 2.7% from a year ago"
 * is the number being looked for. Tools default `index` series to a
 * year-over-year transform for exactly that reason; a `rate` is already a
 * percent and a `level` is already a count, so both are reported as published.
 */
export type SeriesKind = "index" | "rate" | "level";

export interface IndicatorDescriptor {
  /** Stable slug callers pass as `indicator`. */
  id: string;
  label: string;
  /** DBnomics provider code, e.g. "FRED". */
  provider: string;
  /** The series code within that provider, e.g. "CPIAUCSL". */
  code: string;
  frequency: Frequency;
  /** Unit as published, for display. Not parsed. */
  unit: string;
  kind: SeriesKind;
  /** One line on what the series is for, surfaced in tool output. */
  note: string;
}

/**
 * The curated shortlist, US-first because that is what "key economic data"
 * overwhelmingly means in practice.
 *
 * Deliberately not exhaustive. Every entry is a well-known FRED series code;
 * the rest of DBnomics — Eurostat, ECB, IMF, World Bank, national offices — is
 * reached by passing a raw `seriesId` instead, which costs the caller nothing
 * but knowing the code.
 */
export const INDICATORS: readonly IndicatorDescriptor[] = [
  // ---- Prices -------------------------------------------------------------
  {
    id: "us-cpi",
    label: "US CPI (all items)",
    provider: "FRED",
    code: "CPIAUCSL",
    frequency: "monthly",
    unit: "Index 1982-1984=100, seasonally adjusted",
    kind: "index",
    note: "Headline consumer inflation. Read year-over-year, not as a level.",
  },
  {
    id: "us-core-cpi",
    label: "US core CPI (ex food and energy)",
    provider: "FRED",
    code: "CPILFESL",
    frequency: "monthly",
    unit: "Index 1982-1984=100, seasonally adjusted",
    kind: "index",
    note: "Headline CPI with the two most volatile components removed.",
  },
  {
    id: "us-pce-price",
    label: "US PCE price index",
    provider: "FRED",
    code: "PCEPI",
    frequency: "monthly",
    unit: "Index 2017=100, seasonally adjusted",
    kind: "index",
    note: "The broader consumption-based price measure.",
  },
  {
    id: "us-core-pce",
    label: "US core PCE price index",
    provider: "FRED",
    code: "PCEPILFE",
    frequency: "monthly",
    unit: "Index 2017=100, seasonally adjusted",
    kind: "index",
    note: "The Federal Reserve's 2% target is defined on this series.",
  },
  {
    id: "us-ppi",
    label: "US producer price index (all commodities)",
    provider: "FRED",
    code: "PPIACO",
    frequency: "monthly",
    unit: "Index 1982=100",
    kind: "index",
    note: "Prices received by producers; often leads consumer prices.",
  },

  // ---- Labour -------------------------------------------------------------
  {
    id: "us-unemployment",
    label: "US unemployment rate",
    provider: "FRED",
    code: "UNRATE",
    frequency: "monthly",
    unit: "Percent, seasonally adjusted",
    kind: "rate",
    note: "The headline U-3 rate.",
  },
  {
    id: "us-nonfarm-payrolls",
    label: "US nonfarm payrolls (total employment)",
    provider: "FRED",
    code: "PAYEMS",
    frequency: "monthly",
    unit: "Thousands of persons, seasonally adjusted",
    kind: "level",
    note: "A level, not the monthly change the headline quotes — difference it to get the print.",
  },
  {
    id: "us-initial-claims",
    label: "US initial jobless claims",
    provider: "FRED",
    code: "ICSA",
    frequency: "weekly",
    unit: "Number, seasonally adjusted",
    kind: "level",
    note: "The highest-frequency labour signal available.",
  },
  {
    id: "us-participation",
    label: "US labour force participation rate",
    provider: "FRED",
    code: "CIVPART",
    frequency: "monthly",
    unit: "Percent, seasonally adjusted",
    kind: "rate",
    note: "Context for the unemployment rate: a falling rate can flatter it.",
  },

  // ---- Growth -------------------------------------------------------------
  {
    id: "us-real-gdp",
    label: "US real GDP",
    provider: "FRED",
    code: "GDPC1",
    frequency: "quarterly",
    unit: "Billions of chained 2017 dollars, seasonally adjusted annual rate",
    kind: "level",
    note: "Inflation-adjusted output.",
  },
  {
    id: "us-gdp",
    label: "US nominal GDP",
    provider: "FRED",
    code: "GDP",
    frequency: "quarterly",
    unit: "Billions of dollars, seasonally adjusted annual rate",
    kind: "level",
    note: "Output at current prices.",
  },
  {
    id: "us-industrial-production",
    label: "US industrial production",
    provider: "FRED",
    code: "INDPRO",
    frequency: "monthly",
    unit: "Index 2017=100, seasonally adjusted",
    kind: "index",
    note: "Manufacturing, mining and utilities output.",
  },
  {
    id: "us-retail-sales",
    label: "US advance retail sales",
    provider: "FRED",
    code: "RSAFS",
    frequency: "monthly",
    unit: "Millions of dollars, seasonally adjusted",
    kind: "level",
    note: "The monthly read on consumer demand.",
  },

  // ---- Rates --------------------------------------------------------------
  {
    id: "us-fed-funds",
    label: "US effective federal funds rate (monthly)",
    provider: "FRED",
    code: "FEDFUNDS",
    frequency: "monthly",
    unit: "Percent",
    kind: "rate",
    note: "The policy rate, monthly average.",
  },
  {
    id: "us-fed-funds-daily",
    label: "US effective federal funds rate (daily)",
    provider: "FRED",
    code: "DFF",
    frequency: "daily",
    unit: "Percent",
    kind: "rate",
    note: "The same policy rate, daily.",
  },
  {
    id: "us-3m",
    label: "US 3-month Treasury yield",
    provider: "FRED",
    code: "DGS3MO",
    frequency: "daily",
    unit: "Percent",
    kind: "rate",
    note: "Constant-maturity yield.",
  },
  {
    id: "us-2y",
    label: "US 2-year Treasury yield",
    provider: "FRED",
    code: "DGS2",
    frequency: "daily",
    unit: "Percent",
    kind: "rate",
    note: "The maturity most sensitive to policy expectations.",
  },
  {
    id: "us-10y",
    label: "US 10-year Treasury yield",
    provider: "FRED",
    code: "DGS10",
    frequency: "daily",
    unit: "Percent",
    kind: "rate",
    note: "The global discount-rate benchmark.",
  },
  {
    id: "us-30y",
    label: "US 30-year Treasury yield",
    provider: "FRED",
    code: "DGS30",
    frequency: "daily",
    unit: "Percent",
    kind: "rate",
    note: "The long end.",
  },
  {
    id: "us-10y-2y-spread",
    label: "US 10-year minus 2-year Treasury spread",
    provider: "FRED",
    code: "T10Y2Y",
    frequency: "daily",
    unit: "Percentage points",
    kind: "rate",
    note: "Negative is an inverted curve, the classic recession signal.",
  },
  {
    id: "us-10y-3m-spread",
    label: "US 10-year minus 3-month Treasury spread",
    provider: "FRED",
    code: "T10Y3M",
    frequency: "daily",
    unit: "Percentage points",
    kind: "rate",
    note: "The inversion measure the New York Fed's recession model uses.",
  },
  {
    id: "us-30y-mortgage",
    label: "US 30-year fixed mortgage rate",
    provider: "FRED",
    code: "MORTGAGE30US",
    frequency: "weekly",
    unit: "Percent",
    kind: "rate",
    note: "Where policy reaches households.",
  },

  // ---- Money, sentiment, housing -----------------------------------------
  {
    id: "us-m2",
    label: "US M2 money stock",
    provider: "FRED",
    code: "M2SL",
    frequency: "monthly",
    unit: "Billions of dollars, seasonally adjusted",
    kind: "level",
    note: "Broad money.",
  },
  {
    id: "us-consumer-sentiment",
    label: "US consumer sentiment (University of Michigan)",
    provider: "FRED",
    code: "UMCSENT",
    frequency: "monthly",
    unit: "Index 1966:Q1=100",
    kind: "index",
    note: "Survey-based, and a level worth reading directly against its own history.",
  },
  {
    id: "us-housing-starts",
    label: "US housing starts",
    provider: "FRED",
    code: "HOUST",
    frequency: "monthly",
    unit: "Thousands of units, seasonally adjusted annual rate",
    kind: "level",
    note: "The rate-sensitive part of the real economy.",
  },
  {
    id: "us-dollar-index",
    label: "US nominal broad dollar index",
    provider: "FRED",
    code: "DTWEXBGS",
    frequency: "daily",
    unit: "Index Jan 2006=100",
    kind: "index",
    note: "Trade-weighted dollar against a broad basket.",
  },
] as const;

const BY_ID = new Map(INDICATORS.map((indicator) => [indicator.id, indicator]));

export function findIndicator(id: string): IndicatorDescriptor | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

export const INDICATOR_IDS: readonly string[] = INDICATORS.map((i) => i.id);

/**
 * How many observations of a given frequency fall in a year.
 *
 * Used only to size a lookback window, never to index into an array: real
 * series have gaps (a daily rate series skips weekends and holidays), so
 * year-over-year is matched by date rather than by counting back N rows.
 */
export function periodsPerYear(frequency: Frequency): number {
  switch (frequency) {
    case "annual":
      return 1;
    case "quarterly":
      return 4;
    case "monthly":
      return 12;
    case "weekly":
      return 52;
    case "daily":
      return 260;
  }
}

/** DBnomics spells frequencies out; anything unrecognized is treated as monthly. */
export function toFrequency(value: string | null | undefined): Frequency {
  switch ((value ?? "").trim().toLowerCase()) {
    case "annual":
    case "a":
      return "annual";
    case "quarterly":
    case "q":
      return "quarterly";
    case "weekly":
    case "w":
      return "weekly";
    case "daily":
    case "d":
      return "daily";
    default:
      return "monthly";
  }
}
