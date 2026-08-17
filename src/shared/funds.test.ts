import { describe, expect, it } from "vitest";
import { previewQuerySchema, syncBodySchema } from "./funds.js";

describe("previewQuerySchema", () => {
  it("reads ?force=false as false", () => {
    // Regression: `z.coerce.boolean()` is `Boolean(value)`, and
    // `Boolean("false")` is `true`. The dashboard sends the flag on every
    // preview request, so the confirmation dialog quoted full-refetch numbers
    // for a run that would have skipped the fresh funds.
    const parsed = previewQuerySchema.parse({ scope: "qdii", force: "false" });
    expect(parsed.force).toBe(false);
  });

  it("reads ?force=true as true", () => {
    expect(previewQuerySchema.parse({ scope: "qdii", force: "true" }).force).toBe(true);
  });

  it("defaults force to false when the param is absent", () => {
    expect(previewQuerySchema.parse({ scope: "qdii" }).force).toBe(false);
  });

  it("rejects a non-boolean force rather than guessing", () => {
    expect(previewQuerySchema.safeParse({ scope: "qdii", force: "yes" }).success).toBe(false);
  });

  it("rejects a scope outside the selectable set", () => {
    // `codes` is CLI-only; accepting it here would start a run with no codes,
    // which walks the whole universe.
    expect(previewQuerySchema.safeParse({ scope: "codes" }).success).toBe(false);
    expect(previewQuerySchema.safeParse({ scope: "bonds" }).success).toBe(false);
  });
});

describe("syncBodySchema", () => {
  it("accepts a scope with an optional limit", () => {
    expect(syncBodySchema.parse({ scope: "all", limit: 50 })).toEqual({
      scope: "all",
      limit: 50,
      force: false,
    });
  });

  it("rejects a limit of zero or a negative limit", () => {
    expect(syncBodySchema.safeParse({ scope: "qdii", limit: 0 }).success).toBe(false);
    expect(syncBodySchema.safeParse({ scope: "qdii", limit: -5 }).success).toBe(false);
  });
});
