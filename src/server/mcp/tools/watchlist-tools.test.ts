import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { McpAuth } from "../../lib/http.js";
import type { WatchlistLevel } from "../../db/schema.js";
import type {
  AddItemRow,
  AddLevelRow,
  FundSnapshot,
  ItemQuery,
  UpdateLevelPatch,
  WatchlistItemRow,
  WatchlistRepo,
  WatchlistSummary,
} from "../../watchlist/repo.js";
import type { YahooFinanceClient } from "../client.js";
import { buildMcpServer } from "../server.js";

const auth = {
  user: {
    id: "user-1",
    email: "investor@example.com",
    googleSub: null,
    name: "Investor",
    displayName: "Test Investor",
    avatarUrl: null,
    role: "user",
    status: "active",
    preferences: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
  },
  method: "pat",
  sourceId: "token-1",
  label: "Test token",
} satisfies McpAuth;

/**
 * In-memory stand-in for the Drizzle repo. It enforces the same two rules the
 * database does — ownership and (list, kind, ref) uniqueness — because those
 * are what the tools are relied on to respect.
 */
function memoryRepo(seed: { lists?: WatchlistSummary[]; items?: WatchlistItemRow[] } = {}) {
  const lists = new Map<string, WatchlistSummary>();
  const items: WatchlistItemRow[] = [...(seed.items ?? [])];
  for (const list of seed.lists ?? []) lists.set(list.id, list);
  let counter = 0;

  const ownedList = (userId: string, id: string): WatchlistSummary | null => {
    const list = lists.get(id);
    return list !== undefined && list.userId === userId ? list : null;
  };

  const withCounts = (list: WatchlistSummary): WatchlistSummary => ({
    ...list,
    itemCount: items.filter((item) => item.watchlistId === list.id).length,
  });

  const makeLevel = (itemId: string, row: AddLevelRow): WatchlistLevel => ({
    id: `level-${++counter}`,
    itemId,
    kind: row.kind,
    price: row.price,
    priceHigh: row.priceHigh ?? null,
    label: row.label ?? null,
    note: row.note ?? null,
    source: row.source ?? "user",
    status: "active",
    hitAt: null,
    validUntil: row.validUntil ?? null,
    createdAt: new Date("2026-08-02T00:00:00Z"),
    updatedAt: new Date("2026-08-02T00:00:00Z"),
  });

  /** Levels are reached through their item, exactly as the database reaches them. */
  const findLevel = (watchlistId: string, levelId: string) => {
    for (const item of items) {
      if (item.watchlistId !== watchlistId) continue;
      const level = item.levels.find((candidate) => candidate.id === levelId);
      if (level !== undefined) return { item, level };
    }
    return null;
  };

  const repo: WatchlistRepo = {
    listWatchlists: vi.fn(async (userId: string) =>
      [...lists.values()].filter((list) => list.userId === userId).map(withCounts),
    ),
    getWatchlist: vi.fn(async (userId: string, id: string) => {
      const list = ownedList(userId, id);
      return list === null ? null : withCounts(list);
    }),
    findWatchlistByName: vi.fn(async (userId: string, name: string) => {
      const list = [...lists.values()].find(
        (candidate) => candidate.userId === userId && candidate.name.toLowerCase() === name.toLowerCase(),
      );
      return list === undefined ? null : withCounts(list);
    }),
    createWatchlist: vi.fn(async (userId: string, input: { name: string }) => {
      const list: WatchlistSummary = {
        id: `list-${++counter}`,
        userId,
        name: input.name,
        description: null,
        itemCount: 0,
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      };
      lists.set(list.id, list);
      return list;
    }),
    updateWatchlist: vi.fn(async () => null),
    deleteWatchlist: vi.fn(async () => false),
    listItems: vi.fn(async (userId: string, watchlistId: string, query: ItemQuery = {}) => {
      if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
      const rows = items.filter(
        (item) =>
          item.watchlistId === watchlistId && (query.kind === undefined || item.kind === query.kind),
      );
      return { items: rows, total: rows.length };
    }),
    addItems: vi.fn(async (userId: string, watchlistId: string, rows: AddItemRow[]) => {
      if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
      const added: WatchlistItemRow[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        const clash = items.some(
          (item) => item.watchlistId === watchlistId && item.kind === row.kind && item.ref === row.ref,
        );
        if (clash) {
          skipped.push(row.ref);
          continue;
        }
        const item: WatchlistItemRow = {
          id: `item-${++counter}`,
          watchlistId,
          kind: row.kind,
          ref: row.ref,
          name: row.name ?? null,
          note: row.note ?? null,
          entryPrice: row.entryPrice ?? null,
          entryAt: row.entryAt ?? (typeof row.entryPrice === "number" ? new Date() : null),
          levels: [],
          createdAt: new Date("2026-08-02T00:00:00Z"),
        };
        items.push(item);
        for (const level of row.levels ?? []) item.levels.push(makeLevel(item.id, level));
        added.push(item);
      }
      return { added, skipped };
    }),
    updateItem: vi.fn(async () => null),
    removeItems: vi.fn(async (userId: string, watchlistId: string, selector: { refs?: string[] }) => {
      if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
      const refs = new Set(selector.refs ?? []);
      const removed = items.filter((item) => item.watchlistId === watchlistId && refs.has(item.ref));
      for (const item of removed) items.splice(items.indexOf(item), 1);
      return removed;
    }),
    addLevels: vi.fn(async (userId: string, watchlistId: string, itemId: string, rows: AddLevelRow[]) => {
      if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
      const item = items.find(
        (candidate) => candidate.id === itemId && candidate.watchlistId === watchlistId,
      );
      if (item === undefined) throw new Error("Watchlist item not found.");
      const added: WatchlistLevel[] = [];
      let skipped = 0;
      for (const row of rows) {
        const clash = item.levels.some(
          (level) => level.kind === row.kind && level.price === row.price,
        );
        if (clash) {
          skipped += 1;
          continue;
        }
        const level = makeLevel(item.id, row);
        item.levels.push(level);
        added.push(level);
      }
      return { added, skipped };
    }),
    updateLevel: vi.fn(
      async (userId: string, watchlistId: string, levelId: string, patch: UpdateLevelPatch) => {
        if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
        const found = findLevel(watchlistId, levelId);
        if (found === null) return null;
        Object.assign(found.level, patch);
        if (patch.status !== undefined) {
          found.level.hitAt = patch.status === "hit" ? new Date() : null;
        }
        return found.level;
      },
    ),
    removeLevel: vi.fn(async (userId: string, watchlistId: string, levelId: string) => {
      if (ownedList(userId, watchlistId) === null) throw new Error("Watchlist not found.");
      const found = findLevel(watchlistId, levelId);
      if (found === null) return false;
      found.item.levels.splice(found.item.levels.indexOf(found.level), 1);
      return true;
    }),
    getFundSnapshots: vi.fn(async (codes: string[]) => {
      const map = new Map<string, FundSnapshot>();
      for (const code of codes) {
        map.set(code, {
          code,
          name: `Fund ${code}`,
          nav: 1.5,
          accNav: 2,
          dailyReturn: 0.4,
          navDate: "2026-08-15",
        });
      }
      return map;
    }),
  };

  return { repo, lists, items };
}

