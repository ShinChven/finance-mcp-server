import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  MAX_SKILL_BODY_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAX_WHEN_TO_USE_LENGTH,
  isValidSlug,
  normalizeSlug,
} from "../../../shared/skills.js";
import { SkillLimitError, SkillSlugTakenError, type SkillsRepo } from "../../skills/repo.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { requireSkillsUser, skillDetail, skillSlugArg } from "./skill-runtime.js";

/**
 * Writing a skill from a conversation.
 *
 * Everything written here lands as a **draft** and stays invisible to
 * `skills` and `skillRead` until the user publishes it in the dashboard. That
 * gate is the point of the tool, not a limitation of it: a skill is a standing
 * instruction the agent is told to obey in every future session, so a
 * conversation that has been talked into writing one must not also be able to
 * put it into service. A note that turns out wrong is a wrong fact; a skill
 * that turns out wrong is a hijacked procedure.
 *
 * For the same reason an agent may only revise its own drafts. A published
 * skill is edited by the person who published it.
 */
export function registerSkillSaveTool(
  server: McpServer,
  repo: SkillsRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "skillSave",
    {
      title: "Draft a Skill",
      description:
        "Save a procedure as a draft skill, so the user can reuse it later by name. " +
        "Use it when the user says to remember how something was done, or when a workflow you just " +
        "worked out with them is worth repeating. " +
        "Drafts are not callable: the user reviews and publishes them in the dashboard, and this " +
        "tool cannot edit a skill that is already published. Say so when you save one. " +
        "Write `whenToUse` as the sentence that should make a future agent reach for this — it " +
        "is the line a listing shows, and search weights it above the body.",
      inputSchema: {
        slug: skillSlugArg,
        name: z
          .string()
          .trim()
          .min(1)
          .max(MAX_SKILL_NAME_LENGTH)
          .describe('Readable title for the dashboard ("Fund screening workflow").'),
        whenToUse: z
          .string()
          .trim()
          .min(1)
          .max(MAX_WHEN_TO_USE_LENGTH)
          .describe(
            "One or two sentences naming the situation this applies to. Concrete beats broad: " +
              '"screening China funds for exposure to a single stock" finds itself later, ' +
              '"helps with funds" does not.',
          ),
        body: z
          .string()
          .max(MAX_SKILL_BODY_LENGTH)
          .describe("The procedure itself, in Markdown. Steps, rules, the output shape expected."),
        sourceRef: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("Where this came from — a conversation id or client name."),
      },
      annotations: writeToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireSkillsUser(auth);

        const slug = normalizeSlug(args.slug);
        if (!isValidSlug(slug)) {
          throw new Error(
            `"${args.slug}" is not a usable name. Use lowercase letters, digits and hyphens, ` +
              'for example "fund-screen".',
          );
        }

        const existing = await repo.getSkill(userId, slug);

        if (existing !== null && existing.status !== "draft") {
          throw new Error(
            `"${slug}" is already a published skill and cannot be changed from here. ` +
              "Ask the user to edit it on the dashboard, or pick a different name.",
          );
        }

        try {
          const saved =
            existing === null
              ? await repo.createSkill(userId, {
                  slug,
                  name: args.name,
                  whenToUse: args.whenToUse,
                  body: args.body,
                  status: "draft",
                  source: "agent",
                  sourceRef: args.sourceRef ?? null,
                })
              : await repo.updateSkill(userId, existing.id, {
                  name: args.name,
                  whenToUse: args.whenToUse,
                  body: args.body,
                  ...(args.sourceRef !== undefined && { sourceRef: args.sourceRef }),
                });

          if (saved === null) throw new Error("The skill vanished while being saved.");

          return {
            saved: skillDetail(saved),
            created: existing === null,
            note:
              "Saved as a draft. Tell the user it is waiting for them on the Skills page — it " +
              "cannot be called until they publish it.",
          };
        } catch (error) {
          if (error instanceof SkillSlugTakenError || error instanceof SkillLimitError) {
            throw new Error(error.message);
          }
          throw error;
        }
      }),
  );
}
