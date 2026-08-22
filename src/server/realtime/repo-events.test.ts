import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../shared/realtime.js";
import type { NotesRepo } from "../notes/repo.js";
import type { SkillsRepo } from "../skills/repo.js";
import type { WatchlistRepo } from "../watchlist/repo.js";
import { COALESCE_MS, resetBus, subscribe, userChannel } from "./bus.js";
import { notesRepoWithEvents, skillsRepoWithEvents, watchlistRepoWithEvents } from "./repo-events.js";

/** Collects what a decorated repo publishes for one user. */
function watch(userId: string): ServerMessage[] {
  const received: ServerMessage[] = [];
  subscribe([userChannel(userId)], (message) => received.push(message));
  return received;
}

function flush(): void {
  vi.advanceTimersByTime(COALESCE_MS);
}

describe("repo change events", () => {
  afterEach(() => {
    resetBus();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes the new id when a note is created", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      createNote: async () => ({ id: "note-1" }),
    } as unknown as NotesRepo);

    await repo.createNote("u1", {} as Parameters<NotesRepo["createNote"]>[1]);
    flush();

    expect(received).toEqual([
      { type: "change", topic: "notes", action: "created", ids: ["note-1"] },
    ]);
  });

  it("publishes nothing when an update matched no row", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      updateNote: async () => null,
    } as unknown as NotesRepo);

    await repo.updateNote("u1", "missing", {});
    flush();

    expect(received).toHaveLength(0);
  });

  it("takes a deleted note's id from the arguments", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      deleteNote: async () => true,
    } as unknown as NotesRepo);

    await repo.deleteNote("u1", "note-9");
    flush();

    expect(received).toEqual([
      { type: "change", topic: "notes", action: "deleted", ids: ["note-9"] },
    ]);
  });

  it("publishes nothing when a delete matched nothing", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      deleteNote: async () => false,
    } as unknown as NotesRepo);

    await repo.deleteNote("u1", "note-9");
    flush();

    expect(received).toHaveLength(0);
  });

  it("publishes nothing when the write throws", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      createNote: async () => {
        throw new Error("note limit reached");
      },
    } as unknown as NotesRepo);

    await expect(repo.createNote("u1", {} as Parameters<NotesRepo["createNote"]>[1])).rejects.toThrow(
      "note limit reached",
    );
    flush();

    expect(received).toHaveLength(0);
  });

  it("leaves read methods untouched", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = notesRepoWithEvents({
      searchNotes: async () => ({ items: [], total: 0 }),
    } as unknown as NotesRepo);

    await expect(repo.searchNotes("u1")).resolves.toEqual({ items: [], total: 0 });
    flush();

    expect(received).toHaveLength(0);
  });

  it("addresses watchlist item events to the list, not the item", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = watchlistRepoWithEvents({
      addItems: async () => ({ added: [{ id: "item-1" }], skipped: [] }),
    } as unknown as WatchlistRepo);

    await repo.addItems("u1", "list-7", []);
    flush();

    expect(received).toEqual([
      { type: "change", topic: "watchlist", action: "created", ids: ["list-7"] },
    ]);
  });

  it("publishes nothing when every added item was already on the list", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = watchlistRepoWithEvents({
      addItems: async () => ({ added: [], skipped: ["NVDA"] }),
    } as unknown as WatchlistRepo);

    // An agent re-running the same plan converges instead of spamming.
    await repo.addItems("u1", "list-7", []);
    flush();

    expect(received).toHaveLength(0);
  });

  it("publishes nothing when a removal matched nothing", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = watchlistRepoWithEvents({
      removeItems: async () => [],
    } as unknown as WatchlistRepo);

    await repo.removeItems("u1", "list-7", { refs: ["NVDA"] });
    flush();

    expect(received).toHaveLength(0);
  });

  it("returns the write's result even when publishing the event fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const received = watch("u1");
    // A repo that breaks the shape the spec reads: the saved note must still
    // come back, because announcing a write is a side effect of it.
    const repo = watchlistRepoWithEvents({
      addItems: async () => null,
    } as unknown as WatchlistRepo);

    await expect(repo.addItems("u1", "list-7", [])).resolves.toBeNull();
    flush();

    expect(received).toHaveLength(0);
  });

  it("widens on a skill deleted by slug, whose id it cannot know", async () => {
    vi.useFakeTimers();
    const received = watch("u1");
    const repo = skillsRepoWithEvents({
      deleteSkill: async () => true,
    } as unknown as SkillsRepo);

    await repo.deleteSkill("u1", "some-slug");
    flush();

    expect(received).toEqual([{ type: "change", topic: "skills", action: "deleted", ids: [] }]);
  });
});
