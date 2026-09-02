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
 *
 * An empty array is never the answer while the user has skills. A caller that
 * asked for "trending market" and got `[]` has been told, in the strongest
 * terms the protocol offers, that there is nothing here worth reading — and it
 * moves on and answers without the procedure the user wrote. The two mistakes
 * are not the same size: a needless header costs a line of context, a missed
 * skill costs the workflow. So a query that matches nothing falls back to the
 * listing and says so.
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
        "Use this when the user refers to a skill without naming it exactly, asks what skills " +
        "they have, or asks an open-ended question you could have a procedure for — the list is " +
        "small and one call is cheap. When they name one outright, skip this and call skillRead " +
        "directly. Read the descriptions before concluding none applies: `q` is a filter over " +
        "the wording, not a judgement about relevance, and a skill whose description covers the " +
        "question is worth reading even when it is the only one there.",
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

        const limit = args.limit ?? DEFAULT_SEARCH_RESULTS;
        const { items, total } = await repo.searchSkills(userId, {
          ...(args.q !== undefined && { q: args.q }),
          status: "active",
          limit,
          ...(args.offset !== undefined && { offset: args.offset }),
        });

        // Paging past the end of a result set is not a miss — the caller has
        // already seen the matches and is asking for more of them. Only a
        // first page that found nothing is worth answering with the library.
        const missed = total === 0 && args.q !== undefined && (args.offset ?? 0) === 0;
        if (missed) {
          const all = await repo.searchSkills(userId, { status: "active", limit });
          if (all.total > 0) {
            return {
              total: all.total,
              returned: all.items.length,
              matchedQuery: false,
              skills: all.items.map(skillHeader),
              note:
                `Nothing matched "${args.q}", so this is every skill this user has ` +
                `(${all.total}) instead of an empty result. The wording of a query and the ` +
                "wording of a description rarely line up — read these before deciding none " +
                "applies." +
                (all.total > all.items.length
                  ? ` Showing ${all.items.length}; raise \`limit\` to see the rest.`
                  : ""),
            };
          }
        }

        // Reaching here with nothing means either an empty store or a caller
        // paging past a query that matched nothing — `missed` above already
        // handled the case where the library has something to offer.
        const empty = total === 0 && (await repo.countSkills(userId)) === 0;

        return {
          total,
          returned: items.length,
          skills: items.map(skillHeader),
          note:
            total === 0
              ? empty
                ? "This user has no skills yet."
                : "Nothing matched. Omit `q` to see every skill this user has."
              : total > items.length
                ? `Showing ${items.length} of ${total}; raise \`limit\` or page with \`offset\`.`
                : undefined,
        };
      }),
  );
}
