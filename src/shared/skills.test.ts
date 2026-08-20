import { describe, expect, it } from "vitest";
import { isValidSlug, MAX_SLUG_LENGTH, normalizeSlug, suggestSlug } from "./skills.js";

describe("normalizeSlug", () => {
  it("lowercases and hyphenates a display name", () => {
    expect(normalizeSlug("Fund Screening Workflow")).toBe("fund-screening-workflow");
  });

  it("collapses runs of punctuation into single hyphens", () => {
    expect(normalizeSlug("fund — screen / v2")).toBe("fund-screen-v2");
  });

  it("trims leading and trailing hyphens", () => {
    expect(normalizeSlug("  --fund-screen--  ")).toBe("fund-screen");
  });

  it("keeps digits, which carry meaning in a version suffix", () => {
    expect(normalizeSlug("13F Review")).toBe("13f-review");
  });

  /**
   * Non-ASCII is dropped rather than transliterated. A silent mangling of a
   * Chinese title into hyphens would be worse than an empty slug: the caller
   * can ask for a name, but it cannot notice a name it never saw.
   */
  it("yields nothing usable for an all-CJK name", () => {
    expect(normalizeSlug("基金筛选")).toBe("");
    expect(isValidSlug(normalizeSlug("基金筛选"))).toBe(false);
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = normalizeSlug("a".repeat(MAX_SLUG_LENGTH) + " tail");
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  it("is idempotent, so re-saving never drifts the name agents call", () => {
    const once = normalizeSlug("Fund — Screen");
    expect(normalizeSlug(once)).toBe(once);
  });
});

describe("isValidSlug", () => {
  it("accepts the Agent Skills name shape", () => {
    expect(isValidSlug("fund-screen")).toBe(true);
    expect(isValidSlug("f")).toBe(true);
    expect(isValidSlug("13f-review")).toBe(true);
  });

  it("rejects anything a user could not type back verbatim", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Fund-Screen")).toBe(false);
    expect(isValidSlug("fund_screen")).toBe(false);
    expect(isValidSlug("fund--screen")).toBe(false);
    expect(isValidSlug("-fund")).toBe(false);
    expect(isValidSlug("fund-")).toBe(false);
    expect(isValidSlug("a".repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("proposes the slug the editor prefills", () => {
    expect(suggestSlug("Quarterly Earnings Review")).toBe("quarterly-earnings-review");
  });
});
