import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../db/schema.js";
import type { db as Database } from "../db/index.js";
import { createBarStore } from "./bars.js";
import type { DailyBar, MarketDataProvider, PriceEvent } from "./provider.js";

/**
 * The bar store, against a real Postgres.
 *
 * Everything here is an upsert, a conflict target or an aggregate — the shapes
 * that typecheck perfectly and fail at runtime, which is the same reason
 * `funds/repo-live.test.ts` exists. In particular the tail re-fetch overwrites
 * rows it has already written, so "does the conflict target actually match the
 * unique index" is not a question a mock can answer.
 *
 * Skipped unless `DATABASE_URL` is set, so the default suite stays offline.
 * Everything runs inside a transaction that is always rolled back.
 */

const connectionString = process.env.DATABASE_URL;

class Rollback extends Error {}

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, adjClose: close, volume: 100 };
}

function provider(
  bars: DailyBar[],
  events: PriceEvent[] = [],
): MarketDataProvider {
  return {
    id: "fake",
    fetchDailyBars: vi.fn(async () => ({
      timezone: "America/New_York",
      currency: "USD",
      bars,
      events,
    })),
    fetchIntraday: vi.fn(async () => ({
      timezone: "America/New_York",
      currency: "USD",
      previousClose: null,
      points: [],
    })),
  };
}

describe.skipIf(connectionString === undefined)("bar store against Postgres", () => {
  it("backfills, re-fetches the tail idempotently, and revises a changed close", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const first = [bar("2026-08-20", 100), bar("2026-08-21", 101), bar("2026-08-24", 102)];
          const store = createBarStore(tx as unknown as typeof Database, provider(first));

          const initial = await store.ensure("TEST.X", "2026-08-01");
          expect(initial.bars).toHaveLength(3);
          expect(initial.timezone).toBe("America/New_York");

          // Asked again inside the freshness window, the tail is not re-fetched
          // and the stored copy answers.
          const tail = provider([bar("2026-08-25", 106)]);
          const cached = createBarStore(tx as unknown as typeof Database, tail);
          const second = await cached.ensure("TEST.X", "2026-08-01");
          expect(second.bars).toHaveLength(3);
          expect(tail.fetchDailyBars).not.toHaveBeenCalled();

          // Once the tail is stale it is re-fetched, with the last bar revised
          // — a live session's final bar changes until the close, so the newer
          // copy has to win rather than be conflicted away.
          await tx
            .update(schema.priceBarMeta)
            .set({ syncedAt: new Date(Date.now() - 60 * 60 * 1_000) })
            .where(eq(schema.priceBarMeta.symbol, "TEST.X"));

          const revised = createBarStore(
            tx as unknown as typeof Database,
            provider([bar("2026-08-21", 101), bar("2026-08-24", 105), bar("2026-08-25", 106)]),
          );
          const third = await revised.ensure("TEST.X", "2026-08-01");

          // Four distinct days, not seven rows: the unique index and the
          // conflict target have to agree for this to hold.
          expect(third.bars).toHaveLength(4);
          expect(third.bars.find((b) => b.date === "2026-08-24")?.close).toBe(105);

          const [meta] = await tx
            .select()
            .from(schema.priceBarMeta)
            .where(eq(schema.priceBarMeta.symbol, "TEST.X"))
            .limit(1);
          expect(meta?.firstBar).toBe("2026-08-20");
          expect(meta?.lastBar).toBe("2026-08-25");

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  });

  it("stores corporate actions once, however often they are re-fetched", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const events = [
            { date: "2026-08-21", kind: "split" as const, factor: 4, amount: null },
            { date: "2026-08-22", kind: "dividend" as const, factor: null, amount: 0.4 },
          ];
          const bars = [bar("2026-08-20", 100), bar("2026-08-21", 25), bar("2026-08-22", 26)];

          const store = createBarStore(tx as unknown as typeof Database, provider(bars, events));
          await store.ensure("TEST.Y", "2026-08-01");
          const again = createBarStore(tx as unknown as typeof Database, provider(bars, events));
          const result = await again.ensure("TEST.Y", "2026-08-01");

          expect(result.events).toHaveLength(2);
          expect(result.events.find((e) => e.kind === "split")?.factor).toBe(4);

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  });

  it("reads many symbols at once without going near the provider", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const source = provider([bar("2026-08-20", 100), bar("2026-08-21", 101)]);
          const store = createBarStore(tx as unknown as typeof Database, source);
          await store.ensure("TEST.A", "2026-08-01");
          await store.ensure("TEST.B", "2026-08-01");

          const readOnly = createBarStore(
            tx as unknown as typeof Database,
            provider([]),
          );
          const many = await readOnly.readMany(["TEST.A", "TEST.B", "TEST.MISSING"], "2026-08-01");

          expect(many.get("TEST.A")).toHaveLength(2);
          expect(many.get("TEST.B")).toHaveLength(2);
          // A symbol nobody has opened is absent rather than fetched: scrolling
          // a list must not turn into a request per row.
          expect(many.has("TEST.MISSING")).toBe(false);

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  });
});
