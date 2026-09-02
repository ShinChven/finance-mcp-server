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
import { escapeLike, searchTerms } from "../lib/listing.js";
import { isUniqueViolation } from "../lib/pg-errors.js";
import {
  MAX_SEARCH_RESULTS,
  MAX_SKILLS_PER_USER,
  type SkillSort,
  type SkillSource,
  type SkillStatus,
} from "../../shared/skills.js";
import { skillsRepoWithEvents } from "../realtime/repo-events.js";

/** The stored vector is an implementation detail of search; nothing reads it. */
export type SkillRecord = Omit<Skill, "searchVector"> & {
  /** Full-text rank, present only on a search with a query. */
  score?: number;
};

export interface SkillQuery {
  q?: string;
  status?: SkillStatus | "any";
  /** Only skills advertised in `resources/list`. */
  listedOnly?: boolean;
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
  autoDiscover?: boolean;
  source: SkillSource;
  sourceRef?: string | null;
}

export interface UpdateSkillPatch {
  slug?: string;
  name?: string;
  whenToUse?: string;
  body?: string;
  status?: SkillStatus;
  autoDiscover?: boolean;
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
  /** Addressed the same way `getSkill` is: by id or by slug. */
  updateSkill(userId: string, reference: string, patch: UpdateSkillPatch): Promise<SkillRecord | null>;
  deleteSkill(userId: string, reference: string): Promise<boolean>;
  /** Previous versions, newest first. Addressed by id or slug. */
  listRevisions(userId: string, reference: string, limit?: number): Promise<SkillRevisionRecord[]>;
  /** Every skill the user opted into `resources/list`, unpaged. */
  listDiscoverable(userId: string): Promise<SkillRecord[]>;
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
  autoDiscover: skills.autoDiscover,
  createdAt: skills.createdAt,
  updatedAt: skills.updatedAt,
};

