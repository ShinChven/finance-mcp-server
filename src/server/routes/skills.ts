/**
 * The skills dashboard API.
 *
 * Every route is scoped to the signed-in user and every repo call takes that
 * user id, so an id guessed from another account resolves to nothing.
 *
 * Query parameter names match the SPA's URL search params 1:1 — `q`, `page`,
 * `per_page`, `sort`, `status` — the project rule that lets a shared link
 * reproduce a page exactly.
 *
 * Publishing is audited, and so is deleting. Those are the two actions with
 * consequences outside the dashboard: publishing puts a standing instruction in
 * front of every future agent session, and deleting is the one edit no revision
 * can undo. Ordinary saves are not audited — that would bury the log under
 * routine writing.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  createSkillSchema,
  SKILL_SORTS,
  SKILL_STATUSES,
  updateSkillSchema,
} from "../../shared/skills.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { listResponse } from "../lib/listing.js";
import { requireAuth } from "../middleware/session.js";
import {
  createLazySkillsRepo,
  SkillLimitError,
  SkillSlugTakenError,
  type SkillRecord,
} from "../skills/repo.js";

const repo = createLazySkillsRepo();

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(SKILL_SORTS).optional(),
  status: z.enum([...SKILL_STATUSES, "any"]).optional(),
});

/** Maps the repo's typed failures onto the status codes the SPA expects. */
function errorStatus(error: unknown): 409 | null {
  if (error instanceof SkillSlugTakenError) return 409;
  if (error instanceof SkillLimitError) return 409;
  return null;
}

/**
 * The listing shape: everything but the body.
 *
 * The page renders a row per skill and the editor fetches the one that is
 * actually open — the same split the MCP tools make, for the same reason.
 */
function toCard(skill: SkillRecord) {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    whenToUse: skill.whenToUse,
    status: skill.status,
    source: skill.source,
    autoDiscover: skill.autoDiscover,
    bodyChars: skill.body.length,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function toDetail(skill: SkillRecord) {
  return { ...toCard(skill), body: skill.body, sourceRef: skill.sourceRef };
}

export const skillRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", listQuerySchema), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");

    const { items, total } = await repo.searchSkills(user.id, {
      ...(query.q !== undefined && { q: query.q }),
      // The dashboard defaults to every status: a draft waiting for review is
      // the thing the user most needs to see, and hiding it here would make the
      // publish gate feel like a bug.
      status: query.status ?? "any",
      ...(query.sort !== undefined && { sort: query.sort }),
      limit: query.per_page,
      offset: (query.page - 1) * query.per_page,
    });

    return c.json(listResponse(items.map(toCard), total, query));
  })

  .post("/", zValidator("json", createSkillSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    try {
      const skill = await repo.createSkill(user.id, {
        slug: body.slug,
        name: body.name,
        whenToUse: body.whenToUse,
        body: body.body ?? "",
        ...(body.status !== undefined && { status: body.status }),
        ...(body.autoDiscover !== undefined && { autoDiscover: body.autoDiscover }),
        source: "web",
        sourceRef: body.sourceRef ?? null,
      });
      return c.json(toDetail(skill), 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .get("/:id", async (c) => {
    const skill = await repo.getSkill(c.get("user").id, c.req.param("id"));
    if (skill === null) return c.json({ error: "skill not found" }, 404);
    return c.json(toDetail(skill));
  })

  .get("/:id/revisions", async (c) => {
    const items = await repo.listRevisions(c.get("user").id, c.req.param("id"));
    return c.json({ items });
  })

  .patch("/:id", zValidator("json", updateSkillSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    try {
      const before = await repo.getSkill(user.id, id);
      if (before === null) return c.json({ error: "skill not found" }, 404);

      const skill = await repo.updateSkill(user.id, before.id, {
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.whenToUse !== undefined && { whenToUse: body.whenToUse }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.autoDiscover !== undefined && { autoDiscover: body.autoDiscover }),
        ...(body.sourceRef !== undefined && { sourceRef: body.sourceRef }),
      });
      if (skill === null) return c.json({ error: "skill not found" }, 404);

      // Publishing an agent-written draft is the moment a conversation's output
      // becomes something every future session is told to follow. That is worth
      // a row in the log; the edits leading up to it are not.
      if (before.status === "draft" && skill.status === "active") {
        await audit({
          actorUserId: user.id,
          action: "skill.publish",
          targetType: "skill",
          targetId: skill.id,
          meta: { slug: skill.slug, source: skill.source },
          ip: clientIp(c),
        });
      }

      return c.json(toDetail(skill));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const deleted = await repo.deleteSkill(user.id, id);
    if (!deleted) return c.json({ error: "skill not found" }, 404);
    await audit({
      actorUserId: user.id,
      action: "skill.delete",
      targetType: "skill",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });
