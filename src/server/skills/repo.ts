/**
 * Read/write model for skills.
 *
 * The MCP tools depend on `SkillsRepo` rather than on Drizzle, so they stay
 * unit-testable without a database — the same arrangement as `notes/repo.ts`
 * and `watchlist/repo.ts`.
 *
 * Every method takes `userId` and filters on it. Ownership is enforced here,
 * not only in the route layer, because two callers reach these rows: the
 * dashboard API and the MCP tools. A skill leaking across accounts would not
 * just expose text — it would hand one user's agent another user's standing
 * instructions.
 */

import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import { skillRevisions, skills, type Skill } from "../db/schema.js";
import { escapeLike } from "../lib/listing.js";
import {
  MAX_SEARCH_RESULTS,
  MAX_SKILLS_PER_USER,
  type SkillSort,
  type SkillSource,
  type SkillStatus,
} from "../../shared/skills.js";

/** The stored vector is an implementation detail of search; nothing reads it. */
export type SkillRecord = Omit<Skill, "searchVector"> & {
  /** Full-text rank, present only on a search with a query. */
  score?: number;
};

export interface SkillQuery {
  q?: string;
  status?: SkillStatus | "any";
  sort?: SkillSort;
  limit?: number;
  offset?: number;
}

export interface CreateSkillInput {
  slug: string;
  name: string;
  whenToUse: string;
  body?: string;
  status?: SkillStatus;
  source: SkillSource;
  sourceRef?: string | null;
}

export interface UpdateSkillPatch {
  slug?: string;
  name?: string;
  whenToUse?: string;
  body?: string;
  status?: SkillStatus;
  sourceRef?: string | null;
}

/** Thrown for the caps in `shared/skills.ts`; routes map it to 409. */
export class SkillLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillLimitError";
  }
}

/** Thrown when a slug collides for the same user. */
export class SkillSlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`You already have a skill called "${slug}".`);
    this.name = "SkillSlugTakenError";
  }
}

export interface SkillsRepo {
  searchSkills(userId: string, query?: SkillQuery): Promise<{ items: SkillRecord[]; total: number }>;
  /** By id or by slug — callers address skills the way a person names them. */
  getSkill(userId: string, reference: string): Promise<SkillRecord | null>;
  createSkill(userId: string, input: CreateSkillInput): Promise<SkillRecord>;
  updateSkill(userId: string, id: string, patch: UpdateSkillPatch): Promise<SkillRecord | null>;
  deleteSkill(userId: string, id: string): Promise<boolean>;
  /** Previous versions, newest first. */
  listRevisions(userId: string, id: string, limit?: number): Promise<SkillRevisionRecord[]>;
  countSkills(userId: string): Promise<number>;
}

export interface SkillRevisionRecord {
  id: string;
  name: string;
  whenToUse: string;
  body: string;
  source: SkillSource;
  createdAt: Date;
}

type Db = typeof Database;

/** Kept per skill; older versions fall off. Enough to undo a bad edit or two
 *  without turning a text column into an unbounded log. */
const MAX_REVISIONS_PER_SKILL = 20;

/**
 * Walks the cause chain rather than reading `error.code` directly.
 *
 * Drizzle wraps driver errors in its own `Failed query: …` error, so the pg
 * SQLSTATE lives on `cause`, not on the error it throws. A check that only
 * looks at the top level never matches, and a duplicate slug surfaces as a 500
 * instead of the 409 the dashboard knows how to show.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current !== null && current !== undefined; ) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = typeof current === "object" && "cause" in current ? current.cause : null;
  }
  return false;
}

/** Everything but `search_vector`, which is large and never read. */
const skillColumns = {
  id: skills.id,
  userId: skills.userId,
  slug: skills.slug,
  name: skills.name,
  whenToUse: skills.whenToUse,
  body: skills.body,
  status: skills.status,
  source: skills.source,
  sourceRef: skills.sourceRef,
  createdAt: skills.createdAt,
  updatedAt: skills.updatedAt,
};