function yahoo(): YahooFinanceClient {
  return {
    quote: vi.fn(async (symbols: string[]) =>
      symbols.map((symbol) => ({
        symbol,
        regularMarketPrice: 100,
        regularMarketChange: 1,
        regularMarketChangePercent: 1,
        currency: "USD",
        marketState: "REGULAR",
      })),
    ),
  } as unknown as YahooFinanceClient;
}

async function connect(repo: WatchlistRepo, identity: McpAuth | null = auth) {
  const server = buildMcpServer(identity, { client: yahoo(), watchlists: repo });
  const client = new Client({ name: "watchlist-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.request(
    { method: "tools/call", params: { name, arguments: args } },
    CallToolResultSchema,
  );
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  return { isError: result.isError === true, text, data: result.isError ? null : JSON.parse(text) };
}

function list(id: string, name: string, userId = "user-1"): WatchlistSummary {
  return {
    id,
    userId,
    name,
    description: null,
    itemCount: 0,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

describe("watchlist tools", () => {
  it("creates the first list implicitly and infers item kinds", async () => {
    const { repo, items } = memoryRepo();
    const { server, client } = await connect(repo);

    try {
      const result = await call(client, "watchlistAdd", {
        items: [{ ref: "nvda", note: "AI capex" }, { ref: "161125" }],
      });

      expect(result.data.watchlist.created).toBe(true);
      // The entry price is captured from the quote, not asked for: the fake
      // prices every symbol at 100 and every fund's NAV at 1.5.
      expect(result.data.added).toEqual([
        { kind: "symbol", ref: "NVDA", name: null, entryPrice: 100 },
        { kind: "fund", ref: "161125", name: null, entryPrice: 1.5 },
      ]);
      // Stored upper-cased, so the same instrument cannot land twice.
      expect(items.map((item) => item.ref)).toEqual(["NVDA", "161125"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reports re-added items as skipped instead of failing the call", async () => {
    const { repo } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      await call(client, "watchlistAdd", { list: "Core", items: [{ ref: "NVDA" }] });
      const again = await call(client, "watchlistAdd", {
        list: "Core",
        items: [{ ref: "NVDA" }, { ref: "AMD" }],
      });

      expect(again.isError).toBe(false);
      expect(again.data.skipped).toEqual(["NVDA"]);
      expect(again.data.added).toEqual([{ kind: "symbol", ref: "AMD", name: null, entryPrice: 100 }]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuses to guess between several lists, and names them", async () => {
    const { repo } = memoryRepo({ lists: [list("list-1", "Core"), list("list-2", "Speculative")] });
    const { server, client } = await connect(repo);

    try {
      const result = await call(client, "watchlistAdd", { items: [{ ref: "NVDA" }] });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('"Core"');
      expect(result.text).toContain('"Speculative"');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("will not fork a new list from an unknown name without create: true", async () => {
    const { repo } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      const refused = await call(client, "watchlistAdd", {
        list: "Cor",
        items: [{ ref: "NVDA" }],
      });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("create: true");

      const allowed = await call(client, "watchlistAdd", {
        list: "Cor",
        create: true,
        items: [{ ref: "NVDA" }],
      });
      expect(allowed.data.watchlist.created).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("prices a list by name, mixing quotes and NAV", async () => {
    const { repo } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      await call(client, "watchlistAdd", {
        list: "core",
        items: [
          { ref: "NVDA", levels: [{ kind: "support", price: 80 }] },
          { ref: "161125" },
        ],
      });
      const result = await call(client, "watchlist", { list: "Core" });

      expect(result.data.watchlist.name).toBe("Core");
      expect(result.data.items[0].live).toMatchObject({ basis: "market", price: 100 });
      // Priced at 100 with support at 80: 20% below, and the nearest thing down.
      expect(result.data.items[0].levels[0]).toMatchObject({
        kind: "support",
        side: "below",
        distancePercent: -20,
        source: "agent",
      });
      expect(result.data.items[0].nearest.below.price).toBe(80);
      expect(result.data.items[0].nearest.above).toBeNull();
      expect(result.data.items[1].live).toMatchObject({ basis: "nav", price: 1.5 });
      expect(result.data.summary).toMatchObject({ items: 2, priced: 2, advancing: 2 });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("skips the quote lookup when only membership was asked for", async () => {
    // Seeded rather than added through the tool: adding captures an entry price,
    // which is a quote of its own and would mask the thing under test.
    const { repo } = memoryRepo({
      lists: [list("list-1", "Core")],
      items: [
        {
          id: "item-1",
          watchlistId: "list-1",
          kind: "symbol",
          ref: "NVDA",
          name: null,
          note: null,
          entryPrice: 92,
          entryAt: null,
          levels: [],
          createdAt: new Date("2026-08-02T00:00:00Z"),
        },
      ],
    });
    const client_ = yahoo();
    const server = buildMcpServer(auth, { client: client_, watchlists: repo });
    const client = new Client({ name: "watchlist-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await call(client, "watchlist", { list: "Core", quotes: false });

      expect(result.data.items).toEqual([
        {
          kind: "symbol",
          ref: "NVDA",
          name: null,
          note: null,
          entryPrice: 92,
          levels: [],
          addedAt: "2026-08-02T00:00:00.000Z",
        },
      ]);
      expect(client_.quote).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("records levels against an item already tracked, and converges on re-runs", async () => {
    const { repo, items } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      await call(client, "watchlistAdd", { list: "Core", items: [{ ref: "NVDA" }] });
      const first = await call(client, "watchlistLevels", {
        list: "Core",
        ref: "nvda",
        add: [
          { kind: "resistance", price: 185, label: "prior high" },
          { kind: "stop", price: 152, note: "thesis breaks" },
        ],
      });

      expect(first.data.added).toHaveLength(2);
      expect(first.data.skipped).toBe(0);
      // Written by an agent, and shown as such on the dashboard.
      expect(items[0]?.levels.map((level) => level.source)).toEqual(["agent", "agent"]);

      // The same analysis run again adds nothing rather than stacking copies.
      const again = await call(client, "watchlistLevels", {
        list: "Core",
        ref: "NVDA",
        add: [{ kind: "resistance", price: 185, label: "prior high" }],
      });
      expect(again.data.added).toEqual([]);
      expect(again.data.skipped).toBe(1);
      expect(items[0]?.levels).toHaveLength(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("marks a level hit and drops one by id, reporting ids it did not find", async () => {
    const { repo, items } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      await call(client, "watchlistAdd", { list: "Core", items: [{ ref: "NVDA" }] });
      const added = await call(client, "watchlistLevels", {
        list: "Core",
        ref: "NVDA",
        add: [{ kind: "target", price: 210 }, { kind: "support", price: 168 }],
      });
      const [target, support] = added.data.added as { id: string }[];

      const result = await call(client, "watchlistLevels", {
        list: "Core",
        ref: "NVDA",
        update: [{ id: target!.id, status: "hit" }],
        remove: [support!.id, "level-does-not-exist"],
      });

      expect(result.data.updated).toEqual([
        { id: target!.id, kind: "target", price: 210, status: "hit" },
      ]);
      expect(result.data.removed).toEqual([support!.id]);
      expect(result.data.notFound).toEqual(["level-does-not-exist"]);
      expect(items[0]?.levels).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuses to annotate something that is not on the list", async () => {
    const { repo } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      const result = await call(client, "watchlistLevels", {
        list: "Core",
        ref: "TSLA",
        add: [{ kind: "target", price: 400 }],
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("watchlistAdd");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("removes by ref and reports what was not there", async () => {
    const { repo, items } = memoryRepo({ lists: [list("list-1", "Core")] });
    const { server, client } = await connect(repo);

    try {
      await call(client, "watchlistAdd", { list: "Core", items: [{ ref: "NVDA" }] });
      const result = await call(client, "watchlistRemove", { list: "Core", refs: ["nvda", "AMD"] });

      expect(result.data.removed).toEqual([{ kind: "symbol", ref: "NVDA", name: null }]);
      expect(result.data.notFound).toEqual(["AMD"]);
      expect(items).toHaveLength(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("lists the user's own watchlists only", async () => {
    const { repo } = memoryRepo({
      lists: [list("list-1", "Core"), list("list-2", "Someone else", "user-2")],
    });
    const { server, client } = await connect(repo);

    try {
      const result = await call(client, "watchlists");
      expect(result.data.count).toBe(1);
      expect(result.data.watchlists[0].name).toBe("Core");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuses to run without an authenticated identity", async () => {
    const { repo } = memoryRepo();
    const { server, client } = await connect(repo, null);

    try {
      for (const tool of ["watchlists", "watchlist", "watchlistRemove"]) {
        const args = tool === "watchlistRemove" ? { refs: ["NVDA"] } : {};
        const result = await call(client, tool, args);
        expect(result.isError, tool).toBe(true);
        expect(result.text, tool).toContain("authenticated");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
