import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { McpAuth } from "../../lib/http.js";
import type {
  CreateNoteInput,
  NoteCollectionSummary,
  NoteQuery,
  NoteRecord,
  NotesRepo,
  UpdateNotePatch,
} from "../../notes/repo.js";
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
 * In-memory stand-in for the Drizzle repo.
 *
 * It reproduces the rules the tools are relied on to respect — ownership, the
 * conjunctive tag filter, the disjunctive symbol filter, and archived notes
 * being excluded by default — but not Postgres ranking, which
 * `notes/repo-live.test.ts` covers against a real database.
 */
function memoryRepo(seed: { notes?: Partial<NoteRecord>[]; collections?: string[] } = {}) {
  const collections = new Map<string, NoteCollectionSummary>();
  const notes: NoteRecord[] = [];
  let counter = 0;

  for (const name of seed.collections ?? []) {
    const id = `col-${++counter}`;
    collections.set(id, {
      id,
      userId: "user-1",
      name,
      description: null,
      noteCount: 0,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    });
  }

  const makeNote = (input: Partial<NoteRecord>): NoteRecord => ({
    id: `note-${++counter}`,
    userId: "user-1",
    collectionId: null,
    collectionName: null,
    title: "Untitled",
    summary: null,
    body: "",
    status: "active",
    source: "web",
    sourceRef: null,
    pinned: false,
    tags: [],
    symbols: [],
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...input,
  });

  for (const note of seed.notes ?? []) notes.push(makeNote(note));

  const owned = (userId: string, id: string): NoteRecord | null =>
    notes.find((note) => note.id === id && note.userId === userId) ?? null;

  const repo: NotesRepo = {
    listCollections: vi.fn(async (userId: string) =>
      [...collections.values()].filter((collection) => collection.userId === userId),
    ),
    getCollection: vi.fn(async (userId: string, id: string) => {
      const collection = collections.get(id);
      return collection !== undefined && collection.userId === userId ? collection : null;
    }),
    findCollectionByName: vi.fn(async (userId: string, name: string) => {
      return (
        [...collections.values()].find(
          (collection) =>
            collection.userId === userId && collection.name.toLowerCase() === name.toLowerCase(),
        ) ?? null
      );
    }),
    createCollection: vi.fn(async (userId: string, input: { name: string }) => {
      const collection: NoteCollectionSummary = {
        id: `col-${++counter}`,
        userId,
        name: input.name,
        description: null,
        noteCount: 0,
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      };
      collections.set(collection.id, collection);
      return collection;
    }),
    updateCollection: vi.fn(async () => null),
    deleteCollection: vi.fn(async () => false),

    searchNotes: vi.fn(async (userId: string, query: NoteQuery = {}) => {
      const status = query.status ?? "active";
      const needle = query.q?.toLowerCase() ?? "";
      const items = notes.filter((note) => {
        if (note.userId !== userId) return false;
        if (status !== "any" && note.status !== status) return false;
        if (query.collectionId === "none" && note.collectionId !== null) return false;
        if (
          query.collectionId !== undefined &&
          query.collectionId !== "none" &&
          note.collectionId !== query.collectionId
        ) {
          return false;
        }
        if ((query.tags ?? []).some((tag) => !note.tags.includes(tag))) return false;
        const symbols = query.symbols ?? [];
        if (symbols.length > 0 && !note.symbols.some((symbol) => symbols.includes(symbol.ref))) {
          return false;
        }
        if (needle === "") return true;
        return [note.title, note.summary ?? "", note.body, ...note.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
      return { items: items.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 20)), total: items.length };
    }),

    getNote: vi.fn(async (userId: string, id: string) => owned(userId, id)),
    getNotes: vi.fn(async (userId: string, ids: string[]) =>
      ids.map((id) => owned(userId, id)).filter((note): note is NoteRecord => note !== null),
    ),

    createNote: vi.fn(async (userId: string, input: CreateNoteInput) => {
      const note = makeNote({
        userId,
        title: input.title,
        summary: input.summary ?? null,
        body: input.body ?? "",
        collectionId: input.collectionId ?? null,
        collectionName:
          input.collectionId === null || input.collectionId === undefined
            ? null
            : (collections.get(input.collectionId)?.name ?? null),
        tags: input.tags ?? [],
        symbols: input.symbols ?? [],
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        ...(input.pinned !== undefined && { pinned: input.pinned }),
        ...(input.status !== undefined && { status: input.status }),
      });
      notes.push(note);
      return note;
    }),

    updateNote: vi.fn(async (userId: string, id: string, patch: UpdateNotePatch) => {
      const note = owned(userId, id);
      if (note === null) return null;
      if (patch.title !== undefined) note.title = patch.title;
      if (patch.summary !== undefined) note.summary = patch.summary;
      if (patch.body !== undefined) note.body = patch.body;
      if (patch.status !== undefined) note.status = patch.status;
      if (patch.pinned !== undefined) note.pinned = patch.pinned;
      if (patch.collectionId !== undefined) {
        note.collectionId = patch.collectionId;
        note.collectionName =
          patch.collectionId === null ? null : (collections.get(patch.collectionId)?.name ?? null);
      }
      if (patch.tags !== undefined) note.tags = [...patch.tags];
      if (patch.addTags !== undefined) note.tags = [...new Set([...note.tags, ...patch.addTags])];
      if (patch.symbols !== undefined) note.symbols = [...patch.symbols];
      if (patch.addSymbols !== undefined) {
        const seen = new Set(note.symbols.map((symbol) => `${symbol.kind}:${symbol.ref}`));
        for (const symbol of patch.addSymbols) {
          if (!seen.has(`${symbol.kind}:${symbol.ref}`)) note.symbols.push(symbol);
        }
      }
      return note;
    }),

    deleteNote: vi.fn(async (userId: string, id: string) => {
      const note = owned(userId, id);
      if (note === null) return false;
      notes.splice(notes.indexOf(note), 1);
      return true;
    }),

    facets: vi.fn(async (userId: string) => {
      const tags = new Map<string, number>();
      const symbols = new Map<string, { kind: "symbol" | "fund"; ref: string; count: number }>();
      for (const note of notes) {
        if (note.userId !== userId || note.status !== "active") continue;
        for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
        for (const symbol of note.symbols) {
          const key = `${symbol.kind}:${symbol.ref}`;
          const existing = symbols.get(key) ?? { ...symbol, count: 0 };
          existing.count += 1;
          symbols.set(key, existing);
        }
      }
      return {
        tags: [...tags].map(([tag, count]) => ({ tag, count })),
        symbols: [...symbols.values()],
      };
    }),
  };

  return { repo, notes, collections };
}

async function connect(repo: NotesRepo, identity: McpAuth | null = auth) {
  const server = buildMcpServer(identity, { notes: repo });
  const client = new Client({ name: "notes-test", version: "0.1.0" });
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

async function withClient<T>(repo: NotesRepo, fn: (client: Client) => Promise<T>): Promise<T> {
  const { server, client } = await connect(repo);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("note tools", () => {
  it("normalizes tags and symbols on the way in", async () => {
    const { repo, notes } = memoryRepo();

    await withClient(repo, async (client) => {
      const result = await call(client, "noteCreate", {
        title: "Fed pivot",
        summary: "Two cuts priced by June.",
        body: "Long form reasoning.",
        tags: ["Rate Cut", "#macro", "rate cut"],
        symbols: ["nvda", "000834", { ref: "0700.hk" }],
      });

      expect(result.isError).toBe(false);
      expect(result.data.note.tags).toEqual(["rate-cut", "macro"]);
      expect(result.data.note.symbols).toEqual(["NVDA", "000834", "0700.HK"]);
    });

    // A bare 6-digit code is a fund, everything else a Yahoo symbol — the same
    // rule the watchlist uses, so the two features agree on one spelling.
    expect(notes[0]!.symbols.map((symbol) => symbol.kind)).toEqual(["symbol", "fund", "symbol"]);
    expect(notes[0]!.source).toBe("agent");
  });

  it("nudges when a note is saved without a summary", async () => {
    const { repo } = memoryRepo();
    await withClient(repo, async (client) => {
      const result = await call(client, "noteCreate", { title: "Something", body: "text" });
      expect(result.data.note_hint).toContain("without a summary");
    });
  });

  it("will not file into an unknown collection without createCollection", async () => {
    const { repo } = memoryRepo({ collections: ["Macro"] });

    await withClient(repo, async (client) => {
      const refused = await call(client, "noteCreate", { title: "N", collection: "Marco" });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('"Macro"');

      const created = await call(client, "noteCreate", {
        title: "N",
        collection: "Theses",
        createCollection: true,
      });
      expect(created.data.collectionCreated).toBe("Theses");
      expect(created.data.note.collection).toBe("Theses");
    });
  });

  it("returns summaries and snippets in search, never bodies", async () => {
    const { repo } = memoryRepo({
      notes: [
        {
          title: "NVDA datacenter thesis",
          summary: "Capex guidance is the tell.",
          body: "A".repeat(200) + " Blackwell ramp decides the datacenter line. " + "B".repeat(200),
          tags: ["ai"],
        },
      ],
    });

    await withClient(repo, async (client) => {
      const result = await call(client, "notesSearch", { q: "Blackwell" });
      const hit = result.data.notes[0];

      expect(hit.summary).toBe("Capex guidance is the tell.");
      expect(hit.body).toBeUndefined();
      expect(hit.snippet).toContain("Blackwell ramp");
      // Windowed around the hit rather than the whole body.
      expect(hit.snippet.length).toBeLessThan(300);
      expect(hit.bodyChars).toBeGreaterThan(400);
    });
  });

  it("filters conjunctively on tags and disjunctively on symbols", async () => {
    const { repo } = memoryRepo({
      notes: [
        { title: "A", tags: ["macro", "rate-cut"], symbols: [{ kind: "symbol", ref: "TLT" }] },
        { title: "B", tags: ["macro"], symbols: [{ kind: "symbol", ref: "NVDA" }] },
      ],
    });

    await withClient(repo, async (client) => {
      expect((await call(client, "notesSearch", { tags: ["macro"] })).data.total).toBe(2);
      expect((await call(client, "notesSearch", { tags: ["macro", "rate-cut"] })).data.total).toBe(1);
      expect(
        (await call(client, "notesSearch", { symbols: ["NVDA", "TLT"] })).data.total,
      ).toBe(2);
      expect((await call(client, "notesSearch", { symbols: ["nvda"] })).data.total).toBe(1);
    });
  });

  it("keeps archived notes out of the listing but reachable", async () => {
    const { repo } = memoryRepo({
      notes: [{ title: "Current" }, { title: "Old", status: "archived" }],
    });

    await withClient(repo, async (client) => {
      expect((await call(client, "notesSearch", {})).data.total).toBe(1);
      expect((await call(client, "notesSearch", { status: "any" })).data.total).toBe(2);
      expect((await call(client, "notesSearch", { status: "archived" })).data.notes[0].title).toBe(
        "Old",
      );
    });
  });

  it("appends to a body instead of resending it", async () => {
    const { repo, notes } = memoryRepo({ notes: [{ title: "Running", body: "First point." }] });
    const id = notes[0]!.id;

    await withClient(repo, async (client) => {
      await call(client, "noteUpdate", { id, appendBody: "Second point." });
      await call(client, "noteUpdate", { id, appendBody: "Third point." });
    });

    expect(notes[0]!.body).toBe("First point.\n\nSecond point.\n\nThird point.");
  });

  it("adds tags without dropping the ones already there, and replaces on request", async () => {
    const { repo, notes } = memoryRepo({ notes: [{ title: "T", tags: ["macro"] }] });
    const id = notes[0]!.id;

    await withClient(repo, async (client) => {
      const added = await call(client, "noteUpdate", { id, addTags: ["Rate Cut"] });
      expect(added.data.note.tags).toEqual(["macro", "rate-cut"]);

      const replaced = await call(client, "noteUpdate", { id, tags: ["ai"] });
      expect(replaced.data.note.tags).toEqual(["ai"]);
    });
  });

  it("reads full bodies by id and reports ids it could not find", async () => {
    const { repo, notes } = memoryRepo({ notes: [{ title: "T", body: "The whole thing." }] });

    await withClient(repo, async (client) => {
      const result = await call(client, "noteRead", { ids: [notes[0]!.id, "note-missing"] });
      expect(result.data.notes[0].body).toBe("The whole thing.");
      expect(result.data.missing).toEqual(["note-missing"]);
    });
  });

  it("never reaches another account's notes", async () => {
    const { repo, notes } = memoryRepo({ notes: [{ title: "Theirs", userId: "user-2" }] });

    await withClient(repo, async (client) => {
      expect((await call(client, "notesSearch", {})).data.total).toBe(0);
      expect((await call(client, "noteRead", { ids: [notes[0]!.id] })).data.count).toBe(0);

      const update = await call(client, "noteUpdate", { id: notes[0]!.id, title: "Mine now" });
      expect(update.isError).toBe(true);
      const remove = await call(client, "noteDelete", { id: notes[0]!.id });
      expect(remove.isError).toBe(true);
    });

    expect(notes[0]!.title).toBe("Theirs");
  });

  it("refuses to run without an authenticated identity", async () => {
    const { repo } = memoryRepo();
    const { server, client } = await connect(repo, null);

    try {
      for (const tool of ["noteCollections", "notesSearch"]) {
        const result = await call(client, tool);
        expect(result.isError).toBe(true);
        expect(result.text).toContain("authenticated");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("deletes one note and reports what went", async () => {
    const { repo, notes } = memoryRepo({ notes: [{ title: "Stale" }] });
    const id = notes[0]!.id;

    await withClient(repo, async (client) => {
      const result = await call(client, "noteDelete", { id });
      expect(result.data.deleted).toEqual({ id, title: "Stale" });
      expect((await call(client, "noteDelete", { id })).isError).toBe(true);
    });

    expect(notes).toHaveLength(0);
  });

  it("orients an agent with collections, tags and symbols in one call", async () => {
    const { repo } = memoryRepo({
      collections: ["Macro"],
      notes: [{ title: "A", tags: ["macro"], symbols: [{ kind: "symbol", ref: "NVDA" }] }],
    });

    await withClient(repo, async (client) => {
      const result = await call(client, "noteCollections");
      expect(result.data.notes).toBe(1);
      expect(result.data.collections[0].name).toBe("Macro");
      expect(result.data.tags).toEqual([{ tag: "macro", count: 1 }]);
      expect(result.data.symbols).toEqual([{ kind: "symbol", ref: "NVDA", count: 1 }]);
    });
  });
});
