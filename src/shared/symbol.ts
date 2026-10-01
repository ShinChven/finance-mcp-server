/**
 * The symbol page's vocabulary — shared by `/api/symbols` and the page itself.
 *
 * The watchlist answers "how is everything I track doing" in one row each. The
 * symbol page answers the follow-up: *tell me everything about this one*. It is
 * the deepest view the server offers of a single listing — candles with
 * indicators, the profile, statements, earnings, analyst coverage, options,
 * news, the funds that hold it and its filings — and almost all of it was
 * already reachable over MCP. This file is what lets the dashboard reach it too.
 *
 * Every piece of page state is a URL param, as everywhere else: a link to NVDA
 * on weekly candles over five years with MACD showing, opened on the options
 * tab at the March expiry, reproduces exactly that. `parseSymbolParams` is the
 * one place those params are read and defaulted, and the API accepts the same
 * names so the URL maps straight onto the request.
 *
 * Pure, like the other shared modules: no drizzle, no config.
 */

import { z } from "zod";
import { parseIndicators, type IndicatorId } from "./indicators.js";
import {
  SERIES_RANGES,
  type SeriesEvent,
  type SeriesRangeId,
  type SeriesStatsView,
} from "./series.js";

/* ------------------------------------------------------------------------ */
/* Addressing                                                               */
/* ------------------------------------------------------------------------ */

/**
 * What a Yahoo symbol can look like: `NVDA`, `0700.HK`, `BRK-B`, `^GSPC`,
 * `BTC-USD`, `GC=F`, `EURUSD=X`. Anything else is refused before it reaches an
 * upstream call or a cache key.
 */
export const SYMBOL_PATTERN = /^[A-Za-z0-9.\-^=_]{1,32}$/;

export const symbolParamSchema = z
  .string()
  .trim()
  .regex(SYMBOL_PATTERN, "not a valid symbol")
  .transform((value) => value.toUpperCase());

