/**
 * Thin fetch layer over SEC EDGAR.
 *
 * All shape knowledge lives in `parse.ts`; this module does HTTP, headers,
 * throttling, and caching. Unlike the Eastmoney client these endpoints are on
 * the MCP request path, so the caches exist to keep a burst of tool calls from
 * re-downloading multi-megabyte payloads — not just for politeness.
 *
 * EDGAR requires a descriptive User-Agent carrying a contact address and asks
 * for no more than 10 requests/second: https://www.sec.gov/os/webmaster-faq
 */

import { METRIC_DEFS } from "./metrics.js";
import {
  extractMetrics,
  normalizeTicker,
  parseCompanyInfo,
  parseFilings,
  parseTickerMap,
  type CompanyInfo,
  type FilingRow,
  type MetricSeries,
  type TickerEntry,
} from "./parse.js";

const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Mirrors the default in `config.ts`. This module deliberately does not import
 * `config`: everything on the MCP tool import path stays free of it (see the
 * type-only db import in `china/repo.ts`), so tools remain unit-testable
 * without a full environment. `config` still declares and validates the same
 * variable at server boot.
 */
const DEFAULT_CONTACT_EMAIL = "shinchven@gmail.com";
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1_000;
const COMPANY_TTL_MS = 15 * 60 * 1_000;
/** companyfacts slices are small, but one per issuer still adds up. */
const MAX_CACHED_COMPANIES = 16;

export interface EdgarEndpoints {
  tickerMap: string;
  submissions: (cik: string) => string;
  companyFacts: (cik: string) => string;
}

export const defaultEndpoints: EdgarEndpoints = {
  tickerMap: "https://www.sec.gov/files/company_tickers.json",
  submissions: (cik) => `https://data.sec.gov/submissions/CIK${cik}.json`,
  companyFacts: (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
};

export type Fetcher = typeof globalThis.fetch;

export interface EdgarClientOptions {
  fetchImpl?: Fetcher;
  endpoints?: EdgarEndpoints;
  /** Contact address embedded in the User-Agent EDGAR requires. */
  contactEmail?: string;
  /** Minimum gap between requests; EDGAR caps clients at 10 requests/second. */
  minIntervalMs?: number;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

export class EdgarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EdgarError";
  }
}

export class EdgarClient {
  private readonly fetchImpl: Fetcher;
  private readonly endpoints: EdgarEndpoints;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  private tickerMap: Cached<Map<string, TickerEntry>> | null = null;
  private readonly submissions = new Map<string, Cached<unknown>>();
  private readonly metrics = new Map<string, Cached<MetricSeries[]>>();

  constructor(options: EdgarClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.endpoints = options.endpoints ?? defaultEndpoints;
    this.minIntervalMs = options.minIntervalMs ?? 120;
    // Read at construction, not import: `getEdgarClient()` runs after the
    // server entry has loaded .env.
    const contact =
      options.contactEmail ?? process.env["SEC_EDGAR_CONTACT_EMAIL"] ?? DEFAULT_CONTACT_EMAIL;
    this.userAgent = `finance-mcp-server ${contact}`;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async getJson(url: string): Promise<unknown> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept-Encoding": "gzip, deflate",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new EdgarError(`SEC EDGAR request failed (${response.status}): ${url}`, response.status);
    }
    return response.json();
  }

  private async getText(url: string): Promise<string> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept-Encoding": "gzip, deflate",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new EdgarError(`SEC EDGAR request failed (${response.status}): ${url}`, response.status);
    }
    return response.text();
  }

  private static evict<T>(cache: Map<string, Cached<T>>): void {
    while (cache.size > MAX_CACHED_COMPANIES) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  /** Ticker → CIK for every issuer that files with the SEC. */
  async fetchTickerMap(): Promise<Map<string, TickerEntry>> {
    const cached = this.tickerMap;
    if (cached !== null && cached.expiresAt > Date.now()) return cached.value;
    const body = await this.getText(this.endpoints.tickerMap);
    const value = parseTickerMap(body);
    this.tickerMap = { value, expiresAt: Date.now() + TICKER_MAP_TTL_MS };
    return value;
  }

  /**
   * EDGAR is keyed by CIK, so every symbol-shaped input resolves here first.
   * Only US filers are covered — foreign issuers without an SEC registration
   * legitimately have no CIK.
   */
  async resolveTicker(symbol: string): Promise<TickerEntry> {
    const normalized = normalizeTicker(symbol);
    const map = await this.fetchTickerMap();
    const entry = map.get(normalized);
    if (entry === undefined) {
      throw new EdgarError(
        `No SEC filer matches "${symbol}". EDGAR only covers SEC registrants, so non-US ` +
          `listings and most ADRs have no CIK — use the Yahoo fundamentals tools for those.`,
      );
    }
    return entry;
  }

  private async fetchSubmissions(cik: string): Promise<unknown> {
    const cached = this.submissions.get(cik);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.getJson(this.endpoints.submissions(cik));
    this.submissions.set(cik, { value, expiresAt: Date.now() + COMPANY_TTL_MS });
    EdgarClient.evict(this.submissions);
    return value;
  }

  async fetchCompanyInfo(cik: string): Promise<CompanyInfo> {
    return parseCompanyInfo(await this.fetchSubmissions(cik));
  }

  async fetchFilings(
    cik: string,
    options: { forms?: readonly string[]; limit?: number } = {},
  ): Promise<{ company: CompanyInfo; filings: FilingRow[] }> {
    const body = await this.fetchSubmissions(cik);
    return {
      company: parseCompanyInfo(body),
      filings: parseFilings(body, cik, options),
    };
  }

  /**
   * companyfacts is several megabytes per issuer, so it is reduced to the
   * curated metric slice on the way in and the raw payload is dropped — only
   * the slice is cached.
   */
  async fetchMetrics(cik: string): Promise<MetricSeries[]> {
    const cached = this.metrics.get(cik);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;

    let raw: unknown;
    try {
      raw = await this.getJson(this.endpoints.companyFacts(cik));
    } catch (error) {
      if (error instanceof EdgarError && error.status === 404) {
        throw new EdgarError(
          `CIK ${cik} has no XBRL company facts. Filers that predate XBRL, and most ` +
            `foreign private issuers, report without it.`,
          404,
        );
      }
      throw error;
    }

    const value = extractMetrics(raw, METRIC_DEFS);
    this.metrics.set(cik, { value, expiresAt: Date.now() + COMPANY_TTL_MS });
    EdgarClient.evict(this.metrics);
    return value;
  }
}

let singleton: EdgarClient | null = null;

/**
 * Lazy so importing this module (in tests, or in the metadata-only MCP server)
 * does not force `config` to be evaluated.
 */
export function getEdgarClient(): EdgarClient {
  singleton ??= new EdgarClient();
  return singleton;
}
