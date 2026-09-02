import { describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { users } from "../db/schema.js";
import { MAX_SEARCH_TERMS, escapeLike, listQuerySchema, parseSort, searchTerms } from "./listing.js";

describe("escapeLike", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_done\\x")).toBe("50\\%\\_done\\\\x");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("searchTerms", () => {
  it("splits a query into words a search can match one at a time", () => {
    expect(searchTerms("trending market")).toEqual(["trending", "market"]);
    expect(searchTerms("  fund   scr  ")).toEqual(["fund", "scr"]);
    expect(searchTerms("single")).toEqual(["single"]);
  });

  it("yields nothing for a query with no words in it", () => {
    // The caller uses this to decide whether to rank at all; a query that
    // trims non-empty but tokenises to nothing must not look like a search.
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("-")).toEqual([]);
  });

  it("strips a leading dash, which websearch_to_tsquery reads as negation", () => {
    expect(searchTerms("-market")).toEqual(["market"]);
    expect(searchTerms("trending -market")).toEqual(["trending", "market"]);
  });

  it("caps the term count so a long query cannot build an unbounded statement", () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(searchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
  });
});

describe("listQuerySchema", () => {
  it("applies defaults", () => {
    const parsed = listQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.per_page).toBe(20);
  });

  it("coerces and bounds values", () => {
    expect(listQuerySchema.parse({ page: "3", per_page: "50" })).toMatchObject({ page: 3, per_page: 50 });
    expect(() => listQuerySchema.parse({ page: "0" })).toThrow();
    expect(() => listQuerySchema.parse({ per_page: "1000" })).toThrow();
  });
});

describe("parseSort", () => {
  const columns = { email: users.email, created_at: users.createdAt };
  const fallback = desc(users.createdAt);

  it("uses the fallback for unknown or missing sort", () => {
    expect(parseSort(undefined, columns, fallback)).toBe(fallback);
    expect(parseSort("evil_column.desc", columns, fallback)).toBe(fallback);
    expect(parseSort("nonsense", columns, fallback)).toBe(fallback);
  });

  it("parses whitelisted column.direction", () => {
    expect(parseSort("email.asc", columns, fallback)).not.toBe(fallback);
    expect(parseSort("created_at.desc", columns, fallback)).not.toBe(fallback);
  });
});
