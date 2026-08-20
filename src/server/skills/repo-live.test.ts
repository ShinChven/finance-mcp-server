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
 * the revision trim, which is raw SQL with a correlated subquery.
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

          // Deletes are scoped, and take the revisions with them.
          expect(await repo.deleteSkill(stranger!.id, screen.id)).toBe(false);
          expect(await repo.deleteSkill(userId, screen.id)).toBe(true);
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
