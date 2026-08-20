import { describe, expect, it } from "vitest";
import {
  appendToBody,
  buildSnippet,
  normalizeSymbol,
  normalizeSymbolList,
  normalizeTag,
  normalizeTagList,
  parseSymbolInput,
  parseTagInput,
  searchTerms,
} from "./notes.js";

describe("normalizeTag", () => {
  it("collapses the ways one tag gets typed into a single facet", () => {
    expect(normalizeTag("Rate Cut")).toBe("rate-cut");
    expect(normalizeTag("#rate-cut")).toBe("rate-cut");
    expect(normalizeTag("  RATE   CUT ")).toBe("rate-cut");
  });

  it("keeps non-Latin tags intact", () => {
    expect(normalizeTag("估值")).toBe("估值");
    expect(normalizeTag("宏观 政策")).toBe("宏观-政策");
  });

  it("drops punctuation that would fork the vocabulary", () => {
    expect(normalizeTag("ai!")).toBe("ai");
    expect(normalizeTag("(macro)")).toBe("macro");
    expect(normalizeTag("--")).toBe("");
  });
});

describe("parseTagInput", () => {
  it("splits on commas, full-width commas, newlines and spaces, and de-duplicates", () => {
    expect(parseTagInput("macro, rate cut\nAI，估值 macro")).toEqual([
      "macro",
      "rate",
      "cut",
      "ai",
      "估值",
    ]);
  });
});

describe("normalizeSymbol", () => {
  it("reads a bare six-digit code as a fund and everything else as a symbol", () => {
    expect(normalizeSymbol("000834")).toEqual({ kind: "fund", ref: "000834" });
    expect(normalizeSymbol("nvda")).toEqual({ kind: "symbol", ref: "NVDA" });
    expect(normalizeSymbol("600519.ss")).toEqual({ kind: "symbol", ref: "600519.SS" });
  });

  it("honours an explicit kind", () => {
    expect(normalizeSymbol("ivv", "fund")).toEqual({ kind: "fund", ref: "ivv" });
  });
});

describe("parseSymbolInput", () => {
  it("splits a free-text field and de-duplicates case-insensitively", () => {
    expect(parseSymbolInput("NVDA, nvda 0700.HK\n000834")).toEqual([
      { kind: "symbol", ref: "NVDA" },
      { kind: "symbol", ref: "0700.HK" },
      { kind: "fund", ref: "000834" },
    ]);
  });
});

describe("normalizeSymbolList", () => {
  it("accepts bare strings and objects in the same array", () => {
    expect(normalizeSymbolList(["nvda", { ref: "ivv", kind: "fund" }])).toEqual([
      { kind: "symbol", ref: "NVDA" },
      { kind: "fund", ref: "ivv" },
    ]);
  });

  it("passes undefined through, so a patch can leave the set alone", () => {
    expect(normalizeSymbolList(undefined)).toBeUndefined();
    expect(normalizeTagList(undefined)).toBeUndefined();
    expect(normalizeTagList([])).toEqual([]);
  });
});

describe("searchTerms", () => {
  it("keeps quoted phrases whole", () => {
    expect(searchTerms('"rate cut" powell')).toEqual(["rate cut", "powell"]);
  });
});

describe("buildSnippet", () => {
  const body = `${"a".repeat(300)} Blackwell ramp decides it ${"b".repeat(300)}`;

  it("windows the body around the first matching term", () => {
    const snippet = buildSnippet(body, "Blackwell", 20);
    expect(snippet.text).toContain("Blackwell ramp");
    expect(snippet.text.length).toBeLessThan(80);
    expect(snippet.truncatedStart).toBe(true);
    expect(snippet.truncatedEnd).toBe(true);
  });

  it("falls back to the opening when the hit was in the title or a tag", () => {
    const snippet = buildSnippet("Short body with no hit.", "elsewhere", 20);
    expect(snippet.text).toBe("Short body with no hit.");
    expect(snippet.truncatedStart).toBe(false);
    expect(snippet.truncatedEnd).toBe(false);
  });

  it("matches Chinese mid-sentence, where a text-search parser would not", () => {
    const snippet = buildSnippet("市场对降息的预期明显升温，尤其是六月会议。", "降息", 6);
    expect(snippet.text).toContain("降息");
  });

  it("flattens whitespace so a snippet stays one line", () => {
    expect(buildSnippet("one\n\n  two   three", "two", 40).text).toBe("one two three");
  });
});

describe("appendToBody", () => {
  it("separates additions with a blank line", () => {
    expect(appendToBody("First.", "Second.")).toBe("First.\n\nSecond.");
  });

  it("starts cleanly from an empty body", () => {
    expect(appendToBody("", "First.")).toBe("First.");
    expect(appendToBody("   \n", "First.")).toBe("First.");
  });
});
