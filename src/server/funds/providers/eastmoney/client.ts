/**
 * Thin fetch layer over Eastmoney / Tiantian Fund.
 *
 * All shape knowledge lives in `parse.ts`; this module only does HTTP, headers,
 * and timeouts. These are undocumented public endpoints — they are polled by the
 * offline ingest job, never from an MCP tool request path, so a format change or
 * an outage degrades data freshness instead of breaking tool calls.
 */

import type { HoldingEntry, NavPoint } from "../../provider.js";
import {
  parseFundBasics,
  parseFundCodeList,
  parseFundProfileJs,
  parseHoldingsWithStats,
  parseNavHistory,
  type FundBasics,
  type FundListEntry,
  type FundProfile,
  type HoldingParseResult,
} from "./parse.js";

const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface EastmoneyEndpoints {
  fundCodeList: string;
  basics: (code: string) => string;
  pingzhongData: (code: string) => string;
  holdings: (code: string, year?: number) => string;
  navHistory: (code: string, pageIndex: number, pageSize: number) => string;
}

export const defaultEndpoints: EastmoneyEndpoints = {
  fundCodeList: "https://fund.eastmoney.com/js/fundcode_search.js",
  basics: (code) => `https://fundf10.eastmoney.com/jbgk_${code}.html`,
  pingzhongData: (code) => `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
  holdings: (code, year) =>
    `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=20` +
    (year === undefined ? "" : `&year=${year}`),
  navHistory: (code, pageIndex, pageSize) =>
    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${pageIndex}&pageSize=${pageSize}`,
};

export type Fetcher = typeof globalThis.fetch;

export interface EastmoneyClientOptions {
  fetchImpl?: Fetcher;
  endpoints?: EastmoneyEndpoints;
  /** Minimum gap between requests; these hosts throttle aggressively. */
  minIntervalMs?: number;
}

export class EastmoneyClient {
  private readonly fetchImpl: Fetcher;
  private readonly endpoints: EastmoneyEndpoints;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: EastmoneyClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.endpoints = options.endpoints ?? defaultEndpoints;
    this.minIntervalMs = options.minIntervalMs ?? 300;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async get(url: string, referer: string): Promise<string> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer,
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Eastmoney request failed (${response.status}): ${url}`);
    }
    return response.text();
  }

  /** The full public fund universe — the seed list for every other fetch. */
  async fetchFundList(): Promise<FundListEntry[]> {
    const body = await this.get(this.endpoints.fundCodeList, "https://fund.eastmoney.com/");
    return parseFundCodeList(body);
  }

  /** 基金概况 — the only source of 跟踪标的. */
  async fetchFundBasics(code: string): Promise<FundBasics> {
    const body = await this.get(
      this.endpoints.basics(code),
      `https://fundf10.eastmoney.com/jbgk_${code}.html`,
    );
    return parseFundBasics(code, body);
  }

  async fetchFundProfile(code: string): Promise<FundProfile> {
    const body = await this.get(
      this.endpoints.pingzhongData(code),
      `https://fund.eastmoney.com/${code}.html`,
    );
    return parseFundProfileJs(code, body);
  }

  async fetchHoldings(code: string, year?: number): Promise<HoldingEntry[]> {
    return (await this.fetchHoldingsWithStats(code, year)).entries;
  }

  /** As `fetchHoldings`, but keeps the parser's drop counts so the ingest can
   *  report a format drift instead of silently storing fewer positions. */
  async fetchHoldingsWithStats(code: string, year?: number): Promise<HoldingParseResult> {
    const body = await this.get(
      this.endpoints.holdings(code, year),
      `https://fundf10.eastmoney.com/ccmx_${code}.html`,
    );
    return parseHoldingsWithStats(body);
  }

  async fetchNavHistory(code: string, pageSize = 60): Promise<NavPoint[]> {
    const body = await this.get(
      this.endpoints.navHistory(code, 1, pageSize),
      `https://fundf10.eastmoney.com/jjjz_${code}.html`,
    );
    return parseNavHistory(body);
  }
}

/**
 * One client for the whole process, so every caller shares the same throttle.
 *
 * This matters more than it looks: the 300ms floor is per instance, so a
 * background category sync holding its own client while on-demand fetches held
 * another would quietly double the request rate against a host that throttles
 * aggressively. Everything that fetches from Eastmoney should use this.
 */
let shared: EastmoneyClient | null = null;

export function getEastmoneyClient(): EastmoneyClient {
  shared ??= new EastmoneyClient();
  return shared;
}