/** Canonical spelling, or null when the input could not be a symbol at all. */
export function normalizeSymbol(value: string): string | null {
  const parsed = symbolParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The page's own address. `^` must be encoded or a router reads it literally. */
export function symbolPath(symbol: string): string {
  return `/symbol/${encodeURIComponent(symbol.toUpperCase())}`;
}

/* ------------------------------------------------------------------------ */
/* Page params                                                              */
/* ------------------------------------------------------------------------ */

export const SYMBOL_TABS = [
  "summary",
  "financials",
  "earnings",
  "analysis",
  "options",
  "news",
  "funds",
  "filings",
] as const;
export type SymbolTab = (typeof SYMBOL_TABS)[number];

export const SYMBOL_TAB_LABELS: Record<SymbolTab, string> = {
  summary: "Summary",
  financials: "Financials",
  earnings: "Earnings",
  analysis: "Analysis",
  options: "Options",
  news: "News",
  funds: "Held by funds",
  filings: "SEC filings",
};

/**
 * Which tabs a listing can fill.
 *
 * An index has no statements, a crypto pair no analysts, and a Shanghai listing
 * no SEC filer or US options chain. A tab that can only ever say "nothing here"
 * is noise, so it is not offered — the decision is made from what the quote
 * says the instrument is, never from the symbol's spelling.
 */
export function tabsFor(quoteType: string | null, market: string | null): SymbolTab[] {
  const type = (quoteType ?? "").toUpperCase();
  const us = market === null || market === "us_market";
  if (type === "EQUITY") {
    return SYMBOL_TABS.filter((tab) => (tab === "options" || tab === "filings" ? us : true));
  }
  if (type === "ETF" || type === "MUTUALFUND") {
    return ["summary", ...(us && type === "ETF" ? (["options"] as const) : []), "news"];
  }
  return ["summary", "news"];
}

export const CHART_STYLES = ["candle", "line"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/**
 * Candle width. `auto` picks one from the range so a window is drawn in a
 * readable number of candles: daily up to a year, weekly over five, monthly
 * over the whole history. Intraday ranges ignore this — their granularity is
 * fixed by what the upstream serves.
 */
export const CANDLE_INTERVALS = ["auto", "1d", "1wk", "1mo"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];
export type ResolvedInterval = "5m" | "15m" | "1d" | "1wk" | "1mo";

export const CANDLE_INTERVAL_LABELS: Record<CandleInterval, string> = {
  auto: "Auto",
  "1d": "Daily",
  "1wk": "Weekly",
  "1mo": "Monthly",
};

export function resolveInterval(range: SeriesRangeId, interval: CandleInterval): ResolvedInterval {
  if (range === "1d") return "5m";
  if (range === "5d") return "15m";
  if (interval !== "auto") return interval;
  if (range === "5y") return "1wk";
  if (range === "max") return "1mo";
  return "1d";
}

export const STATEMENTS = ["income", "balance", "cashflow"] as const;
export type Statement = (typeof STATEMENTS)[number];
export const STATEMENT_LABELS: Record<Statement, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow",
};

export const STATEMENT_PERIODS = ["annual", "quarterly"] as const;
export type StatementPeriod = (typeof STATEMENT_PERIODS)[number];

/** Filing forms offered as a filter; anything else is reachable via "All". */
export const FILING_FORMS = ["10-K", "10-Q", "8-K", "4", "DEF 14A", "S-1"] as const;

/** A year of daily candles is too dense to read; six months is ~125 of them. */
export const DEFAULT_SYMBOL_RANGE: SeriesRangeId = "6m";

const RANGE_IDS = SERIES_RANGES.map((range) => range.id) as [SeriesRangeId, ...SeriesRangeId[]];

export interface SymbolPageParams {
  tab: SymbolTab;
  range: SeriesRangeId;
  style: ChartStyle;
  interval: CandleInterval;
  ind: IndicatorId[];
  statement: Statement;
  period: StatementPeriod;
  /** Options expiry as `YYYY-MM-DD`; empty means the nearest one. */
  expiry: string;
  /** Filing form filter; empty means every form. */
  form: string;
  /** Which watchlist the side rail shows; empty means the first one. */
  list: string;
}

export const SYMBOL_PARAM_DEFAULTS: SymbolPageParams = {
  tab: "summary",
  range: DEFAULT_SYMBOL_RANGE,
  style: "candle",
  interval: "auto",
  ind: parseIndicators(null),
  statement: "income",
  period: "annual",
  expiry: "",
  form: "",
  list: "",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fieldSchemas = {
  tab: z.enum(SYMBOL_TABS),
  range: z.enum(RANGE_IDS),
  style: z.enum(CHART_STYLES),
  interval: z.enum(CANDLE_INTERVALS),
  statement: z.enum(STATEMENTS),
  period: z.enum(STATEMENT_PERIODS),
  expiry: z.string().regex(ISO_DATE),
  form: z.string().trim().min(1).max(20),
  list: z.string().trim().min(1).max(64),
} as const;

type ScalarKey = keyof typeof fieldSchemas;

/**
 * Reads the page's params, field by field.
 *
 * Each field is validated on its own and falls back to its default when it is
 * absent or malformed: one bad value in a hand-edited URL should cost that one
 * setting, not the whole page.
 */
export function parseSymbolParams(search: URLSearchParams): SymbolPageParams {
  const out: SymbolPageParams = { ...SYMBOL_PARAM_DEFAULTS, ind: parseIndicators(search.get("ind")) };
  for (const key of Object.keys(fieldSchemas) as ScalarKey[]) {
    const raw = search.get(key);
    if (raw === null || raw === "") continue;
    const parsed = fieldSchemas[key].safeParse(raw);
    if (parsed.success) (out as unknown as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* API query schemas                                                        */
/* ------------------------------------------------------------------------ */

export const candleQuerySchema = z.object({
  range: z.enum(RANGE_IDS).default(DEFAULT_SYMBOL_RANGE),
  interval: z.enum(CANDLE_INTERVALS).default("auto"),
});

export const financialsQuerySchema = z.object({
  statement: z.enum(STATEMENTS).default("income"),
  period: z.enum(STATEMENT_PERIODS).default("annual"),
});

export const optionsQuerySchema = z.object({
  expiry: z.string().regex(ISO_DATE).optional(),
});

export const filingsQuerySchema = z.object({
  form: z.string().trim().min(1).max(20).optional(),
});

export const boardQuerySchema = z.object({
  symbols: z
    .string()
    .trim()
    .max(600)
    .optional()
    .transform((value) =>
      value === undefined || value === ""
        ? undefined
        : [...new Set(value.split(",").map((part) => part.trim().toUpperCase()))]
            .filter((part) => SYMBOL_PATTERN.test(part))
            .slice(0, 40),
    ),
});

/* ------------------------------------------------------------------------ */
/* The market board                                                         */
/* ------------------------------------------------------------------------ */

/**
 * The instruments the board opens on: the benchmarks a reader glances at
 * before looking at anything of their own. Grouped by what they measure rather
 * than by where they trade, because "how are rates doing" is one question even
 * though the answer lives on three exchanges.
 */
export const BOARD_GROUPS = [
  {
    id: "us",
    label: "US indices",
    symbols: ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"],
  },
  {
    id: "asia",
    label: "Asia",
    symbols: ["000001.SS", "399001.SZ", "000300.SS", "^HSI", "^N225"],
  },
  {
    id: "europe",
    label: "Europe",
    symbols: ["^STOXX50E", "^FTSE", "^GDAXI"],
  },
  {
    id: "macro",
    label: "Rates, FX & commodities",
    symbols: ["^TNX", "DX-Y.NYB", "CNY=X", "GC=F", "CL=F"],
  },
  {
    id: "crypto",
    label: "Crypto",
    symbols: ["BTC-USD", "ETH-USD", "SOL-USD"],
  },
] as const;

/* ------------------------------------------------------------------------ */
/* Response shapes                                                          */
/* ------------------------------------------------------------------------ */

/** What a listing is — everything about it that is not a price. */
export interface SymbolIdentity {
  symbol: string;
  name: string | null;
  exchange: string | null;
  /** Yahoo's quote type: `EQUITY`, `ETF`, `INDEX`, `CRYPTOCURRENCY`, … */
  quoteType: string | null;
  /** Yahoo's market bucket: `us_market`, `hk_market`, `cn_market`, … */
  market: string | null;
  currency: string | null;
  /** IANA zone the exchange keeps time in. */
  timezone: string | null;
}

/**
 * Session detail the watchlist row has no room for but a quote page does.
 *
 * All of it arrives in the same quote payload as the price.
 */
export interface SymbolSession {
  open: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  averageVolume10Day: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  sharesOutstanding: number | null;
  fiftyTwoWeekChangePercent: number | null;
  /** The next scheduled earnings release, as an instant, when one is announced. */
  earningsAt: string | null;
}

/**
 * One candle.
 *
 * `t` is an exchange-local `YYYY-MM-DD` for daily and longer candles (the first
 * trading day of a week or month) and an ISO instant intraday. `session` is the
 * exchange date the candle belongs to in both cases, which is what VWAP resets
 * on and what the axis draws day separators from.
 */
export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  session: string;
}

export interface CandleSeries {
  symbol: string;
  range: SeriesRangeId;
  interval: ResolvedInterval;
  intraday: boolean;
  timezone: string;
  timezoneLabel: string;
  currency: string | null;
  /**
   * Every candle sent, including history before the window so indicators are
   * warm at its left edge. Only `candles.slice(firstVisible)` is drawn.
   */
  candles: Candle[];
  firstVisible: number;
  /** Intraday only: the prior session's close, the baseline a 1D chart is read against. */
  previousClose: number | null;
  /** Splits and dividends inside the visible window. */
  events: SeriesEvent[];
  /** Over the visible window, on the adjusted series where one exists. */
  stats: SeriesStatsView | null;
  /** First visible close (or the previous close intraday) to the last one, raw. */
  changePercent: number | null;
  staleness: "live" | "cached";
}

export interface AnalystTrendRow {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface UpgradeRow {
  date: string | null;
  firm: string;
  action: string;
  fromGrade: string | null;
  toGrade: string | null;
  priceTargetAction: string | null;
  currentTarget: number | null;
  priorTarget: number | null;
}

export interface HolderRow {
  organization: string;
  /** Percent of shares outstanding. */
  percentHeld: number | null;
  position: number | null;
  value: number | null;
  /** Percent change in the position since the previous report. */
  percentChange: number | null;
  reportDate: string | null;
}

export interface InsiderTransactionRow {
  name: string;
  relation: string | null;
  text: string | null;
  date: string | null;
  shares: number | null;
  value: number | null;
}

/**
 * The quote-summary modules, normalised.
 *
 * Ratios that Yahoo serves as fractions (margins, payout, ownership) arrive
 * here as percentages, and every field says so in its name. A page that shows
 * one margin as 0.25 and the next as 25% teaches the reader to distrust both.
 */
export interface SymbolProfile {
  symbol: string;
  name: string | null;
  quoteType: string | null;
  currency: string | null;
  /** The currency the statements are reported in, which can differ from the listing's. */
  financialCurrency: string | null;
  company: {
    sector: string | null;
    industry: string | null;
    country: string | null;
    city: string | null;
    website: string | null;
    employees: number | null;
    summary: string | null;
    officers: { name: string; title: string | null; age: number | null; totalPay: number | null }[];
  } | null;
  valuation: {
    marketCap: number | null;
    enterpriseValue: number | null;
    trailingPe: number | null;
    forwardPe: number | null;
    pegRatio: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    evToRevenue: number | null;
    evToEbitda: number | null;
    bookValuePerShare: number | null;
    trailingEps: number | null;
    forwardEps: number | null;
  };
  profitability: {
    grossMarginPercent: number | null;
    operatingMarginPercent: number | null;
    profitMarginPercent: number | null;
    ebitdaMarginPercent: number | null;
    returnOnAssetsPercent: number | null;
    returnOnEquityPercent: number | null;
    revenueGrowthPercent: number | null;
    earningsGrowthPercent: number | null;
  };
  financials: {
    totalRevenue: number | null;
    ebitda: number | null;
    totalCash: number | null;
    totalDebt: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    operatingCashflow: number | null;
    freeCashflow: number | null;
  };
  dividends: {
    rate: number | null;
    yieldPercent: number | null;
    payoutRatioPercent: number | null;
    fiveYearAverageYieldPercent: number | null;
    exDividendDate: string | null;
    dividendDate: string | null;
    lastSplitFactor: string | null;
    lastSplitDate: string | null;
  };
  shares: {
    beta: number | null;
    sharesOutstanding: number | null;
    floatShares: number | null;
    sharesShort: number | null;
    shortPercentOfFloat: number | null;
    shortRatio: number | null;
    insidersPercent: number | null;
    institutionsPercent: number | null;
    institutionsCount: number | null;
  };
  analyst: {
    targetLow: number | null;
    targetMean: number | null;
    targetMedian: number | null;
    targetHigh: number | null;
    /** 1 = strong buy … 5 = strong sell. */
    recommendationMean: number | null;
    recommendationKey: string | null;
    analysts: number | null;
    trend: AnalystTrendRow[];
    upgrades: UpgradeRow[];
  } | null;
  events: {
    nextEarnings: string | null;
    earningsRange: string[];
    earningsIsEstimate: boolean | null;
    epsEstimate: number | null;
    revenueEstimate: number | null;
  };
  ownership: {
    institutions: HolderRow[];
    funds: HolderRow[];
    insiders: InsiderTransactionRow[];
  };
  fund: {
    family: string | null;
    category: string | null;
    legalType: string | null;
    expenseRatioPercent: number | null;
    totalAssets: number | null;
    yieldPercent: number | null;
    ytdReturnPercent: number | null;
    threeYearReturnPercent: number | null;
    fiveYearReturnPercent: number | null;
    inceptionDate: string | null;
    holdings: { symbol: string; name: string; percent: number }[];
    sectors: { sector: string; percent: number }[];
    allocation: { stock: number | null; bond: number | null; cash: number | null; other: number | null };
  } | null;
  /** Modules that were asked for and did not come back; the page says so. */
  degraded: string[];
}

export interface EarningsSurpriseRow {
  quarter: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  beat: boolean | null;
}

export interface EarningsEstimateRow {
  period: string | null;
  endDate: string | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  yearAgoEps: number | null;
  analysts: number | null;
  revenueAvg: number | null;
  revenueGrowth: number | null;
}

export interface EarningsRevisionRow {
  period: string | null;
  endDate: string | null;
  epsCurrent: number | null;
  eps7DaysAgo: number | null;
  eps30DaysAgo: number | null;
  eps60DaysAgo: number | null;
  eps90DaysAgo: number | null;
  revision30dPercent: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  analystsRevisingUp30d: number | null;
  analystsRevisingDown30d: number | null;
}

export interface EarningsView {
  symbol: string;
  nextEarningsDate: string | null;
  surprises: EarningsSurpriseRow[];
  beatStreak: number;
  estimates: EarningsEstimateRow[];
  revisions: EarningsRevisionRow[];
  /** Reported revenue and earnings, oldest first, for the bar charts. */
  quarterly: { label: string; revenue: number | null; earnings: number | null }[];
  yearly: { label: string; revenue: number | null; earnings: number | null }[];
  financialCurrency: string | null;
}

export interface StatementRow {
  key: string;
  label: string;
  /** How the client formats it: money is compacted, per-share is not. */
  unit: "money" | "perShare" | "shares";
  /** Aligned with `columns`. */
  values: (number | null)[];
  /** Subtotals are set in bold, the way a printed statement does it. */
  emphasis: boolean;
}

export interface StatementView {
  symbol: string;
  statement: Statement;
  period: StatementPeriod;
  /** Period-end dates, newest first. */
  columns: string[];
  rows: StatementRow[];
}

export interface TechnicalOutlook {
  horizon: "short" | "intermediate" | "long";
  direction: string | null;
  score: number | null;
  description: string | null;
  sectorDirection: string | null;
  indexDirection: string | null;
}

export interface AnalysisView {
  symbol: string;
  outlooks: TechnicalOutlook[];
  keyTechnicals: {
    support: number | null;
    resistance: number | null;
    stopLoss: number | null;
    provider: string | null;
  } | null;
  valuation: { description: string | null; discount: string | null; relativeValue: string | null } | null;
  recommendation: { rating: string | null; targetPrice: number | null; provider: string | null } | null;
  /** Company scores against the sector, 0–1. */
  scores: { label: string; company: number | null; sector: number | null }[];
  bull: string[];
  bear: string[];
  developments: { headline: string; date: string | null }[];
  reports: {
    id: string;
    title: string;
    provider: string | null;
    date: string | null;
    rating: string | null;
    targetPrice: number | null;
    targetPriceStatus: string | null;
  }[];
}

export interface OptionQuote {
  contract: string;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  /** Implied volatility as a percentage. */
  impliedVolatilityPercent: number | null;
  inTheMoney: boolean;
}

export interface OptionChainView {
  symbol: string;
  currency: string | null;
  underlyingPrice: number | null;
  expirations: string[];
  expiry: string | null;
  rows: { strike: number; call: OptionQuote | null; put: OptionQuote | null }[];
  /** The strike nearest the underlying, which the table scrolls to. */
  atmStrike: number | null;
  totals: {
    callVolume: number;
    putVolume: number;
    callOpenInterest: number;
    putOpenInterest: number;
    /** Put/call ratio by volume, and by open interest; null without calls. */
    putCallVolumeRatio: number | null;
    putCallOpenInterestRatio: number | null;
    /** The strike at which expiring options would pay their holders least. */
    maxPain: number | null;
  };
}

export interface NewsArticle {
  id: string;
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string;
  relatedTickers: string[];
}

export interface FundHolderView {
  symbol: string;
  funds: {
    code: string;
    name: string;
    provider: string;
    domicile: string;
    isIndexFund: boolean;
    trackingIndex: string | null;
    weightPercent: number;
    reportDate: string | null;
  }[];
  note: string;
}

export interface FilingView {
  symbol: string;
  company: { cik: string; name: string; industry: string | null; fiscalYearEnd: string | null } | null;
  filings: {
    form: string;
    filingDate: string;
    reportDate: string | null;
    description: string | null;
    items: string[];
    url: string;
    accessionNumber: string;
  }[];
  /** Set when the issuer is not an SEC filer; the tab says why instead of failing. */
  unsupported: string | null;
}
