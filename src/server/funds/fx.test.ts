import { describe, expect, it, vi } from "vitest";
import { createFxConverter } from "./fx.js";
import type { YahooFinanceClient } from "../mcp/client.js";

function fakeYahoo(rates: Record<string, number | Error>) {
  const quote = vi.fn(async (symbol: string) => {
    const currency = String(symbol).replace("USD=X", "");
    const rate = rates[currency];
    if (rate === undefined) return undefined;
    if (rate instanceof Error) throw rate;
    return { regularMarketPrice: rate };
  });
  return { client: { quote } as unknown as YahooFinanceClient, quote };
}

describe("createFxConverter", () => {
  it("converts a native figure into USD", async () => {
    const { client } = fakeYahoo({ JPY: 0.0064, CNY: 0.14 });
    const fx = createFxConverter(client);

    // The comparison the column exists for: without conversion a ¥1.4tn
    // company outranks a $9bn one by a factor of 150 for no reason at all.
    expect(await fx.toUsd(1_400_000_000_000, "JPY")).toBe(8_960_000_000);
    expect(await fx.toUsd(70_000_000_000, "CNY")).toBe(9_800_000_000);
  });

  it("passes USD through without a request", async () => {
    const { client, quote } = fakeYahoo({});
    const fx = createFxConverter(client);

    expect(await fx.toUsd(9_000_000_000, "usd")).toBe(9_000_000_000);
    expect(quote).not.toHaveBeenCalled();
  });

  it("fetches each currency once however many instruments use it", async () => {
    // A run touching thousands of instruments needs about twenty quotes, not
    // thousands — the memo is what keeps enrichment affordable.
    const { client, quote } = fakeYahoo({ HKD: 0.128 });
    const fx = createFxConverter(client);

    await Promise.all([
      fx.toUsd(1_000, "HKD"),
      fx.toUsd(2_000, "HKD"),
      fx.toUsd(3_000, "HKD"),
    ]);
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than a guess when the rate is unavailable", async () => {
    const { client, quote } = fakeYahoo({ XYZ: new Error("no such pair") });
    const fx = createFxConverter(client);

    expect(await fx.toUsd(1_000, "XYZ")).toBeNull();
    // The failure is memoized too: an unquotable currency costs one attempt per
    // run, not one per instrument.
    expect(await fx.toUsd(2_000, "XYZ")).toBeNull();
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("returns null for a missing amount or currency", async () => {
    const { client } = fakeYahoo({ EUR: 1.08 });
    const fx = createFxConverter(client);

    expect(await fx.toUsd(null, "EUR")).toBeNull();
    expect(await fx.toUsd(1_000, null)).toBeNull();
    expect(await fx.toUsd(Number.NaN, "EUR")).toBeNull();
  });
});
