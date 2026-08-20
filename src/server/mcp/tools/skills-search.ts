import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS } from "../../../shared/skills.js";
import type { SkillsRepo } from "../../skills/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { requireSkillsUser, skillHeader } from "./skill-runtime.js";

/**
 * The way in.
 *
 * One tool covers browsing and searching because the two differ only by whether
 * `q` is set — the same call the note tools made, and for the same reason: an
 * agent forced to choose between a `skillsList` and a `skillsSearch` will pick
 * wrong, and the filters are identical either way.
 *
 * Drafts never appear here. A skill written over MCP is invisible until a
 * person publishes it in the dashboard, so an agent cannot write itself an
 * instruction and then follow it in the same session.
 */
export function registerSkillsTool(server: McpServer, repo: SkillsRepo, auth: McpAuth | null): void {
  server.registerTool(
    "skills",
    {
      title: "Find Skills",
      description:
        "Find the user's saved skills — procedures they wrote for doing a task their way. " +
        "Returns names and a one-line description of when each applies, never the procedure " +
        "itself; call skillRead once you know which one you want. " +
        "Use this when the user refers to a skill without naming it exactly, or asks what skills " +
        "they have. When they name one outright, skip this and call skillRead directly.",
      inputSchema: {
        q: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("Free text over names and descriptions. Omit to list everything."),
        limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
        offset: z.number().int().min(0).max(1_000).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireSkillsUser(auth);

        const { items, total } = await repo.searchSkills(userId, {
          ...(args.q !== undefined && { q: args.q }),
          status: "active",
          limit: args.limit ?? DEFAULT_SEARCH_RESULTS,
          ...(args.offset !== undefined && { offset: args.offset }),
        });

        return {
          total,
          returned: items.length,
          skills: items.map(skillHeader),
          note:
            total === 0
              ? args.q === undefined
                ? "This user has no skills yet."
                : "Nothing matched. Omit `q` to see every skill this user has."
              : total > items.length
                ? `Showing ${items.length} of ${total}; raise \`limit\` or page with \`offset\`.`
                : undefined,
        };
      }),
  );
}