export function createSkillsRepo(db: Db): SkillsRepo {
  const owned = (userId: string, id: string): SQL => and(eq(skills.id, id), eq(skills.userId, userId))!;

  /**
   * The filter half of a search, shared by the page query and its count.
   *
   * Two matchers for the same reason notes use two: the vector finds whole
   * words and is index-backed, while the substring match catches the partial
   * name someone half-remembers — "fund scr" should still find `fund-screen`,
   * and no text-search parser will do that on its own.
   */
  function filters(userId: string, query: SkillQuery): SQL {
    const clauses: SQL[] = [eq(skills.userId, userId)];

    const status = query.status ?? "active";
    if (status !== "any") clauses.push(eq(skills.status, status));

    const text = query.q?.trim();
    if (text !== undefined && text !== "") {
      const like = `%${escapeLike(text)}%`;
      clauses.push(
        or(
          sql`${skills.searchVector} @@ websearch_to_tsquery('simple', ${text})`,
          sql`${skills.slug} ilike ${like}`,
          sql`${skills.name} ilike ${like}`,
          sql`${skills.whenToUse} ilike ${like}`,
          sql`${skills.body} ilike ${like}`,
        )!,
      );
    }

    return and(...clauses)!;
  }

  /**
   * Relevance: the vector's rank plus a bump for a substring hit on the name or
   * slug. The bump matters because the substring branch scores zero from
   * `ts_rank_cd` — without it an exact-name near-miss sorts below every
   * incidental body mention, which is the one result order that must not happen.
   */
  function relevance(text: string): SQL<number> {
    const like = `%${escapeLike(text)}%`;
    return sql<number>`(
      ts_rank_cd(${skills.searchVector}, websearch_to_tsquery('simple', ${text}))
      + case when ${skills.slug} ilike ${like} then 1.0 else 0 end
      + case when ${skills.name} ilike ${like} then 0.5 else 0 end
      + case when ${skills.whenToUse} ilike ${like} then 0.25 else 0 end
    )`.mapWith(Number);
  }

  function ordering(query: SkillQuery, hasText: boolean): SQL[] {
    switch (query.sort ?? (hasText ? "relevance" : "updated")) {
      case "relevance":
        return hasText
          ? [desc(relevance(query.q!.trim())), desc(skills.updatedAt)]
          : [desc(skills.updatedAt)];
      case "created":
        return [desc(skills.createdAt)];
      case "name":
        return [asc(sql`lower(${skills.name})`)];
      default:
        return [desc(skills.updatedAt)];
    }
  }

  async function loadOne(userId: string, id: string): Promise<SkillRecord | null> {
    const [row] = await db.select(skillColumns).from(skills).where(owned(userId, id)).limit(1);
    return row ?? null;
  }

  /** Snapshots the row about to be overwritten, then trims the tail. */
  async function snapshot(row: SkillRecord): Promise<void> {
    await db.insert(skillRevisions).values({
      skillId: row.id,
      name: row.name,
      whenToUse: row.whenToUse,
      body: row.body,
      source: row.source,
    });
    await db.execute(sql`
      delete from ${skillRevisions}
      where ${skillRevisions.skillId} = ${row.id}
        and ${skillRevisions.id} not in (
          select id from ${skillRevisions}
          where ${skillRevisions.skillId} = ${row.id}
          order by ${skillRevisions.createdAt} desc
          limit ${MAX_REVISIONS_PER_SKILL}
        )
    `);
  }

  return {
    async countSkills(userId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(skills)
        .where(eq(skills.userId, userId));
      return row?.n ?? 0;
    },

    async searchSkills(userId, query = {}) {
      const where = filters(userId, query);
      const text = query.q?.trim() ?? "";
      const hasText = text !== "";

      const [totalRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(skills)
        .where(where);

      const limit = Math.min(query.limit ?? MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
      const items = await db
        .select(hasText ? { ...skillColumns, score: relevance(text) } : skillColumns)
        .from(skills)
        .where(where)
        .orderBy(...ordering(query, hasText))
        .limit(limit)
        .offset(query.offset ?? 0);

      return { items, total: totalRow?.n ?? 0 };
    },

    async getSkill(userId, reference) {
      const needle = reference.trim();
      const [row] = await db
        .select(skillColumns)
        .from(skills)
        .where(
          and(
            eq(skills.userId, userId),
            or(eq(skills.id, needle), eq(skills.slug, needle.toLowerCase()))!,
          )!,
        )
        .limit(1);
      return row ?? null;
    },

    async createSkill(userId, input) {
      const [countRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(skills)
        .where(eq(skills.userId, userId));
      if ((countRow?.n ?? 0) >= MAX_SKILLS_PER_USER) {
        throw new SkillLimitError(
          `You already have ${MAX_SKILLS_PER_USER} skills. Delete or archive some before adding more.`,
        );
      }

      try {
        const [row] = await db
          .insert(skills)
          .values({
            userId,
            slug: input.slug,
            name: input.name,
            whenToUse: input.whenToUse,
            body: input.body ?? "",
            status: input.status ?? "active",
            source: input.source,
            sourceRef: input.sourceRef ?? null,
          })
          .returning(skillColumns);
        return row!;
      } catch (error) {
        if (isUniqueViolation(error)) throw new SkillSlugTakenError(input.slug);
        throw error;
      }
    },

    async updateSkill(userId, id, patch) {
      const existing = await loadOne(userId, id);
      if (existing === null) return null;

      // Only content changes are worth a revision; flipping a draft to active
      // or archiving one does not lose anything recoverable.
      const changesContent =
        (patch.name !== undefined && patch.name !== existing.name) ||
        (patch.whenToUse !== undefined && patch.whenToUse !== existing.whenToUse) ||
        (patch.body !== undefined && patch.body !== existing.body);
      if (changesContent) await snapshot(existing);

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.slug !== undefined) values["slug"] = patch.slug;
      if (patch.name !== undefined) values["name"] = patch.name;
      if (patch.whenToUse !== undefined) values["whenToUse"] = patch.whenToUse;
      if (patch.body !== undefined) values["body"] = patch.body;
      if (patch.status !== undefined) values["status"] = patch.status;
      if (patch.sourceRef !== undefined) values["sourceRef"] = patch.sourceRef;

      try {
        const [row] = await db
          .update(skills)
          .set(values)
          .where(owned(userId, id))
          .returning(skillColumns);
        return row ?? null;
      } catch (error) {
        if (isUniqueViolation(error) && patch.slug !== undefined) {
          throw new SkillSlugTakenError(patch.slug);
        }
        throw error;
      }
    },

    async deleteSkill(userId, id) {
      const rows = await db.delete(skills).where(owned(userId, id)).returning({ id: skills.id });
      return rows.length > 0;
    },

    async listRevisions(userId, id, limit = MAX_REVISIONS_PER_SKILL) {
      const skill = await loadOne(userId, id);
      if (skill === null) return [];
      return db
        .select({
          id: skillRevisions.id,
          name: skillRevisions.name,
          whenToUse: skillRevisions.whenToUse,
          body: skillRevisions.body,
          source: skillRevisions.source,
          createdAt: skillRevisions.createdAt,
        })
        .from(skillRevisions)
        .where(eq(skillRevisions.skillId, id))
        .orderBy(desc(skillRevisions.createdAt))
        .limit(limit);
    },
  };
}

/**
 * Defers the database import until a tool actually calls, so building an MCP
 * server — as the unit tests do — never requires a configured database.
 */
export function createLazySkillsRepo(): SkillsRepo {
  let cached: Promise<SkillsRepo> | undefined;

  const load = (): Promise<SkillsRepo> => {
    cached ??= import("../db/index.js").then((module) => createSkillsRepo(module.db));
    return cached;
  };

  return new Proxy({} as SkillsRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof SkillsRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });
}
