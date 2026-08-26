import { describe, expect, it } from "vitest";
import { createTokenBucket } from "./budget.js";

describe("createTokenBucket", () => {
  it("lets a burst of reading through", () => {
    const limiter = createTokenBucket({ burst: 5, ratePerMinute: 60 });
    for (let i = 0; i < 5; i++) expect(limiter.take("user-1", 0).ok).toBe(true);
  });

  it("refuses past the burst and says how long to wait", () => {
    const limiter = createTokenBucket({ burst: 2, ratePerMinute: 60 });
    limiter.take("user-1", 0);
    limiter.take("user-1", 0);
    const refused = limiter.take("user-1", 0);

    expect(refused.ok).toBe(false);
    // One token a second at 60/min, so the wait is about a second.
    expect(refused.ok === false && refused.retryAfterSeconds).toBe(1);
  });

  it("refills over time", () => {
    const limiter = createTokenBucket({ burst: 2, ratePerMinute: 60 });
    limiter.take("user-1", 0);
    limiter.take("user-1", 0);
    expect(limiter.take("user-1", 0).ok).toBe(false);
    expect(limiter.take("user-1", 1_100).ok).toBe(true);
  });

  it("rations each account separately", () => {
    // The thing being rationed is upstream requests made on someone's behalf,
    // so an office behind one address does not share one allowance.
    const limiter = createTokenBucket({ burst: 1, ratePerMinute: 60 });
    expect(limiter.take("user-1", 0).ok).toBe(true);
    expect(limiter.take("user-1", 0).ok).toBe(false);
    expect(limiter.take("user-2", 0).ok).toBe(true);
  });
});
