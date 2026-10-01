import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache.js";

describe("ttl cache", () => {
  it("answers a second read from memory until the entry expires", async () => {
    let clock = 0;
    const cache = createTtlCache<number>({ now: () => clock });
    const load = vi.fn(async () => 42);

    expect(await cache.get("a", 1_000, load)).toBe(42);
    expect(await cache.get("a", 1_000, load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.has("a")).toBe(true);

    clock = 1_000;
    expect(cache.has("a")).toBe(false);
    await cache.get("a", 1_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent readers onto one load", async () => {
    const cache = createTtlCache<string>();
    let release!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = cache.get("k", 1_000, load);
    const second = cache.get("k", 1_000, load);
    expect(cache.has("k")).toBe(true);
    release("done");

    expect(await first).toBe("done");
    expect(await second).toBe("done");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const cache = createTtlCache<number>();
    await expect(cache.get("x", 1_000, async () => Promise.reject(new Error("down")))).rejects.toThrow(
      "down",
    );
    expect(cache.has("x")).toBe(false);
    expect(await cache.get("x", 1_000, async () => 7)).toBe(7);
  });

  it("evicts the oldest entry past its bound", async () => {
    const cache = createTtlCache<number>({ maxEntries: 2 });
    await cache.get("a", 10_000, async () => 1);
    await cache.get("b", 10_000, async () => 2);
    await cache.get("c", 10_000, async () => 3);
    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });
});
