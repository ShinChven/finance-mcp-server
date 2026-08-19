import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULT_BYTES = 1_000_000;

export const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} satisfies ToolAnnotations;

/**
 * Tools that change stored state. `openWorldHint` is false because these touch
 * this server's own rows, not an external service, and `idempotentHint` is true
 * because adds are conflict-tolerant and removes are by identity — repeating a
 * call converges rather than duplicating.
 */
export const writeToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

/** As above, for tools that delete rows. */
export const destructiveToolAnnotations = {
  ...writeToolAnnotations,
  destructiveHint: true,
} satisfies ToolAnnotations;

export const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .describe('Yahoo Finance symbol, for example "AAPL", "^GSPC", or "BTC-USD".');

export const symbolsSchema = z.array(symbolSchema).min(1).max(50);

export const regionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "region must be a two-letter code")
  .transform((value) => value.toUpperCase());

export const languageSchema = z.string().trim().min(2).max(16);

export const dateSchema = z
  .union([
    z
      .string()
      .trim()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date string"),
    z.number().int().nonnegative(),
  ])
  .describe("ISO date string or Unix timestamp in seconds.");

export function yahooRequestOptions() {
  return {
    fetchOptions: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  };
}

/**
 * A fund code in any cached market.
 *
 * Two shapes, one key space: China's 6-digit codes and everyone else's listing
 * ticker. They cannot collide, which is why `funds.code` needs no namespace and
 * a caller never has to say which provider it means. Uppercased on the way in
 * so `ivv` and `IVV` are the same fund.
 */
export const fundCodeSchema = z
  .string()
  .trim()
  .regex(
    /^(\d{6}|[A-Za-z][A-Za-z0-9.-]{0,11})$/,
    "must be a 6-digit China fund code or a listing ticker",
  )
  .transform((code) => code.toUpperCase())
  .describe('Fund code: a 6-digit China fund code ("162411") or a listing ticker ("IVV").');

export const fundCodesSchema = z.array(fundCodeSchema).min(2).max(10);

/**
 * Markets a fund itself trades in — not where its holdings are.
 *
 * The distinction is the one users actually care about: "a fund I can buy in
 * China that holds NVDA" is a domicile filter, not a market-exposure one.
 */
export const domicileSchema = z
  .array(z.string().trim().min(2).max(8).transform((market) => market.toUpperCase()))
  .min(1)
  .max(10)
  .describe('Fund domiciles to include, for example ["CN"] or ["US"].');

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return `Yahoo Finance request timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds.`;
    }
    return `${error.name}: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

/**
 * Provider-neutral tool envelope: JSON-serializes a result, enforces the size
 * cap, and turns thrown errors into an `isError` result instead of a transport
 * failure. `runYahooFinanceTool` is the Yahoo-named alias kept for the existing
 * tools; relationship tools call `runTool` directly.
 */
export async function runTool(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await operation();
    const text = JSON.stringify(result);
    if (text === undefined) throw new Error("Yahoo Finance returned no serializable data.");
    if (Buffer.byteLength(text, "utf8") > MAX_RESULT_BYTES) {
      throw new Error(
        "Yahoo Finance response exceeded 1 MB. Request fewer symbols, a shorter date range, or fewer modules.",
      );
    }

    const safeResult: unknown = JSON.parse(text);
    return {
      content: [{ type: "text", text }],
      structuredContent: { result: safeResult },
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: errorMessage(error) }],
      isError: true,
    };
  }
}

/** Backwards-compatible alias for the Yahoo tools. */
export const runYahooFinanceTool = runTool;
