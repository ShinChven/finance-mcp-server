import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import type { SkillsRepo } from "../../skills/repo.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { requireSkillsUser, skillHeader, skillRefSchema, suggestSkills } from "./skill-runtime.js";

/**
 * Restoring a skill the user already approved once.
 *
 * Deliberately not a general publish. `shared/skills.ts` explains why the draft
 * gate exists: a skill is a standing instruction, so an injected conversation
 * that could both write one and switch it on would install a procedure every
 * future session obeys. That attack needs *activation of text nobody reviewed*,
 * which is exactly what `published_at` distinguishes.
 *
 * So the rule is: this tool can put back what a person once put in service, and
 * can do nothing else. A never-published draft is refused and stays a dashboard
 * decision. The gate is unchanged for anything new; only the undo is automated.
 *
 * A skill sitting in `draft` with a `published_at` — someone moved it back on
 * the dashboard — is refused too. That move is a person withdrawing their own
 * review, and an agent must not reverse it.
 */
export function registerSkillPublishTool(
  server: McpServer,
  repo: SkillsRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "skillPublish",
    {
      title: "Restore a Withdrawn Skill",
      description:
        "Put a skill the user previously withdrew back into service, when they say to turn it back " +
        "on, re-enable it, or start using it again. Only works on skills that were published once " +
        "before: a draft — including anything you saved with `skillSave` in this conversation — " +
        "cannot be published from here and needs the user to review it on the Skills page. " +
        "Do not call this to work around that; tell the user to publish it themselves.",
      inputSchema: { skill: skillRefSchema },
      annotations: writeToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireSkillsUser(auth);
        const skill = await repo.getSkill(userId, args.skill);

        if (skill === null) return suggestSkills(repo, userId, args.skill, "archived");

        if (skill.status === "active") {
          return {
            changed: false,
            skill: skillHeader(skill),
            status: skill.status,
            message: `"${skill.slug}" is already in service. Nothing changed.`,
          };
        }

        // The gate. Never published means never reviewed, and reviewing is the
        // one step a conversation is not allowed to perform for the user.
        if (skill.publishedAt === null) {
          return {
            changed: false,
            skill: skillHeader(skill),
            status: skill.status,
            message:
              `"${skill.slug}" has never been published, so it cannot be turned on from here. ` +
              "A skill is a standing instruction for every future session, so a person has to read " +
              "it first. Tell the user to open the Skills page and publish it — then it can be " +
              "withdrawn and restored from a conversation.",
          };
        }

        if (skill.status === "draft") {
          return {
            changed: false,
            skill: skillHeader(skill),
            status: skill.status,
            message:
              `"${skill.slug}" was moved back to draft on the dashboard, which means the user took ` +
              "it back for review. Restoring it is theirs to do, not yours.",
          };
        }

        const updated = await repo.updateSkill(userId, skill.id, { status: "active" });
        if (updated === null) throw new Error("The skill vanished while being restored.");

        await audit({
          actorUserId: userId,
          action: "skill.publish",
          targetType: "skill",
          targetId: updated.id,
          meta: { slug: updated.slug, source: updated.source, via: "mcp", client: auth?.label },
        });

        return {
          changed: true,
          skill: skillHeader(updated),
          status: updated.status,
          message: `"${updated.slug}" is back in service and will be followed again from now on.`,
        };
      }),
  );
}
