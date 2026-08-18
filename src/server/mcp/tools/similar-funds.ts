import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cosineSimilarity } from "../../china/exposure.js";
import type { FundCache } from "../../china/ondemand.js";
import type { FundRepo } from "../../china/repo.js";
import { ensureHoldings } from "./ensure-cached.js";
import { fundCodeSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Substitutes for a fund, by exposure rather than by category label.
 *
 * The practical use is finding a tradable alternative when the fund you want is
 * closed to subscription — common for QDII, which runs against foreign-exchange
 * quota.
 */
export function registerSimilarFundsTool(
  server: McpServer,
  repo: FundRepo,
  cache: FundCache,
): void {
  server.registerTool(
    "similarFunds",
    {
      title: "Similar Funds",
      description:
        "Find funds whose sector exposure resembles a given fund, scored by cosine similarity of their " +
        "exposure vectors. Use to locate substitutes when a fund is capped, expensive, or has no " +
        "exchange-traded share class.",
      inputSchema: {
        code: fundCodeSchema,
        limit: z.number().int().min(1).max(30).optional(),
        minSimilarity: z.number().min(0).max(1).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ code, limit, minSimilarity }) =>
      runTool(async () => {
        await ensureHoldings(cache, repo, code);

        const fund = await repo.getFund(code);
        if (fund === null) {
          throw new Error(`Fund ${code} is not in the local index. Run the ingest job first.`);
        }

        const candidates = await repo.similarityCandidates(code, 300);
        const vectors = await repo.getExposureVectors([code, ...candidates]);
        const base = vectors.get(code);
        if (base === undefined || base.size === 0) {
          throw new Error(`Fund ${code} has no computed exposure yet. Run the ingest job first.`);
        }

        const threshold = minSimilarity ?? 0.5;
        const scored = candidates
          .map((candidate) => ({
            code: candidate,
            similarity: cosineSimilarity(base, vectors.get(candidate) ?? new Map()),
          }))
          .filter((entry) => entry.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit ?? 10);

        const details = await Promise.all(scored.map((entry) => repo.getFund(entry.code)));

        return {
          reference: { code: fund.code, name: fund.name, isQdii: fund.isQdii },
          matchCount: scored.length,
          funds: scored.map((entry, index) => {
            const detail = details[index];
            return {
              code: entry.code,
              name: detail?.name ?? null,
              similarity: entry.similarity,
              isQdii: detail?.isQdii ?? null,
              isIndexFund: detail?.isIndexFund ?? null,
              trackingIndex: detail?.trackingIndex ?? null,
              feeRate: detail?.feeRate ?? null,
              listedSymbol: detail?.listedSymbol ?? null,
              purchaseStatus: detail?.purchaseStatus ?? null,
            };
          }),
          note:
            "Similarity compares sector composition only — it does not account for currency hedging, " +
            "fees, or tracking error. Compare listedSymbol and feeRate before substituting.",
        };
      }),
  );
}
