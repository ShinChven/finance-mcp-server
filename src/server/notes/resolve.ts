/**
 * How a caller names a collection.
 *
 * Agents file things the way a person describes them — "put it in my macro
 * notes" — so the tools accept a name as readily as an id. The rules live here
 * rather than in each tool so they cannot drift apart.
 *
 * Unlike watchlists, an unnamed collection is not an error: a note filed
 * nowhere is the normal case, and forcing a filing decision before a thought
 * can be captured is how notes stop getting written.
 */

import { MAX_COLLECTIONS_PER_USER } from "../../shared/notes.js";
import type { NoteCollectionSummary, NotesRepo } from "./repo.js";

export class CollectionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionNotFoundError";
  }
}

function nameList(collections: NoteCollectionSummary[]): string {
  return collections.map((collection) => `"${collection.name}"`).join(", ");
}

/** Resolves an id or a name to one of the user's collections. */
export async function resolveCollection(
  repo: NotesRepo,
  userId: string,
  reference: string,
): Promise<NoteCollectionSummary> {
  const collections = await repo.listCollections(userId);
  const needle = reference.trim();

  const match =
    collections.find((collection) => collection.id === needle) ??
    collections.find((collection) => collection.name.toLowerCase() === needle.toLowerCase());
  if (match !== undefined) return match;

  throw new CollectionNotFoundError(
    collections.length === 0
      ? `No collection named "${needle}". You have none yet — pass createCollection: true to make it.`
      : `No collection named "${needle}". You have: ${nameList(collections)}.`,
  );
}

/**
 * Resolution for the write path, which may create the collection.
 *
 * A name that does not match is an error unless `create` is explicit —
 * otherwise one typo silently forks a parallel collection, and the split only
 * surfaces later when half the notes are missing from it.
 */
export async function resolveOrCreateCollection(
  repo: NotesRepo,
  userId: string,
  options: { reference?: string; create?: boolean },
): Promise<{ collection: NoteCollectionSummary | null; created: boolean }> {
  const reference = options.reference?.trim();
  if (reference === undefined || reference === "") return { collection: null, created: false };

  const collections = await repo.listCollections(userId);
  const existing =
    collections.find((collection) => collection.id === reference) ??
    collections.find((collection) => collection.name.toLowerCase() === reference.toLowerCase());
  if (existing !== undefined) return { collection: existing, created: false };

  if (options.create !== true) {
    throw new CollectionNotFoundError(
      collections.length === 0
        ? `No collection named "${reference}". Pass createCollection: true to make it.`
        : `No collection named "${reference}". You have: ${nameList(collections)}. ` +
          `Pass createCollection: true to make a new one.`,
    );
  }
  if (collections.length >= MAX_COLLECTIONS_PER_USER) {
    throw new CollectionNotFoundError(
      `You already have ${MAX_COLLECTIONS_PER_USER} collections — delete one first.`,
    );
  }

  const collection = await repo.createCollection(userId, { name: reference });
  return { collection, created: true };
}
