/**
 * Shared plumbing for the skill tools.
 *
 * Like the note and watchlist families, these read rows that belong to one
 * user, so each handler starts from the authenticated identity — never from a
 * user id in the arguments, which the model could otherwise be talked into
 * supplying.
 *
 * The shapes here are the other half of the design. A skill's body is the
 * expensive part and never appears in a listing: `skills` returns the slug and
 * the one-line `whenToUse`, and `skillRead` is the deliberate second call that
 * fetches the procedure. That split is what keeps a library of two hundred
 * skills free until the moment one is actually used.
 */

import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import { MAX_SUGGESTIONS, skillReferenceSchema } from "../../../shared/skills.js";
import type { SkillRecord, SkillsRepo } from "../../skills/repo.js";

export function requireSkillsUser(auth: McpAuth | null): string {
  if (auth === null) {
    throw new Error("Skill tools are only available on an authenticated MCP request.");
  }
  return auth.user.id;
}

export const skillRefSchema = skillReferenceSchema.describe(
  'The skill\'s name, exactly as the user said it ("fund-screen"), or its id.',
);

export const skillSlugArg = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe(
    'Short name, lowercase with hyphens ("fund-screen"). This is what the user types to call the ' +
      "skill, so pick what they would actually say.",
  );

/** What a listing returns: everything except the body. */
export function skillHeader(skill: SkillRecord) {
  return {
    slug: skill.slug,
    name: skill.name,
    whenToUse: skill.whenToUse,
    /** So a caller can tell a one-line reminder from a real procedure before
     *  deciding to spend the tokens reading it. */
    bodyChars: skill.body.length,
    updatedAt: skill.updatedAt.toISOString(),
  };
}

/** The full skill, as `skillRead` returns it. */
export function skillDetail(skill: SkillRecord) {
  return {
    ...skillHeader(skill),
    id: skill.id,
    body: skill.body,
    status: skill.status,
    source: skill.source,
  };
}

/**
 * What a failed lookup hands back.
 *
 * A miss must never be a bare error. With no index in context the model is
 * guessing at names, and "no such skill" invites it to guess again or, worse,
 * to invent the procedure. A short list of real names it can recognise turns a
 * wrong guess into one more cheap call.
 */
export async function suggestSkills(
  repo: SkillsRepo,
  userId: string,
  reference: string,
): Promise<{ found: false; message: string; closest: ReturnType<typeof skillHeader>[] }> {
  const byText = await repo.searchSkills(userId, {
    q: reference,
    status: "active",
    limit: MAX_SUGGESTIONS,
  });
  const closest =
    byText.items.length > 0
      ? byText.items
      : (await repo.searchSkills(userId, { status: "active", limit: MAX_SUGGESTIONS })).items;

  return {
    found: false,
    message:
      closest.length === 0
        ? "This user has no skills yet. Do the task the ordinary way."
        : `No skill named "${reference}". These exist — use one of these names, or proceed without a skill.`,
    closest: closest.map(skillHeader),
  };
}
