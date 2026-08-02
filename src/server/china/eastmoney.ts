/**
 * Thin fetch layer over Eastmoney / Tiantian Fund.
 *
 * All shape knowledge lives in `parse.ts`; this module only does HTTP, headers,
 * and timeouts. These are undocumented public endpoints — they are polled by the
 * offline ingest job, never from an MCP tool request path, so a format change or
 * an outage degrades data freshness instead of breaking tool calls.
 */

import {
  parseFundCodeList,
  parseFundProfileJs,
  parseHoldings,
  parseNavHistory,
  type FundListEntry,
  type FundProfile,
  type HoldingEntry,
  type NavPoint,
} from "./parse.js";

const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface EastmoneyEndpoints {
  fundCodeList: string;
  pingzhongData: (code: string) => string;
  holdings: (code: string, year?: number) => string;
  navHistory: (code: string, pageIndex: number, pageSize: number) => string;
}

export const defaultEndpoints: EastmoneyEndpoints = {
  fundCodeList: "https://fund.eastmoney.com/js/fundcode_search.js",
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

  async fetchFundProfile(code: string): Promise<FundProfile> {
    const body = await this.get(
      this.endpoints.pingzhongData(code),
      `https://fund.eastmoney.com/${code}.html`,
    );
    return parseFundProfileJs(code, body);
  }

  async fetchHoldings(code: string, year?: number): Promise<HoldingEntry[]> {
    const body = await this.get(
      this.endpoints.holdings(code, year),
      `https://fundf10.eastmoney.com/ccmx_${code}.html`,
    );
    return parseHoldings(body);
  }

  async fetchNavHistory(code: string, pageSize = 60): Promise<NavPoint[]> {
    const body = await this.get(
      this.endpoints.navHistory(code, 1, pageSize),
      `https://fundf10.eastmoney.com/jjjz_${code}.html`,
    );
    return parseNavHistory(body);
  }
}
