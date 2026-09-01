import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import type { SkillsRepo } from "../../skills/repo.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { requireSkillsUser, skillHeader, skillRefSchema, suggestSkills } from "./skill-runtime.js";

/**
 * Taking a skill out of service.
 *
 * This is the safe half of the pair. Withdrawing only removes capability, so it
 * needs no gate: the worst an injected conversation achieves is switching off a
 * procedure the user can switch back on, and the audit row says who did it.
 * Publishing is the direction that grants standing instructions, and it is
 * fenced separately in `skill-publish.ts`.
 *
 * It lands on `archived`, never `draft`. `shared/skills.ts` defines archived as
 * "keeps a skill the user built without keeping it callable", while draft means
 * *never reviewed* — a state a conversation must not be able to manufacture,
 * since the whole publish gate is built on trusting it.
 */
export function registerSkillUnpublishTool(
  server: McpServer,
  repo: SkillsRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "skillUnpublish",
    {
      title: "Withdraw a Skill",
      description:
        "Take one of the user's skills out of service, when they say to stop using it, turn it off, " +
        "or that it is wrong. The skill is archived, not deleted: it keeps its text and its history, " +
        "stops being found by `skills` and readable by `skillRead`, and can be restored later with " +
        "`skillPublish`. Use this rather than editing a skill into a no-op. " +
        "Only the user decides a skill should stop running — never withdraw one on your own judgement.",
      inputSchema: { skill: skillRefSchema },
      annotations: writeToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireSkillsUser(auth);
        const skill = await repo.getSkill(userId, args.skill);

        if (skill === null) return suggestSkills(repo, userId, args.skill);

        // Already off. Reported rather than thrown, because the user's intent is
        // satisfied either way and an error would invite a pointless retry.
        if (skill.status !== "active") {
          return {
            changed: false,
            skill: skillHeader(skill),
            status: skill.status,
            message:
              skill.status === "archived"
                ? `"${skill.slug}" is already withdrawn. Nothing changed.`
                : `"${skill.slug}" is still a draft and was never in service. Nothing changed.`,
          };
        }

        const updated = await repo.updateSkill(userId, skill.id, { status: "archived" });
        if (updated === null) throw new Error("The skill vanished while being withdrawn.");

        await audit({
          actorUserId: userId,
          action: "skill.unpublish",
          targetType: "skill",
          targetId: updated.id,
          meta: { slug: updated.slug, source: updated.source, via: "mcp", client: auth?.label },
        });

        return {
          changed: true,
          skill: skillHeader(updated),
          status: updated.status,
          message:
            `"${updated.slug}" is withdrawn and will not be used again until it is restored. ` +
            "Tell the user it is archived, not deleted, and that `skillPublish` puts it back.",
        };
      }),
  );
}
