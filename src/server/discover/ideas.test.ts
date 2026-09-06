import { describe, expect, it } from "vitest";
import { MOVER_SCREENS, ideaKey } from "../../shared/discover.js";
import { SCREENER_IDS } from "../mcp/tools/screener.js";
import {
  ideaFromFund,
  ideaFromQuote,
  mergeIdeas,
  pickRandom,
  priceIdeas,
  rankSearchIdeas,
  trackedIndex,
  type TrackedRow,
} from "./ideas.js";

const NONE = new Map<string, { listId: string; listName: string }[]>();

describe("ideaFromQuote", () => {
  it("reads the search spelling of the fields", () => {
    const idea = ideaFromQuote(
      {
        symbol: "NVDA",
        shortname: "NVIDIA Corporation",
        exchDisp: "NasdaqGS",
        quoteType: "EQUITY",
      },
      "search",
      NONE,
    );
    expect(idea).toMatchObject({
      kind: "symbol",
      ref: "NVDA",
      name: "NVIDIA Corporation",
      exchange: "NasdaqGS",
      quoteType: "EQUITY",
      source: "search",
      price: null,
    });
  });

  it("reads the screener spelling of the same fields", () => {
    const idea = ideaFromQuote(
      {
        symbol: "0700.HK",
        longName: "Tencent Holdings Limited",
        fullExchangeName: "HKSE",
        currency: "HKD",
        regularMarketPrice: 412.5,
        regularMarketChangePercent: -1.25,
      },
      "screener",
      NONE,
    );
    expect(idea).toMatchObject({
      ref: "0700.HK",
      name: "Tencent Holdings Limited",
      exchange: "HKSE",
      currency: "HKD",
      price: 412.5,
      changePercent: -1.25,
    });
  });

  it("drops entries with no symbol, which search mixes in", () => {
    expect(ideaFromQuote({ shortname: "Some news headline" }, "search", NONE)).toBeNull();
  });

  it("keeps a missing price null rather than zero", () => {
    const idea = ideaFromQuote({ symbol: "AAPL", regularMarketPrice: undefined }, "search", NONE);
    expect(idea?.price).toBeNull();
  });

  it("marks a ref the reader already tracks", () => {
    const tracked = trackedIndex([
      { kind: "symbol", ref: "NVDA", watchlistId: "l1", watchlistName: "Major AI Companies" },
      { kind: "symbol", ref: "NVDA", watchlistId: "l2", watchlistName: "Chips" },
      { kind: "fund", ref: "161125", watchlistId: "l1", watchlistName: "Major AI Companies" },
    ] satisfies TrackedRow[]);

    expect(ideaFromQuote({ symbol: "NVDA" }, "search", tracked)?.tracked).toEqual([
      { listId: "l1", listName: "Major AI Companies" },
      { listId: "l2", listName: "Chips" },
    ]);
    // Same string, different kind: a fund code is not the symbol.
    expect(ideaFromQuote({ symbol: "161125" }, "search", tracked)?.tracked).toEqual([]);
  });
});

describe("ideaFromFund", () => {
  it("reports the domicile as the exchange and leaves the price unset", () => {
    const idea = ideaFromFund(
      { code: "161125", name: "易方达标普信息科技", market: "CN", currency: "CNY", fundType: "QDII" },
      "search",
      NONE,
    );
    expect(idea).toMatchObject({
      kind: "fund",
      ref: "161125",
      exchange: "CN",
      quoteType: "QDII",
      price: null,
      tracked: [],
    });
  });
});

describe("mergeIdeas", () => {
  const symbol = (ref: string) => ideaFromQuote({ symbol: ref }, "search", NONE)!;
  const fund = (code: string) =>
    ideaFromFund({ code, name: null, market: "US", currency: "USD", fundType: null }, "search", NONE);

  it("lets the earlier group win a ref that appears in both", () => {
    // IVV is genuinely both a cached fund and a quoted symbol; the live quote
    // is the one to offer, so symbols are passed first.
    const merged = mergeIdeas([[symbol("IVV")], [fund("IVV")]], 10);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("symbol");
  });

  it("keeps a fund and a listing that merely look alike", () => {
    const merged = mergeIdeas([[symbol("600519.SS")], [fund("600519")]], 10);
    expect(merged.map((idea) => ideaKey(idea.kind, idea.ref))).toEqual([
      "symbol:600519.SS",
      "fund:600519",
    ]);
  });

  it("stops at the limit", () => {
    const merged = mergeIdeas([[symbol("A"), symbol("B")], [symbol("C")]], 2);
    expect(merged.map((idea) => idea.ref)).toEqual(["A", "B"]);
  });
});

describe("rankSearchIdeas", () => {
  const idea = (ref: string, name: string | null) => ({
    ...ideaFromQuote({ symbol: ref }, "search", NONE)!,
    name,
  });

  it("puts an exact match first, then a prefix, then the rest", () => {
    const ranked = rankSearchIdeas(
      [idea("NVDX", "NVDA 2x ETF"), idea("XNVDA", "Something else"), idea("NVDA", "NVIDIA")],
      "nvda",
    );
    expect(ranked.map((entry) => entry.ref)).toEqual(["NVDA", "NVDX", "XNVDA"]);
  });

  it("ranks on the name too, which is the whole point for a fund company", () => {
    const ranked = rankSearchIdeas(
      [idea("110022", "汇添富价值精选"), idea("161125", "易方达标普信息科技")],
      "易方达",
    );
    expect(ranked[0]?.ref).toBe("161125");
  });

  it("keeps the upstream order within a tier", () => {
    const ranked = rankSearchIdeas([idea("AA", "x"), idea("BB", "y")], "zzz");
    expect(ranked.map((entry) => entry.ref)).toEqual(["AA", "BB"]);
  });
});

describe("priceIdeas", () => {
  it("fills a price in without inventing one", () => {
    const ideas = [
      ideaFromQuote({ symbol: "NVDA" }, "trending", NONE)!,
      ideaFromQuote({ symbol: "AMD" }, "trending", NONE)!,
    ];
    const priced = priceIdeas(
      ideas,
      new Map([["symbol:NVDA", { price: 180, changePercent: 2.5, currency: "USD" }]]),
    );
    expect(priced[0]).toMatchObject({ price: 180, changePercent: 2.5, currency: "USD" });
    expect(priced[1]).toMatchObject({ price: null, changePercent: null });
  });

  it("leaves a row alone when its quote came back empty", () => {
    const ideas = [ideaFromQuote({ symbol: "NVDA", regularMarketPrice: 180 }, "screener", NONE)!];
    const priced = priceIdeas(
      ideas,
      new Map([["symbol:NVDA", { price: null, changePercent: null, currency: null }]]),
    );
    expect(priced[0]?.price).toBe(180);
  });
});

describe("pickRandom", () => {
  it("can reach the last element", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.999999)).toBe("c");
  });

  it("picks the first at zero and never runs off the end at one", () => {
    expect(pickRandom(["a", "b", "c"], () => 0)).toBe("a");
    expect(pickRandom(["a", "b", "c"], () => 1)).toBe("c");
  });

  it("returns null for an empty pool", () => {
    expect(pickRandom([], () => 0.5)).toBeNull();
  });
});

describe("mover screens", () => {
  it("only offers screens the screener tool accepts", () => {
    for (const screen of MOVER_SCREENS) {
      expect(SCREENER_IDS).toContain(screen.id);
    }
  });
});
