/**
 * Skills vocabulary shared by the server, the MCP tools and the SPA.
 *
 * A skill is a procedure the user wrote once so an agent performs a task the
 * same way every time. Notes are what the user *knows*; skills are what the
 * user wants *done*. That difference is why this is a separate table rather
 * than a flag on `notes`: a skill is addressed by a stable name, and its
 * description is not a summary for a human but the text a search matches on.
 *
 * Pure by construction — no drizzle, no config — so the web bundle, the tools
 * and the tests import the same rules. Same arrangement as `shared/notes.ts`.
 */

import { z } from "zod";

/**
 * `draft` is the safety boundary.
 *
 * A skill is a standing instruction an agent is told to follow, which makes it
 * a different risk from a note: a wrong note is a wrong fact, a wrong skill is
 * a hijacked procedure that runs in every future session. Anything written
 * over MCP lands here and is invisible to lookup until a person publishes it in
 * the dashboard, so an injected conversation cannot install one silently.
 *
 * `archived` keeps a skill the user built without keeping it callable. Unlike a
 * draft it has been reviewed, which is why `skillUnpublish` may archive a skill
 * over MCP and `skillPublish` may bring an archived one back: neither direction
 * activates text a person never read. `skills.published_at` is what tells the
 * two apart, and nothing an agent can call ever sets it.
 */
export const SKILL_STATUSES = ["draft", "active", "archived"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/** Who wrote the row — the first question anyone asks of a skill they do not
 *  recognise, and the reason the draft gate can be enforced at all. */
export const SKILL_SOURCES = ["agent", "web"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export const STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/** Caps exist so one account — or one runaway agent loop — cannot grow the
 *  table without bound. */
export const MAX_SKILLS_PER_USER = 200;
/**
 * Deliberately a third of a note's body cap. A skill is a procedure, not a
 * captured transcript: if it needs more than this it is two skills, and one
 * `skillRead` should never cost fifteen thousand tokens of context.
 */
export const MAX_SKILL_BODY_LENGTH = 20_000;
/** Matches the Agent Skills frontmatter cap on `description`, which is what a
 *  row's `whenToUse` becomes when it is served as a `skill://` resource. */
export const MAX_WHEN_TO_USE_LENGTH = 1_024;
export const MAX_SKILL_NAME_LENGTH = 120;
/** The Agent Skills `name` rule; also what keeps a slug quotable in chat. */
export const MAX_SLUG_LENGTH = 64;

export const MAX_SEARCH_RESULTS = 25;
export const DEFAULT_SEARCH_RESULTS = 10;
/** How many names a failed lookup offers back. Enough to recognise the one you
 *  meant, few enough that a miss stays cheap. */
export const MAX_SUGGESTIONS = 8;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One stored spelling per skill name.
 *
 * Lowercase alphanumeric and hyphens, per the Agent Skills `name` rule — which
 * matters beyond conformance: the slug is what a user types in chat to call the
 * skill, and a vocabulary that splits on capitalisation or punctuation is worse
 * than no vocabulary. Non-ASCII is stripped rather than transliterated, so a
 * Chinese title falls back to an empty slug and the caller is asked for one
 * instead of getting a silent mangling.
 */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

export function isValidSlug(input: string): boolean {
  return input.length > 0 && input.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(input);
}

/**
 * A slug proposed from a display name, for the dashboard's "fill this in for
 * me" affordance. Returns "" when nothing usable survives — the caller decides
 * whether that is an error or just an empty field.
 */
export function suggestSlug(name: string): string {
  return normalizeSlug(name);
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .transform(normalizeSlug)
  .refine(isValidSlug, "must be lowercase letters, digits and single hyphens");

/** What a caller passes to address a skill: its slug or its id. */
export const skillReferenceSchema = z.string().trim().min(1).max(80);

export const skillNameSchema = z.string().trim().min(1).max(MAX_SKILL_NAME_LENGTH);
export const whenToUseSchema = z.string().trim().min(1).max(MAX_WHEN_TO_USE_LENGTH);
export const skillBodySchema = z.string().max(MAX_SKILL_BODY_LENGTH);
export const sourceRefSchema = z.string().trim().max(200);

export const createSkillSchema = z.object({
  slug: slugSchema,
  name: skillNameSchema,
  whenToUse: whenToUseSchema,
  body: skillBodySchema.optional(),
  status: z.enum(SKILL_STATUSES).optional(),
  autoDiscover: z.boolean().optional(),
  sourceRef: sourceRefSchema.nullable().optional(),
});

export const updateSkillSchema = z.object({
  slug: slugSchema.optional(),
  name: skillNameSchema.optional(),
  whenToUse: whenToUseSchema.optional(),
  body: skillBodySchema.optional(),
  status: z.enum(SKILL_STATUSES).optional(),
  autoDiscover: z.boolean().optional(),
  sourceRef: sourceRefSchema.nullable().optional(),
});

export const SKILL_SORTS = ["relevance", "updated", "created", "name"] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];

/* ------------------------------------------------------------------ *
 * Serving a row as a `skill://` resource (SEP-2640)
 *
 * The working group settled on convention over a new primitive: skills are
 * resources, and "MCP doesn't need to understand what a skill is". That is what
 * lets this database be the whole story — the SKILL.md a client reads is a
 * string built from a row at request time. Nothing is checked out, synced, or
 * stored on a disk.
 * ------------------------------------------------------------------ */

/**
 * `skill://<slug>/SKILL.md`.
 *
 * The last path segment before the filename must equal the frontmatter `name`,
 * per the URI scheme — which our slug already satisfies, because both follow
 * the same Agent Skills rule.
 */
export function skillUri(slug: string): string {
  return `skill://${slug}/SKILL.md`;
}

/** Pulls the slug back out of a `skill://` URI; null if it is not one of ours. */
export function slugFromSkillUri(uri: string): string | null {
  const match = /^skill:\/\/([^/]+)\/SKILL\.md$/.exec(uri);
  const slug = match?.[1];
  return slug !== undefined && isValidSlug(slug) ? slug : null;
}

/**
 * The row, rendered as the file a client expects.
 *
 * `description` is JSON-encoded rather than pasted between quotes: a user's
 * `whenToUse` can contain a colon, a quote or a newline, any of which would
 * turn valid frontmatter into a parse error on the client. YAML's
 * double-quoted scalar is JSON's string syntax, so this is both correct and
 * boring.
 */
export function renderSkillMarkdown(skill: {
  slug: string;
  whenToUse: string;
  body: string;
}): string {
  return `---\nname: ${skill.slug}\ndescription: ${JSON.stringify(skill.whenToUse)}\n---\n\n${skill.body}\n`;
}
