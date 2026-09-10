import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { summarizeRelease } from "../../economy/analyze.js";
import type { DbnomicsClient } from "../../economy/dbnomics.js";
import { indicatorSchema, resolveSeries, seriesIdSchema } from "../../economy/resolve.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

/** Enough for a macro dashboard without turning one tool call into a crawl. */
const MAX_TARGETS = 8;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The latest print for one or more indicators.
 *
 * Reads as a dashboard rather than a lookup: several indicators in one call,
 * each with the step from the previous reading, the year-over-year move, and
 * how stale the reading is. That last field is the one that stops an agent
 * reporting a three-month-old CPI as today's inflation.
 *
 * One indicator failing does not fail the call. A macro snapshot is worth
 * having with a gap in it, and the gap is reported per row.
 */
export function registerEconomicReleaseTool(server: McpServer, client: DbnomicsClient): void {
  server.registerTool(
    "economicRelease",
    {
      title: "Economic Release",
      description:
        "Latest published reading for one or more economic indicators, with the change from " +
        "the previous period, the year-over-year change, and how many days old the reading " +
        "is. Pass several `indicators` for a macro snapshot in one call — for example " +
        "us-core-pce, us-unemployment, us-fed-funds and us-10y-2y-spread. Economic data lags " +
        "the period it measures, so always read `staleDays` before calling a figure current. " +
        "Use `economicSeries` for history.",
      inputSchema: {
        indicators: z
          .array(indicatorSchema)
          .min(1)
          .max(MAX_TARGETS)
          .optional()
          .describe("Catalogue indicator ids to report."),
        seriesIds: z
          .array(seriesIdSchema)
          .min(1)
          .max(MAX_TARGETS)
          .optional()
          .describe("Raw DBnomics paths, for series outside the catalogue."),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ indicators, seriesIds }) =>
      runTool(async () => {
        const targets: { indicator?: string; seriesId?: string }[] = [
          ...(indicators ?? []).map((id) => ({ indicator: id })),
          ...(seriesIds ?? []).map((id) => ({ seriesId: id })),
        ];
        if (targets.length === 0) {
          throw new Error("Pass `indicators` (catalogue ids) or `seriesIds` (DBnomics paths).");
        }
        if (targets.length > MAX_TARGETS) {
          throw new Error(
            `Too many series requested (${targets.length}); the limit is ${MAX_TARGETS} per call.`,
          );
        }

        const now = new Date();
        const releases = await Promise.all(
          targets.map(async (target) => {
            const requested = target.indicator ?? target.seriesId ?? "";
            try {
              const { document, descriptor } = await resolveSeries(client, target);
              const summary = summarizeRelease(document, now);
              return {
                requested,
                name: document.name ?? descriptor?.label ?? null,
                provider: document.provider,
                frequency: document.frequency,
                unit: document.unit ?? descriptor?.unit ?? null,
                kind: descriptor?.kind ?? null,
                note: descriptor?.note ?? null,
                ...summary,
              };
            } catch (error) {
              return { requested, error: errorText(error) };
            }
          }),
        );

        return {
          asOf: now.toISOString(),
          count: releases.length,
          releases,
          source: "DBnomics (https://db.nomics.world), which re-serves the original statistical agency.",
        };
      }),
  );
}