export function createSkillsRepo(db: Db): SkillsRepo {
  const owned = (userId: string, id: string): SQL => and(eq(skills.id, id), eq(skills.userId, userId))!;

  /**
   * A skill addressed the way a caller has it: an id, or the slug the user
   * types. Every public method accepts both, because accepting a slug on `get`
   * and rejecting it on `delete` is the kind of inconsistency that only shows
   * up in someone else's integration.
   */
  const ownedRef = (userId: string, reference: string): SQL =>
    and(
      eq(skills.userId, userId),
      or(eq(skills.id, reference), eq(skills.slug, reference.toLowerCase()))!,
    )!;

  /**
   * Ties are broken toward an exact id match.
   *
   * A UUID satisfies the slug rule, so nothing stops one skill's slug from
   * being another skill's id. Both rows belong to the same user so this is not
   * a leak, but without an explicit order the winner would be whichever row
   * Postgres reached first.
   */
  const idFirst = (reference: string): SQL<number> =>
    sql<number>`case when ${skills.id} = ${reference} then 0 else 1 end`;

  async function resolveId(userId: string, reference: string): Promise<string | null> {
    const needle = reference.trim();
    if (needle === "") return null;
    const [row] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(ownedRef(userId, needle))
      .orderBy(asc(idFirst(needle)))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * The filter half of a search, shared by the page query and its count.
   *
   * Any term, not every term. `websearch_to_tsquery` ANDs the words it is
   * given and `ilike` matches the phrase literally, so the old shape made
   * "trending market" harder to satisfy than either word alone — and returned
   * nothing at all against a store holding one skill that is plainly about
   * markets. A recall miss here is the expensive direction: the caller reads an
   * empty array as "no such procedure exists" and proceeds without it, which
   * costs the whole workflow. An extra row costs one line of a listing.
   *
   * Precision is not abandoned, it is moved to `relevance`, which still sorts
   * an all-terms hit and a name match above an incidental one.
   *
   * Two matchers for the same reason notes use two: the vector finds whole
   * words and is index-backed, while the substring match catches the partial
   * name someone half-remembers. That one only works per term — `fund-screen`
   * is not `ilike '%fund scr%'`, because the phrase spans the hyphen.
   */
  function filters(userId: string, query: SkillQuery): SQL {
    const clauses: SQL[] = [eq(skills.userId, userId)];

    const status = query.status ?? "active";
    if (status !== "any") clauses.push(eq(skills.status, status));
    if (query.listedOnly === true) clauses.push(eq(skills.autoDiscover, true));

    const terms = searchTerms(query.q ?? "");
    if (terms.length > 0) {
      const branches: SQL[] = [sql`${skills.searchVector} @@ ${anyTerm(terms)}`];
      for (const term of terms) {
        const like = `%${escapeLike(term)}%`;
        branches.push(
          sql`${skills.slug} ilike ${like}`,
          sql`${skills.name} ilike ${like}`,
          sql`${skills.whenToUse} ilike ${like}`,
          sql`${skills.body} ilike ${like}`,
        );
      }
      // A whole-phrase branch would be redundant: anything matching the phrase
      // matches every term in it, so this `or` already covers it. The phrase
      // earns its keep in the ranking instead.
      clauses.push(or(...branches)!);
    }

    return and(...clauses)!;
  }

  /**
   * Every term as one `websearch_to_tsquery` OR-clause.
   *
   * Terms are joined rather than parameterised one by one so the whole query is
   * a single index-backed operand. Each term is whitespace-free and stripped of
   * a leading `-` by `searchTerms`, which is what makes `OR` between them mean
   * what it says; `websearch_to_tsquery` never raises on the rest, by design.
   */
  function anyTerm(terms: string[]): SQL {
    return sql`websearch_to_tsquery('simple', ${terms.join(" OR ")})`;
  }

  /**
   * Relevance: the vector's rank plus bumps for the matches `ts_rank_cd` scores
   * at zero. Without them an exact-name near-miss sorts below every incidental
   * body mention, which is the one result order that must not happen.
   *
   * Now that the filter admits any term, this also carries the precision the
   * filter gave up — an all-terms hit and a whole-phrase hit both outrank a
   * row that matched on one common word. Per-term bumps are divided by the term
   * count so a single-word query scores exactly as it did before, and so a long
   * query cannot outscore a short precise one on volume alone.
   */
  function relevance(text: string): SQL<number> {
    const terms = searchTerms(text);
    const phrase = `%${escapeLike(text)}%`;
    const share = terms.length || 1;

    // Weights are rendered into the statement rather than bound: a parameter
    // in `case when ... then $1 else 0 end` takes its type from the `else`
    // branch, so Postgres reads the placeholder as an integer and rejects 0.5
    // outright. The values are arithmetic over constants, never user input.
    const weight = (value: number): SQL => sql.raw(value.toFixed(6));

    const perTerm = terms.map((term) => {
      const like = `%${escapeLike(term)}%`;
      return sql`(
        case when ${skills.slug} ilike ${like} then ${weight(1.0 / share)} else 0 end
        + case when ${skills.name} ilike ${like} then ${weight(0.5 / share)} else 0 end
        + case when ${skills.whenToUse} ilike ${like} then ${weight(0.25 / share)} else 0 end
      )`;
    });

    return sql<number>`(
      ts_rank_cd(${skills.searchVector}, ${anyTerm(terms)})
      + case when ${skills.searchVector} @@ websearch_to_tsquery('simple', ${text}) then 0.5 else 0 end
      + case when ${skills.slug} ilike ${phrase} then 1.0 else 0 end
      + case when ${skills.name} ilike ${phrase} then 0.5 else 0 end
      + case when ${skills.whenToUse} ilike ${phrase} then 0.25 else 0 end
      + ${sql.join(perTerm, sql` + `)}
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
      // Derived from the terms, not from the raw string: a query of only
      // punctuation trims non-empty but tokenises to nothing, and ranking a
      // search that filtered on nothing would build a scoring expression with
      // no operands in it.
      const hasText = searchTerms(text).length > 0;

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
      if (needle === "") return null;
      const [row] = await db
        .select(skillColumns)
        .from(skills)
        .where(ownedRef(userId, needle))
        .orderBy(asc(idFirst(needle)))
        .limit(1);
      return row ?? null;
    },

    /**
     * Unpaged on purpose.
     *
     * `searchSkills` clamps to a page size, which silently dropped everything
     * past the first 25 out of the resource listing — a client cannot tell a
     * truncated enumeration from a complete one. The per-user cap already
     * bounds this, so the honest listing is all of them.
     */
    async listDiscoverable(userId) {
      return db
        .select(skillColumns)
        .from(skills)
        .where(
          and(
            eq(skills.userId, userId),
            eq(skills.status, "active"),
            eq(skills.autoDiscover, true),
          )!,
        )
        .orderBy(asc(skills.slug))
        .limit(MAX_SKILLS_PER_USER);
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
            autoDiscover: input.autoDiscover ?? false,
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

    async updateSkill(userId, reference, patch) {
      const id = await resolveId(userId, reference);
      if (id === null) return null;
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
      if (patch.autoDiscover !== undefined) values["autoDiscover"] = patch.autoDiscover;
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

    async deleteSkill(userId, reference) {
      const id = await resolveId(userId, reference);
      if (id === null) return false;
      const rows = await db.delete(skills).where(owned(userId, id)).returning({ id: skills.id });
      return rows.length > 0;
    },

    async listRevisions(userId, reference, limit = MAX_REVISIONS_PER_SKILL) {
      const id = await resolveId(userId, reference);
      if (id === null) return [];
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

  const lazy = new Proxy({} as SkillsRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof SkillsRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });

  // Wrapped here rather than at each call site so both the dashboard API and
  // the MCP tools -- the two callers of this factory -- publish change events
  // without either of them having to remember to.
  return skillsRepoWithEvents(lazy);
}
