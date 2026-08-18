import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EdgarClient } from "../../sec/edgar.js";
import { readOnlyToolAnnotations, runTool, symbolSchema } from "./runtime.js";

/**
 * The filing index, straight from the source of record.
 *
 * Yahoo's `secFilings` module is a thin, often-stale mirror of this; going to
 * EDGAR gets the full form history plus the document URLs needed to cite or
 * read the actual report.
 */
export function registerSecFilingsTool(server: McpServer, client: EdgarClient): void {
  server.registerTool(
    "secFilings",
    {
      title: "SEC Filings",
      description:
        "List a US issuer's SEC filings from EDGAR, newest first, with direct document URLs. " +
        "Filter by form to get earnings reports (10-Q, 10-K), material events (8-K), or insider " +
        "activity (4). Covers SEC registrants only — non-US listings have no CIK.",
      inputSchema: {
        symbol: symbolSchema,
        forms: z
          .array(z.string().trim().min(1).max(20))
          .min(1)
          .max(10)
          .optional()
          .describe('Form types to keep, e.g. ["10-K", "10-Q"]. Omit for all forms.'),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, forms, limit }) =>
      runTool(async () => {
        const entry = await client.resolveTicker(symbol);
        const { company, filings } = await client.fetchFilings(entry.cik, {
          ...(forms !== undefined && { forms }),
          limit: limit ?? 20,
        });
        return {
          company: {
            cik: company.cik,
            name: company.name,
            tickers: company.tickers,
            exchanges: company.exchanges,
            sic: company.sic,
            industry: company.sicDescription,
            fiscalYearEnd: company.fiscalYearEnd,
          },
          matched: filings.length,
          filings,
          // `filings.recent` is the most recent ~1000 filings; older history
          // lives in separate paginated files EDGAR exposes but this does not read.
          note:
            "Covers the most recent filings EDGAR returns in its 'recent' index. " +
            "reportDate is the period the filing covers; filingDate is when it was submitted.",
        };
      }),
  );
}
