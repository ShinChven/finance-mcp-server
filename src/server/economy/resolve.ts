/**
 * Turning what a caller asked for into a fetched series.
 *
 * Two ways in, and they are deliberately different in kind: `indicator` is a
 * slug from the curated catalogue, which carries a unit, a frequency and an
 * opinion about how the number should be read; `seriesId` is a raw DBnomics
 * path, which carries nothing but reaches everything the aggregator holds.
 */

import { z } from "zod";
import {
  INDICATOR_IDS,
  findIndicator,
  type IndicatorDescriptor,
} from "../../shared/economy.js";
import type { DbnomicsClient, SeriesDocument } from "./dbnomics.js";

/**
 * A DBnomics path: two or three segments of `provider/dataset/code`.
 *
 * Strict by construction because this string is interpolated into a URL path.
 * The character class admits what real series codes use and nothing else — no
 * dots-only segments, no encoded separators — so a caller cannot walk out of
 * `/series/` into another endpoint or a different host.
 */
export const seriesIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_.@:-]*){1,2}$/,
    "must be a DBnomics path like FRED/CPIAUCSL/CPIAUCSL",
  )
  .describe(
    'Raw DBnomics series path, "provider/dataset/code" — e.g. "FRED/CPIAUCSL/CPIAUCSL" or ' +
      '"Eurostat/prc_hicp_midx/M.I15.CP00.EA". Use this for anything outside the `indicator` ' +
      "catalogue; browse identifiers at https://db.nomics.world.",
  );

export const indicatorSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => value.toLowerCase())
  .describe(
    `Catalogue indicator id. One of: ${INDICATOR_IDS.join(", ")}.`,
  );

export interface ResolvedSeries {
  document: SeriesDocument;
  /** Present when the caller came in through the catalogue. */
  descriptor: IndicatorDescriptor | null;
  /** What to echo back so the caller knows what was actually fetched. */
  requested: string;
}

export class UnknownIndicatorError extends Error {
  constructor(id: string) {
    super(
      `Unknown indicator "${id}". Known ids: ${INDICATOR_IDS.join(", ")}. ` +
        "For anything else, pass a raw DBnomics path as `seriesId` instead.",
    );
    this.name = "UnknownIndicatorError";
  }
}

/**
 * Fetches whichever of the two the caller supplied.
 *
 * `seriesId` wins when both are given rather than erroring: it is the more
 * specific of the two, and refusing a request that names one series
 * unambiguously would be pedantry.
 */
export async function resolveSeries(
  client: DbnomicsClient,
  input: { indicator?: string | undefined; seriesId?: string | undefined },
): Promise<ResolvedSeries> {
  if (input.seriesId !== undefined) {
    return {
      document: await client.fetchSeries(input.seriesId),
      descriptor: null,
      requested: input.seriesId,
    };
  }

  if (input.indicator === undefined) {
    throw new Error("Pass either `indicator` (a catalogue id) or `seriesId` (a DBnomics path).");
  }

  const descriptor = findIndicator(input.indicator);
  if (descriptor === undefined) throw new UnknownIndicatorError(input.indicator);

  return {
    document: await client.fetchIndicator(descriptor),
    descriptor,
    requested: descriptor.id,
  };
}
