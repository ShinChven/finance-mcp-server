import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import type { SkillsRepo } from "../../skills/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { requireSkillsUser, skillDetail, skillRefSchema, suggestSkills } from "./skill-runtime.js";

/**
 * The whole procedure, for one skill.
 *
 * Takes a slug directly rather than an id from a prior search, so the common
 * case — the user names the skill — costs one round trip instead of two. The
 * unique index on `(user_id, slug)` is what makes that a single lookup.
 *
 * A miss returns the names that do exist rather than an error, because the
 * model reached this call by guessing at a name and the useful reply is the
 * correction, not the rejection.
 */
export function registerSkillReadTool(
  server: McpServer,
  repo: SkillsRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "skillRead",
    {
      title: "Read a Skill",
      description:
        "Load one of the user's skills in full — the procedure they wrote for this task. " +
        "Pass the name the user used and nothing else. " +
        "Follow the steps it gives you. If the name does not match, this returns the names that do, " +
        "so read those and try once more rather than guessing at the procedure. " +
        "Drafts are not readable until the user publishes them in the dashboard.",
      inputSchema: { skill: skillRefSchema },
      annotations: readOnlyToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireSkillsUser(auth);
        const skill = await repo.getSkill(userId, args.skill);

        // An archived or draft skill is treated as absent rather than refused:
        // the caller's next move is the same either way, and naming a draft
        // back would leak text the user has not approved for use.
        if (skill === null || skill.status !== "active") {
          return suggestSkills(repo, userId, args.skill);
        }

        return { found: true, skill: skillDetail(skill) };
      }),
  );
}
