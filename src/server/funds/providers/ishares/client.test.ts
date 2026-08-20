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

/** A `holdings.all` payload, columnar the way the live one is. */
const HOLDINGS = JSON.stringify({
  fundName: "iShares Core S&P 500 ETF",
  componentsByNameMap: {
    holdings: {
      containersByNameMap: {
        all: {
          dataPointsByNameMap: {
            issueName: { value: ["NVIDIA CORP"] },
            ticker: { value: ["NVDA"] },
            assetClass: { value: ["Equity"] },
            exchange: { value: ["NASDAQ"] },
            isin: { value: ["US67066G1040"] },
            holdingPercent: { value: [7.45] },
            asOfDate: { value: 20260815 },
          },
        },
      },
    },
  },
});

function client(body: string, init: ResponseInit = {}) {
  const fetchImpl = vi.fn(async (_url: string) => new Response(body, { status: 200, ...init }));
  return {
    fetchImpl,
    instance: new IsharesClient({
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      minIntervalMs: 0,
    }),
  };
}

const product = { productId: "239726", ticker: "IVV" };

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

  it("reads a holdings payload, byte-order mark and all", async () => {
    const { instance, fetchImpl } = client(`﻿${HOLDINGS}`);

    const result = await instance.fetchHoldings(product, "2026-01-01");

    expect(result.asOf).toBe("2026-08-15");
    expect(result.entries).toHaveLength(1);
    // Keyed by portfolio id, not by the product page's URL — the retired CSV
    // download was addressed by page path and broke when a page was renamed.
    const url = fetchImpl.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("get-product-data");
    expect(url).toContain("portfolioId=239726");
    expect(url).toContain("component=holdings.all");
  });

  it("rejects the retired CSV endpoint's HTML, which arrives labelled text/csv", async () => {
    // The exact failure that made this provider cache nothing: a 200 whose body
    // is the product page. A CSV parser reads no rows from it and reports an
    // empty portfolio, which the ingest then stores and marks synced.
    const { instance } = client("<!DOCTYPE html><html><body>Product page</body></html>");

    await expect(instance.fetchHoldings(product, "2026-01-01")).rejects.toThrow(
      /HTML page rather than data/,
    );
  });

  it("rejects a body that is not the holdings component", async () => {
    const { instance } = client(JSON.stringify({ componentsByNameMap: {} }));

    await expect(instance.fetchHoldings(product, "2026-01-01")).rejects.toThrow(
      /no holdings component/,
    );
  });

  it("rejects a non-JSON body that is not HTML either", async () => {
    const { instance } = client("Sorry, temporarily unavailable.");

    await expect(instance.fetchHoldings(product, "2026-01-01")).rejects.toThrow(/was not JSON/);
  });
});
