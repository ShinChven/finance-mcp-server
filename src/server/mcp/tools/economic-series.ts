import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyTransform,
  defaultLimit,
  defaultTransform,
  windowPoints,
  type Transform,
} from "../../economy/analyze.js";
import type { DbnomicsClient } from "../../economy/dbnomics.js";
import { indicatorSchema, resolveSeries, seriesIdSchema } from "../../economy/resolve.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

const transformSchema = z
  .enum(["auto", "none", "pop_pct", "yoy_pct"])
  .describe(
    "auto (default) reads index series year-over-year and leaves rates and levels as " +
      "published; none returns raw values; pop_pct is period-over-period percent change; " +
      "yoy_pct is percent change against a year earlier.",
  );

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "must be YYYY, YYYY-MM or YYYY-MM-DD");

/**
 * History for one economic series.
 *
 * The counterpart to `chart`: that one prices an instrument, this one reads the
 * economy the instrument trades in. Everything comes from DBnomics, which
 * re-serves FRED, Eurostat, ECB, BLS, IMF and OECD without an API key.
 */
export function registerEconomicSeriesTool(server: McpServer, client: DbnomicsClient): void {
  server.registerTool(
    "economicSeries",
    {
      title: "Economic Series",
      description:
        "Time series for a macroeconomic indicator — inflation, unemployment, GDP, policy " +
        "rates, Treasury yields, money supply, sentiment, housing. Name a catalogue " +
        "`indicator` (us-cpi, us-unemployment, us-10y, us-core-pce, us-10y-2y-spread, ...) or " +
        "pass any DBnomics path as `seriesId` to reach series outside the catalogue, " +
        "including non-US sources. Index series such as CPI are returned year-over-year by " +
        "default, because the index level itself answers no question; override with " +
        "`transform`. Use `economicRelease` instead when you only need the latest print.",
      inputSchema: {
        indicator: indicatorSchema.optional(),
        seriesId: seriesIdSchema.optional(),
        from: dateOnlySchema.optional().describe("Earliest period to return, inclusive."),
        to: dateOnlySchema.optional().describe("Latest period to return, inclusive."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2_000)
          .optional()
          .describe("Most recent N observations to keep, after the date range is applied."),
        transform: transformSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ indicator, seriesId, from, to, limit, transform }) =>
      runTool(async () => {
        const { document, descriptor, requested } = await resolveSeries(client, {
          indicator,
          seriesId,
        });

        // A raw seriesId carries no opinion about how to read the number, so
        // "auto" can only mean "as published" there.
        const requestedTransform: Transform =
          transform === undefined || transform === "auto"
            ? descriptor === null
              ? "none"
              : defaultTransform(descriptor)
            : transform;

        const transformed = applyTransform(
          document.observations,
          document.frequency,
          requestedTransform,
        );
        const points = windowPoints(transformed, {
          from,
          to,
          limit: limit ?? defaultLimit(document.frequency),
        });

        return {
          requested,
          series: {
            provider: document.provider,
            dataset: document.dataset,
            code: document.code,
            name: document.name ?? descriptor?.label ?? null,
            frequency: document.frequency,
            unit: document.unit ?? descriptor?.unit ?? null,
            kind: descriptor?.kind ?? null,
            note: descriptor?.note ?? null,
          },
          transform: requestedTransform,
          observationsAvailable: document.observations.length,
          count: points.length,
          observations: points,
          source: "DBnomics (https://db.nomics.world), which re-serves the original statistical agency.",
        };
      }),
  );
}
