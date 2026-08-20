import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./pg-errors.js";

/**
 * The shape that mattered: drizzle throws its own error and hangs the driver's
 * error off `cause`. Every copy of this check in the codebase read `error.code`
 * only, so no "that name is taken" branch could ever run.
 */
function drizzleWrapped(code: string): Error {
  return new Error("Failed query: insert into …", { cause: Object.assign(new Error("error"), { code }) });
}

describe("isUniqueViolation", () => {
  it("matches a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("matches through drizzle's wrapper — the case that was broken", () => {
    expect(isUniqueViolation(drizzleWrapped("23505"))).toBe(true);
  });

  it("matches however deep the wrapping goes", () => {
    const deep = new Error("outer", { cause: new Error("middle", { cause: drizzleWrapped("23505") }) });
    expect(isUniqueViolation(deep)).toBe(true);
  });

  it("does not match a different SQLSTATE", () => {
    // 23503 is foreign_key_violation — a real failure, but not this one.
    expect(isUniqueViolation(drizzleWrapped("23503"))).toBe(false);
  });

  it("does not match ordinary errors or junk", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("terminates on a cause cycle", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });
});
