/**
 * Where change events actually come from.
 *
 * The dashboard and the agent write through the same repositories -- the API
 * routes and the MCP tools both call `createLazyNotesRepo()` and friends -- so
 * decorating the repository catches every write path there is, including tools
 * that do not exist yet. The alternative, publishing from each route and each
 * tool handler, is a dozen call sites that a new feature can silently forget.
 *
 * Two conventions make this safe to do generically:
 *
 * - every mutating repo method takes the owning `userId` as its first argument,
 *   which is what the events are addressed to;
 * - a method that changed nothing reports it in its return value (`null` for a
 *   miss, `false` for a delete that matched no row, an empty array for a no-op
 *   batch). Those return `null` from `ids` here and publish nothing, so a
 *   re-running agent converging on the same state does not spam the dashboard.
 *
 * Ids are a hint for targeted invalidation, not a contract. Where the id the
 * client keys on cannot be known -- a collection rename that moves unknown
 * notes, a skill deleted by slug -- the spec returns `[]`, which tells the
 * client to widen instead of guess.
 */

import type { RealtimeAction, RealtimeTopic } from "../../shared/realtime.js";
import type { NotesRepo } from "../notes/repo.js";
import type { SkillsRepo } from "../skills/repo.js";
import type { WatchlistRepo } from "../watchlist/repo.js";
import { publishChange } from "./bus.js";

interface EventSpec {
  action: RealtimeAction;
  /** `null` means the call changed nothing; publish no event. */
  ids: (result: unknown, args: unknown[]) => string[] | null;
}

type EventSpecs<T> = Partial<Record<keyof T & string, EventSpec>>;

/**
 * The `id` of a returned record.
 *
 * The two "nothing to say" answers are deliberately different. A null or
 * undefined result means the write matched nothing, so there is no event. A
 * record whose id cannot be read still changed something, so it publishes with
 * no ids and the client widens -- an extra refetch, rather than a page that
 * quietly stops updating, which is the failure this whole feature exists to
 * prevent.
 */
function idOf(result: unknown): string[] | null {
  if (result === null || result === undefined) return null;
  if (typeof result !== "object" || !("id" in result)) return [];
  const { id } = result as { id: unknown };
  return typeof id === "string" ? [id] : [];
}

/** The nth argument, when it is a string. Used for ids only the caller knows. */
function argAt(args: unknown[], index: number): string[] | null {
  const value = args[index];
  return typeof value === "string" ? [value] : [];
}

function nonEmpty(result: unknown): boolean {
  return Array.isArray(result) && result.length > 0;
}

export function withChangeEvents<T extends object>(
  repo: T,
  topic: RealtimeTopic,
  specs: EventSpecs<T>,
): T {
  return new Proxy(repo, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      const spec = typeof property === "string" ? specs[property as keyof T & string] : undefined;
      if (spec === undefined || typeof value !== "function") return value;

      return async (...args: unknown[]): Promise<unknown> => {
        // A throw from the write itself never reaches the lines below, so a
        // failed write publishes nothing.
        const result = await (value as (...inner: unknown[]) => unknown).apply(target, args);
        try {
          const userId = args[0];
          const ids = spec.ids(result, args);
          if (ids !== null && typeof userId === "string") {
            publishChange(userId, topic, spec.action, ids);
          }
        } catch (error) {
          // The write already succeeded. Announcing it is a side effect, and a
          // side effect must never turn a saved note into an error the user
          // sees; the worst case is a page that refreshes a moment late.
          console.error(`realtime: failed to publish ${topic} change:`, error);
        }
        return result;
      };
    },
  });
}

export function notesRepoWithEvents(repo: NotesRepo): NotesRepo {
  return withChangeEvents<NotesRepo>(repo, "notes", {
    createNote: { action: "created", ids: idOf },
    updateNote: { action: "updated", ids: idOf },
    deleteNote: { action: "deleted", ids: (result, args) => (result === true ? argAt(args, 1) : null) },
    // Collection edits move notes between listings without touching a note row,
    // so they are notes-topic events with no id worth naming.
    createCollection: { action: "created", ids: () => [] },
    updateCollection: { action: "updated", ids: (result) => (result === null ? null : []) },
    deleteCollection: { action: "deleted", ids: (result) => (result === true ? [] : null) },
  });
}

export function watchlistRepoWithEvents(repo: WatchlistRepo): WatchlistRepo {
  // Item events carry the *list* id: that is what the items query keys on.
  return withChangeEvents<WatchlistRepo>(repo, "watchlist", {
    createWatchlist: { action: "created", ids: idOf },
    updateWatchlist: { action: "updated", ids: idOf },
    deleteWatchlist: {
      action: "deleted",
      ids: (result, args) => (result === true ? argAt(args, 1) : null),
    },
    addItems: {
      action: "created",
      ids: (result, args) => {
        const added = (result as { added?: unknown }).added;
        return nonEmpty(added) ? argAt(args, 1) : null;
      },
    },
    updateItem: { action: "updated", ids: (result, args) => (result === null ? null : argAt(args, 1)) },
    // A reorder that changed nothing returns false and stays silent, so two
    // tabs settling on the same order do not ping-pong refetches at each other.
    reorderWatchlists: { action: "updated", ids: (result) => (result === true ? [] : null) },
    reorderItems: {
      action: "updated",
      ids: (result, args) => (result === true ? argAt(args, 1) : null),
    },
    removeItems: { action: "deleted", ids: (result, args) => (nonEmpty(result) ? argAt(args, 1) : null) },
    // Levels hang off an item, but the client keys on the list, so a level
    // write is an update to the list that holds it.
    addLevels: {
      action: "updated",
      ids: (result, args) => {
        const added = (result as { added?: unknown }).added;
        return nonEmpty(added) ? argAt(args, 1) : null;
      },
    },
    updateLevel: { action: "updated", ids: (result, args) => (result === null ? null : argAt(args, 1)) },
    removeLevel: { action: "updated", ids: (result, args) => (result === true ? argAt(args, 1) : null) },
  });
}

export function skillsRepoWithEvents(repo: SkillsRepo): SkillsRepo {
  return withChangeEvents<SkillsRepo>(repo, "skills", {
    createSkill: { action: "created", ids: idOf },
    updateSkill: { action: "updated", ids: idOf },
    // Addressed by id *or* slug, so the deleted id is not knowable from the
    // arguments; the client invalidates skill details wholesale.
    deleteSkill: { action: "deleted", ids: (result) => (result === true ? [] : null) },
  });
}
