/**
 * Skills served as `skill://` resources, per SEP-2640.
 *
 * The working group closed the "new primitive" design and settled on
 * convention over the existing Resources primitive: skills are files, and
 * Resources already exist to expose files. Which is the whole reason this works
 * without a repository — a `SKILL.md` here is a string built from a database row
 * at request time. Nothing is checked out, nothing is synced, nothing is stored
 * on a disk.
 *
 * Everything is lazy. A `ResourceTemplate` takes a `list` callback the SDK
 * invokes only when a client actually calls `resources/list`, and the read
 * callback fires only on `resources/read`, so an MCP request that never
 * mentions skills pays nothing — no query, no rows, no context.
 *
 * Two rules the callbacks share with the tools, because they are the same rules
 * and must not drift: a draft is never served, and a row is only ever reachable
 * by the user who owns it.
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import {
  MAX_SEARCH_RESULTS,
  renderSkillMarkdown,
  skillUri,
  slugFromSkillUri,
} from "../../../shared/skills.js";
import type { SkillsRepo } from "../../skills/repo.js";

export function registerSkillResources(
  server: McpServer,
  repo: SkillsRepo,
  auth: McpAuth | null,
): void {
  server.registerResource(
    "skill",
    new ResourceTemplate("skill://{slug}/SKILL.md", {
      /**
       * Only skills the user marked discoverable.
       *
       * SEP-2640 makes enumeration optional and tells clients not to read an
       * empty listing as "this server has no skills" — every skill stays
       * readable at its own URI regardless. So an unlisted skill is not a
       * hidden one; it is one that has to be named, which is the default this
       * feature was asked for.
       */
      list: async () => {
        if (auth === null) return { resources: [] };
        // Unpaged: a client cannot tell a truncated enumeration from a
        // complete one, and the per-user cap already bounds the answer.
        const items = await repo.listDiscoverable(auth.user.id);
        return {
          resources: items.map((skill) => ({
            uri: skillUri(skill.slug),
            name: skill.slug,
            title: skill.name,
            description: skill.whenToUse,
            mimeType: "text/markdown",
          })),
        };
      },

      /** Slug completion, so a client browsing the template can offer real
       *  names instead of asking the user to remember one. */
      complete: {
        slug: async (value) => {
          if (auth === null) return [];
          const { items } = await repo.searchSkills(auth.user.id, {
            ...(value.trim() !== "" && { q: value }),
            status: "active",
            limit: MAX_SEARCH_RESULTS,
          });
          return items.map((skill) => skill.slug);
        },
      },
    }),
    {
      title: "Agent Skill",
      description:
        "A procedure this user wrote, served as SKILL.md with Agent Skills frontmatter. " +
        "Readable at skill://<name>/SKILL.md whether or not it appears in a listing.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      if (auth === null) {
        throw new Error("Skills are only available on an authenticated MCP request.");
      }
      // Parsed from the URI rather than from the template variable so the
      // slug is validated by the same rule that produced it.
      const slug = slugFromSkillUri(uri.href);
      if (slug === null) throw new Error(`Not a skill URI: ${uri.href}`);

      const skill = await repo.getSkill(auth.user.id, slug);
      // Draft and archived are absent rather than refused — same call as
      // `skillRead` makes, and naming a draft back would leak text the user
      // has not approved for use.
      if (skill === null || skill.status !== "active") {
        throw new Error(`No skill named "${slug}".`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderSkillMarkdown(skill),
          },
        ],
      };
    },
  );
}
