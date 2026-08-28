import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { db as Database } from "../db/index.js";
import { createWatchlistRepo } from "./repo.js";

/**
 * Guards the SQL the ordering code emits, not its results.
 *
 * The reorder writes one hand-written `update … from (values …)` statement,
 * which is the one place in this repo where drizzle is not composing the
 * statement for us — a mistake there typechecks perfectly and fails at parse
 * time on the first drag. The same recording-client trick as
 * `funds/repo-sql.test.ts`; anything needing real semantics belongs in a test
 * with a database behind it.
 */
function recordingDb(responses: unknown[][][] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  let index = 0;
  const client = {
    // Rows come back as arrays because drizzle asks node-postgres for
    // `rowMode: "array"` and maps the columns itself; a canned row is
    // therefore the selected columns in order.
    query: vi.fn(async (config: { text: string }, values: unknown[] = []) => {
      calls.push({ text: config.text, values });
      const rows = responses[index++] ?? [];
      return { rows, rowCount: rows.length };
    }),
  };
  return { db: drizzle(client as never) as unknown as typeof Database, calls };
}

describe("stored order", () => {
  it("reads items in the user's own order, with recency as the tiebreak", async () => {
    const { db, calls } = recordingDb([[["list-1"]]]);
    await createWatchlistRepo(db).listItems("user-1", "list-1");

    // [0] is the ownership check, [1] the count, [2] the rows themselves.
    expect(calls[2]!.text).toContain(
      'order by "watchlist_items"."position" asc, "watchlist_items"."created_at" desc',
    );
  });

  it("still offers the add-date order the MCP tools used before positions existed", async () => {
    const { db, calls } = recordingDb([[["list-1"]]]);
    await createWatchlistRepo(db).listItems("user-1", "list-1", { sort: "added" });
    expect(calls[2]!.text).toContain('order by "watchlist_items"."created_at" desc');
    expect(calls[2]!.text).not.toContain('order by "watchlist_items"."position"');
  });

  it("renumbers a whole list in one statement rather than one per row", async () => {
    const { db, calls } = recordingDb([
      // Ownership check, then the current order as (id, position) rows.
      [["list-1"]],
      [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
    ]);

    const moved = await createWatchlistRepo(db).reorderItems("user-1", "list-1", ["c", "a", "b"]);
    expect(moved).toBe(true);

    const update = calls[2]!;
    expect(update.text).toContain('update "watchlist_items" set "position" = ordered."position"');
    expect(update.text).toContain('as ordered("id", "position")');
    expect(update.text).toContain('"watchlist_items"."id" = ordered."id"');
    // Scoped to the list, so a stale id from another list cannot be renumbered.
    expect(update.text).toContain('"watchlist_items"."watchlist_id" = $');
    // Every id is a bound parameter, in the order asked for, numbered densely.
    expect(update.values).toEqual(["c", 0, "a", 1, "b", 2, "list-1"]);
    // The list's own timestamp moves too, so "recently used" stays honest.
    expect(calls[3]!.text).toContain('update "watchlists" set');
  });

  it("keeps ids the client could not see, placing them behind the ones it named", async () => {
    const { db, calls } = recordingDb([
      [["list-1"]],
      [
        ["a", 0],
        ["hidden", 1],
        ["c", 2],
      ],
    ]);

    await createWatchlistRepo(db).reorderItems("user-1", "list-1", ["c", "a"]);
    expect(calls[2]!.values).toEqual(["c", 0, "a", 1, "hidden", 2, "list-1"]);
  });

  it("writes nothing when the order it is asked for is the order already stored", async () => {
    const { db, calls } = recordingDb([
      [["list-1"]],
      [
        ["a", 0],
        ["b", 1],
      ],
    ]);

    const moved = await createWatchlistRepo(db).reorderItems("user-1", "list-1", ["a", "b"]);
    expect(moved).toBe(false);
    // Ownership check and the read; no update, and therefore no change event.
    expect(calls).toHaveLength(2);
  });

  it("normalizes positions the backfill left tied, even for an unchanged order", async () => {
    const { db, calls } = recordingDb([
      [["list-1"]],
      [
        ["a", 0],
        ["b", 0],
      ],
    ]);

    expect(await createWatchlistRepo(db).reorderItems("user-1", "list-1", ["a", "b"])).toBe(true);
    expect(calls[2]!.values).toEqual(["a", 0, "b", 1, "list-1"]);
  });

  it("orders the sidebar by position and renumbers it against the owning user", async () => {
    const { db, calls } = recordingDb([
      [
        ["one", 0],
        ["two", 1],
      ],
    ]);

    expect(await createWatchlistRepo(db).reorderWatchlists("user-1", ["two", "one"])).toBe(true);
    expect(calls[0]!.text).toContain(
      'order by "watchlists"."position" asc, "watchlists"."updated_at" desc',
    );
    expect(calls[1]!.text).toContain('update "watchlists" set "position" = ordered."position"');
    expect(calls[1]!.values).toEqual(["two", 0, "one", 1, "user-1"]);
  });
});
