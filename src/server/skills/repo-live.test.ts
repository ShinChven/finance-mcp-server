import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import type { db as Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { createSkillsRepo, SkillSlugTakenError } from "./repo.js";

/**
 * Executes every skills query against a real Postgres.
 *
 * The gap this closes is the one `funds/repo-live.test.ts` documents: the tool
 * tests mock the repo away and the queries typecheck whatever they emit, so a
 * statement Postgres rejects at parse time passes the entire suite. Three
 * things here are only real against a server — the generated `search_vector`
 * and its weights, `websearch_to_tsquery` alongside the `ilike` fallback, and
 * the revision trim, which is raw SQL with a correlated subquery. The term
 * splitting the search now does is the same story one level up: the tokeniser
 * is unit-tested offline, but whether OR-joined terms and a per-term ranking
 * expression are valid SQL is only answerable here.
 *
 * Skipped unless `DATABASE_URL` is set, so the default suite stays offline.
 * Everything runs inside a transaction that is always rolled back, so pointing
 * it at a populated database is safe.
 */

const connectionString = process.env.DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(connectionString === undefined)("skills queries against Postgres", () => {
  it("runs every query and enforces the rules the tools rely on", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const repo = createSkillsRepo(tx as unknown as typeof Database);
          const { users, skillRevisions } = schema;

          const [owner] = await tx
            .insert(users)
            .values({ email: "skills-live@example.com", name: "Skills Live", role: "user" })
            .returning({ id: users.id });
          const [stranger] = await tx
            .insert(users)
            .values({ email: "skills-other@example.com", name: "Other", role: "user" })
            .returning({ id: users.id });
          const userId = owner!.id;

          const screen = await repo.createSkill(userId, {
            slug: "fund-screen",
            name: "Fund screening workflow",
            whenToUse: "screening China funds for exposure to a single stock",
            body: "1. Call fundsByStock.\n2. Filter by domicile.",
            source: "web",
          });
          await repo.createSkill(userId, {
            slug: "earnings-review",
            name: "Earnings review",
            whenToUse: "reading a quarterly report before deciding anything",
            body: "Start with the surprise history.",
            source: "web",
          });
          const draft = await repo.createSkill(userId, {
            slug: "agent-draft",
            name: "Written by an agent",
            whenToUse: "something the model proposed",
            body: "unreviewed",
            status: "draft",
            source: "agent",
          });

          // The unique index, which is what makes an exact-name read one hit.
          // Inside a nested transaction because a constraint violation aborts
          // the enclosing one in Postgres — the savepoint keeps the rest of
          // this test runnable.
          await expect(
            tx.transaction(async (inner) =>
              createSkillsRepo(inner as unknown as typeof Database).createSkill(userId, {
                slug: "fund-screen",
                name: "Duplicate",
                whenToUse: "clash",
                source: "web",
              }),
            ),
          ).rejects.toBeInstanceOf(SkillSlugTakenError);
          // ...and it is per user, not global.
          await expect(
            repo.createSkill(stranger!.id, {
              slug: "fund-screen",
              name: "Someone else's",
              whenToUse: "same name, different account",
              source: "web",
            }),
          ).resolves.toMatchObject({ slug: "fund-screen" });

          // Addressable by slug and by id; scoped to the owner either way.
          expect(await repo.getSkill(userId, "fund-screen")).toMatchObject({ id: screen.id });
          expect(await repo.getSkill(userId, screen.id)).toMatchObject({ slug: "fund-screen" });
          expect(await repo.getSkill(stranger!.id, screen.id)).toBeNull();

          // The default status filter hides drafts; "any" is what the dashboard asks for.
          const active = await repo.searchSkills(userId, {});
          expect(active.items.map((row) => row.slug).sort()).toEqual([
            "earnings-review",
            "fund-screen",
          ]);
          expect((await repo.searchSkills(userId, { status: "any" })).total).toBe(3);
          expect((await repo.searchSkills(userId, { status: "draft" })).items).toHaveLength(1);

          // Full text over the description, and the ilike fallback for a
          // partial word the tsquery parser will not match on its own.
          const byPhrase = await repo.searchSkills(userId, { q: "single stock" });
          expect(byPhrase.items.map((row) => row.slug)).toEqual(["fund-screen"]);
          const byPartial = await repo.searchSkills(userId, { q: "quarter" });
          expect(byPartial.items.map((row) => row.slug)).toEqual(["earnings-review"]);

          // Any term, not every term. The reported failure was a two-word
          // query returning nothing against a store that plainly held a match:
          // `websearch_to_tsquery` ANDs its words, so "quarterly funds" asked
          // for a skill about both and got neither of the two that exist.
          const anyTerm = await repo.searchSkills(userId, { q: "quarterly funds" });
          expect(anyTerm.items.map((row) => row.slug).sort()).toEqual([
            "earnings-review",
            "fund-screen",
          ]);

          // ...and a word no row carries no longer sinks the words that do.
          const partlyUnknown = await repo.searchSkills(userId, { q: "trending exposure" });
          expect(partlyUnknown.items.map((row) => row.slug)).toEqual(["fund-screen"]);
          expect((await repo.searchSkills(userId, { q: "trending" })).total).toBe(0);

          // Recall widened, but the ordering has to earn it. Both rows match
          // here — "report" is the earnings one, "china" and "stock" the fund
          // one — and the row carrying more of the query has to come first, or
          // the wider filter would just be noise at the top of the list.
          const ranked2 = await repo.searchSkills(userId, { q: "china stock report" });
          expect(ranked2.items.map((row) => row.slug).sort()).toEqual([
            "earnings-review",
            "fund-screen",
          ]);
          expect(ranked2.items[0]?.slug).toBe("fund-screen");

          // The `ilike` fallback is per term now. "fund scr" is not a
          // substring of "fund-screen" — the phrase spans the hyphen — so the
          // half-remembered name this branch exists for only worked on
          // single-word queries before.
          const halfRemembered = await repo.searchSkills(userId, { q: "fund scr" });
          expect(halfRemembered.items[0]?.slug).toBe("fund-screen");

          // A query that trims non-empty but tokenises to nothing must not
          // reach the ranking expression, which would have no operands.
          // Two, not three: no terms means no text filter, and the default
          // status filter still hides the draft.
          await expect(repo.searchSkills(userId, { q: "-" })).resolves.toMatchObject({ total: 2 });
          await expect(
            repo.searchSkills(userId, { q: "-", sort: "relevance" }),
          ).resolves.toMatchObject({ total: 2 });
          // A leading dash is a term, never a negation: this must not exclude
          // the row it names.
          expect((await repo.searchSkills(userId, { q: "-quarterly" })).items).toHaveLength(1);
          // Terms past the cap are dropped rather than refused.
          await expect(
            repo.searchSkills(userId, {
              q: Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "),
            }),
          ).resolves.toMatchObject({ total: 0 });

          // A name hit must outrank a body mention of the same word.
          await repo.updateSkill(userId, draft.id, { status: "active", body: "mentions earnings" });
          const ranked = await repo.searchSkills(userId, { q: "earnings" });
          expect(ranked.items[0]?.slug).toBe("earnings-review");
          await repo.updateSkill(userId, draft.id, { status: "draft", body: "unreviewed" });

          // Every sort ordering parses.
          for (const sort of ["relevance", "updated", "created", "name"] as const) {
            await repo.searchSkills(userId, { sort, q: "fund" });
            await repo.searchSkills(userId, { sort });
          }
          await repo.searchSkills(userId, { limit: 1, offset: 1 });
          expect(await repo.countSkills(userId)).toBe(3);

          // Content edits snapshot; a status flip does not.
          await repo.updateSkill(userId, screen.id, { body: "2. Second version." });
          await repo.updateSkill(userId, screen.id, { whenToUse: "third version" });
          await repo.updateSkill(userId, screen.id, { status: "archived" });
          const revisions = await repo.listRevisions(userId, screen.id);
          expect(revisions).toHaveLength(2);
          expect(revisions[0]!.whenToUse).toBe("screening China funds for exposure to a single stock");
          expect(await repo.listRevisions(stranger!.id, screen.id)).toEqual([]);

          // The raw-SQL trim keeps only the newest revisions per skill.
          for (let index = 0; index < 25; index += 1) {
            await repo.updateSkill(userId, screen.id, { body: `version ${index}` });
          }
          const trimmed = await tx
            .select({ id: skillRevisions.id })
            .from(skillRevisions)
            .where(eq(skillRevisions.skillId, screen.id));
          expect(trimmed.length).toBeLessThanOrEqual(20);

          // Every method addresses a skill the same way `getSkill` does.
          // Before this, `get` took a slug while `delete` and the revision
          // listing silently did not — an inconsistency that only surfaces in
          // someone else's integration.
          expect(await repo.listRevisions(userId, "fund-screen")).toHaveLength(
            (await repo.listRevisions(userId, screen.id)).length,
          );
          expect((await repo.listRevisions(userId, "fund-screen")).length).toBeGreaterThan(0);

          // A UUID satisfies the slug rule, so a slug may equal another row's
          // id. Both rows are the same user's, but resolution must still be
          // deterministic: the exact id wins.
          const impostor = await repo.createSkill(userId, {
            slug: screen.id,
            name: "Named after another skill's id",
            whenToUse: "a slug that looks like a uuid",
            source: "web",
          });
          expect(impostor.slug).toBe(screen.id);
          expect(await repo.getSkill(userId, screen.id)).toMatchObject({ id: screen.id });
          await repo.deleteSkill(userId, impostor.id);

          // The resource listing is unpaged: nothing may be dropped without the
          // client being able to tell.
          expect(await repo.listDiscoverable(userId)).toEqual([]);
          await repo.updateSkill(userId, "earnings-review", { autoDiscover: true });
          expect((await repo.listDiscoverable(userId)).map((row) => row.slug)).toEqual([
            "earnings-review",
          ]);

          // Deletes are scoped, and take the revisions with them.
          expect(await repo.deleteSkill(stranger!.id, screen.id)).toBe(false);
          expect(await repo.deleteSkill(userId, "fund-screen")).toBe(true);
          expect(
            await tx
              .select({ id: skillRevisions.id })
              .from(skillRevisions)
              .where(eq(skillRevisions.skillId, screen.id)),
          ).toEqual([]);

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  });
});
