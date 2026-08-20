import { describe, expect, it, vi } from "vitest";
import { IsharesClient } from "./client.js";

/**
 * What this fetch layer is for is telling data apart from everything else that
 * arrives with a 200.
 *
 * The parsers below it are pure and forgiving by design: an unreadable payload
 * becomes an empty list, because one malformed fund must not abort a run over
 * thousands. Stacked on a bot-challenge page or a changed response format, that
 * forgiveness turned "we were blocked" into "iShares publishes no funds", which
 * the pipeline then stored as the truth. Recognizing the difference has to
 * happen here, while the response is still in hand.
 */

const HOLDINGS = `iShares Core S&P 500 ETF
Fund Holdings as of,"Aug 15, 2026"

Ticker,Name,Asset Class,Weight (%),Exchange
NVDA,NVIDIA CORP,Equity,7.45,NASDAQ
`;

function client(body: string, init: ResponseInit = {}) {
  const fetchImpl = vi.fn(async () => new Response(body, { status: 200, ...init }));
  return {
    fetchImpl,
    instance: new IsharesClient({
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      minIntervalMs: 0,
    }),
  };
}

const product = { productPageUrl: "/us/products/239726/ivv", ticker: "IVV" };

describe("IsharesClient", () => {
  it("rejects a challenge page instead of reading no funds from it", async () => {
    const { instance } = client(
      '<!DOCTYPE html><html><head><title>Access Denied</title></head><body>…</body></html>',
    );

    await expect(instance.fetchProducts()).rejects.toThrow(/HTML page rather than data/);
  });

  it("says so when the screener yields no products at all", async () => {
    // A 200 with a well-formed body that no longer holds products is a format
    // change, and the empty list it parses to is indistinguishable from a
    // healthy source with an empty lineup — which cannot happen.
    const { instance } = client(JSON.stringify({ tabsData: { columns: [] } }));

    await expect(instance.fetchProducts()).rejects.toThrow(/returned no products/);
  });

  it("reads a screener served with a byte-order mark", async () => {
    const { instance } = client(
      `﻿${JSON.stringify({
        "239726": {
          fundName: "iShares Core S&P 500 ETF",
          localExchangeTicker: "IVV",
          productPageUrl: "/us/products/239726/ishares-core-sp-500-etf",
        },
      })}`,
    );

    const products = await instance.fetchProducts();
    expect(products.map((entry) => entry.ticker)).toEqual(["IVV"]);
  });

  it("surfaces a non-200 with its status", async () => {
    const { instance } = client("nope", { status: 403 });

    await expect(instance.fetchProducts()).rejects.toThrow(/failed \(403\)/);
  });

  it("reads a holdings file, byte-order mark and all", async () => {
    const { instance } = client(`﻿${HOLDINGS}`);

    const result = await instance.fetchHoldings(product, "2026-01-01");

    expect(result.asOf).toBe("2026-08-15");
    expect(result.entries).toHaveLength(1);
  });

  it("rejects a holdings download that carries no positions table", async () => {
    // An error page or a redirect body parses to zero positions, which the
    // ingest would store as "this fund holds nothing" and mark synced.
    const { instance } = client("Sorry, this file is temporarily unavailable.");

    await expect(instance.fetchHoldings(product, "2026-01-01")).rejects.toThrow(
      /no positions table/,
    );
  });
});
