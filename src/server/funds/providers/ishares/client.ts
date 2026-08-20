/**
 * Thin fetch layer over iShares' public product screener and holdings files.
 *
 * All shape knowledge lives in `parse.ts`; this module only does HTTP, headers
 * and timeouts. As with Eastmoney these are undocumented public endpoints, so
 * they are polled by the ingest job rather than from a tool request path: a
 * format change or an outage degrades data freshness instead of breaking tool
 * calls.
 */

import {
  parseHoldingsCsv,
  parseProductScreener,
  type IsharesHoldingsResult,
  type IsharesProduct,
} from "./parse.js";

const REQUEST_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ORIGIN = "https://www.ishares.com";

export interface IsharesEndpoints {
  productScreener: string;
  holdings: (productPageUrl: string, ticker: string) => string;
}

export const defaultEndpoints: IsharesEndpoints = {
  productScreener:
    `${ORIGIN}/us/product-screener/product-screener-v3.1.jsn` +
    "?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config" +
    "&siteEntryPassthrough=true",
  // The numeric segment is iShares' fixed component id for the holdings
  // download, not a per-product value.
  holdings: (productPageUrl, ticker) =>
    `${ORIGIN}${productPageUrl}/1467271812596.ajax` +
    `?fileType=csv&fileName=${encodeURIComponent(ticker)}_holdings&dataType=fund`,
};

export type Fetcher = typeof globalThis.fetch;

/** Strips the UTF-8 byte-order mark these files are served with. */
function stripBom(body: string): string {
  return body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head");
}

/** Enough of a body to recognize it in an error, and no more. */
function describeBody(body: string): string {
  const preview = body.slice(0, 120).replace(/\s+/g, " ").trim();
  return `${body.length} bytes, starts "${preview}"`;
}

export interface IsharesClientOptions {
  fetchImpl?: Fetcher;
  endpoints?: IsharesEndpoints;
  minIntervalMs?: number;
}

export class IsharesClient {
  private readonly fetchImpl: Fetcher;
  private readonly endpoints: IsharesEndpoints;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: IsharesClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.endpoints = options.endpoints ?? defaultEndpoints;
    this.minIntervalMs = options.minIntervalMs ?? 500;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async get(url: string, accept: string): Promise<string> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: `${ORIGIN}/us/products/etf-investments`,
        Accept: accept,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`iShares request failed (${response.status}): ${url}`);
    }
    // The BOM is why this is not just `response.text()`: these files are served
    // UTF-8 with one, and it rides along on the first cell — enough to make
    // `JSON.parse` throw and to hide a header column behind a character that
    // does not print.
    const body = stripBom(await response.text());
    if (looksLikeHtml(body)) {
      // A challenge page is served with a 200 and an HTML body, so the only
      // thing separating it from data is what came back. Left to the parsers it
      // was indistinguishable from a source with nothing in it: they read no
      // products and no positions, and the pipeline stored that as the answer.
      throw new Error(
        `iShares returned an HTML page rather than data (${describeBody(body)}) — the request was ` +
          `most likely blocked by bot protection: ${url}`,
      );
    }
    return body;
  }

  /** The whole US lineup — one request, and the seed for everything else. */
  async fetchProducts(): Promise<IsharesProduct[]> {
    const body = await this.get(this.endpoints.productScreener, "application/json, text/plain, */*");
    const products = parseProductScreener(body);
    if (products.length === 0) {
      // `parseProductScreener` answers an unreadable payload with an empty list
      // by design — it is a pure function and has no business throwing on one
      // fund. But *no* products is never a true statement about iShares, so the
      // one caller that can tell the difference raises it here, where the
      // response is still around to describe.
      throw new Error(
        `iShares product screener returned no products (${describeBody(body)}) — its response ` +
          `format has changed, or the request was rejected.`,
      );
    }
    return products;
  }

  /**
   * The fund's complete published portfolio.
   *
   * `fallbackDate` is used only when the file's preamble carries no "as of"
   * line; it is the caller's today, so a report date is never invented from a
   * different day than the fetch.
   */
  async fetchHoldings(
    product: Pick<IsharesProduct, "productPageUrl" | "ticker">,
    fallbackDate: string,
  ): Promise<IsharesHoldingsResult> {
    if (product.productPageUrl === null) {
      throw new Error(`no product page known for ${product.ticker}`);
    }
    const body = await this.get(
      this.endpoints.holdings(product.productPageUrl, product.ticker),
      "text/csv, */*",
    );
    const result = parseHoldingsCsv(body, fallbackDate);
    if (result.headerFound) return result;
    // No header row means the download was not a holdings file at all — an
    // error page, a redirect, an empty body. Distinguished from a file whose
    // rows were all skipped, which is a real (if odd) answer and is left to the
    // drop counters.
    throw new Error(
      `iShares holdings file for ${product.ticker} carried no positions table (${describeBody(body)}).`,
    );
  }
}

/**
 * One client for the whole process, so every caller shares the same throttle —
 * for the same reason the Eastmoney client is shared: a background sync and an
 * on-demand fetch each holding their own would quietly double the request rate.
 */
let shared: IsharesClient | null = null;

export function getIsharesClient(): IsharesClient {
  shared ??= new IsharesClient();
  return shared;
}
