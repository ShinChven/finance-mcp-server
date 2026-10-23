/**
 * Thin fetch layer over the DBnomics public API.
 *
 * DBnomics (CEPREMAP, a French non-profit) aggregates FRED, BLS, Eurostat, ECB,
 * IMF, OECD and a long tail of national statistics offices behind one JSON API
 * that needs no key and no registration. That is why it is here: it reaches
 * FRED's catalogue without a FRED key, keeping every upstream in this server
 * free. Mirrors `crypto/coingecko.ts` — HTTP, throttling and caching here, shape
 * knowledge in `parseSeries()` below.
 *
 * There is no published rate limit, which is not the same as there being none.
 * Responses are cached by URL for hours rather than minutes because the data
 * underneath moves monthly at best: a burst of tool calls about the same
 * indicator must not spend goodwill on an upstream nobody is paying for.
 *
 * ## On series addressing
 *
 * DBnomics addresses a series as `provider/dataset/code`, and for some
 * providers the dataset and the series code coincide. Rather than hard-code an
 * assumption about FRED's layout, `fetchIndicator` tries the candidate paths in
 * order and remembers which one answered — see `resolveIndicatorPath`. A caller
 * that already knows the exact path passes it verbatim to `fetchSeries` and no
 * guessing happens at all.
 */

import { BRAND_SLUG } from "../../shared/brand.js";
import {
  toFrequency,
  type Frequency,
  type IndicatorDescriptor,
} from "../../shared/economy.js";

const REQUEST_TIMEOUT_MS = 15_000;
/** Macro series move monthly at best; an hour of staleness costs nothing. */
const SERIES_TTL_MS = 60 * 60 * 1_000;
const MAX_CACHED_SERIES = 64;

export const DEFAULT_BASE_URL = "https://api.db.nomics.world/v22";

export type Fetcher = typeof globalThis.fetch;

export interface DbnomicsClientOptions {
  fetchImpl?: Fetcher;
  baseUrl?: string;
  minIntervalMs?: number;
}

/** One published data point. `value` is null where the source published no figure. */
export interface Observation {
  /** The period as the source labels it, e.g. "2026-07" or "2026-Q2". */
  period: string;
  /** First day of that period, ISO. The field to sort and compare on. */
  date: string;
  value: number | null;
}

/** A series with its metadata, normalized out of the DBnomics envelope. */
export interface SeriesDocument {
  provider: string;
  dataset: string;
  datasetName: string | null;
  code: string;
  name: string | null;
  frequency: Frequency;
  unit: string | null;
  /** Oldest first. */
  observations: Observation[];
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

export class DbnomicsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DbnomicsError";
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * DBnomics writes a missing observation as the string "NA", not as null, and a
 * few providers emit it as an empty string. Both become null here so that
 * downstream arithmetic never has to ask what type it is holding.
 */
function observationValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.toUpperCase() === "NA") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const QUARTER_PERIOD = /^(\d{4})-?Q([1-4])$/i;

/**
 * A sortable ISO date for a period label.
 *
 * Needed because `period_start_day` is not universal: a provider that omits it
 * leaves only its own label, and "2026-Q2" is not a date any comparison
 * understands — a range filter would have discarded the whole series rather
 * than fail loudly. The shapes handled here are the ones DBnomics actually
 * publishes; anything else is passed through untouched and treated as opaque
 * downstream.
 */
export function periodToDate(period: string): string {
  const quarter = QUARTER_PERIOD.exec(period);
  if (quarter !== null) {
    const year = quarter[1] ?? "";
    const index = Number(quarter[2] ?? "1");
    return `${year}-${String((index - 1) * 3 + 1).padStart(2, "0")}-01`;
  }
  if (/^\d{4}$/.test(period)) return `${period}-01-01`;
  if (/^\d{4}-\d{2}$/.test(period)) return `${period}-01`;
  return period;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pulls the first series document out of a `/series/...` response.
 *
 * The observation arrays are parallel — `period[i]` describes `value[i]` — and
 * a provider that publishes a ragged pair would silently shift every reading by
 * a row, so the zip stops at the shorter of the two rather than trusting them
 * to match.
 */
export function parseSeries(body: unknown): SeriesDocument {
  const root = asRecord(body);
  const series = root === null ? null : asRecord(root["series"]);
  const docs = series === null ? null : series["docs"];
  const first = Array.isArray(docs) ? asRecord(docs[0]) : null;

  if (first === null) {
    throw new DbnomicsError("DBnomics returned no series for that identifier.");
  }

  const periods = Array.isArray(first["period"]) ? first["period"] : [];
  const startDays = Array.isArray(first["period_start_day"]) ? first["period_start_day"] : [];
  const values = Array.isArray(first["value"]) ? first["value"] : [];

  const observations: Observation[] = [];
  const count = Math.min(periods.length, values.length);
  for (let i = 0; i < count; i += 1) {
    const period = stringOrNull(periods[i]);
    if (period === null) continue;
    // `period_start_day` is the sortable form; a provider that omits it leaves
    // only its own label, which `periodToDate` widens into a real date.
    const date = stringOrNull(startDays[i]) ?? periodToDate(period);
    observations.push({ period, date, value: observationValue(values[i]) });
  }

  observations.sort((a, b) => a.date.localeCompare(b.date));

  return {
    provider: stringOrNull(first["provider_code"]) ?? "",
    dataset: stringOrNull(first["dataset_code"]) ?? "",
    datasetName: stringOrNull(first["dataset_name"]),
    code: stringOrNull(first["series_code"]) ?? "",
    name: stringOrNull(first["series_name"]),
    frequency: toFrequency(stringOrNull(first["@frequency"])),
    unit: stringOrNull(first["unit"]),
    observations,
  };
}

/**
 * The paths a catalogue indicator might live at, most likely first.
 *
 * Providers whose dataset groups many series use `provider/dataset/code`;
 * providers that publish one series per dataset are reachable at
 * `provider/code`. Trying both costs one extra request the first time a series
 * is touched and nothing afterwards.
 */
export function candidatePaths(indicator: IndicatorDescriptor): string[] {
  return [
    `${indicator.provider}/${indicator.code}/${indicator.code}`,
    `${indicator.provider}/${indicator.code}`,
  ];
}

export class DbnomicsClient {
  private readonly fetchImpl: Fetcher;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private readonly series = new Map<string, Cached<SeriesDocument>>();
  /** Indicator id -> the candidate path that answered. Process-lifetime. */
  private readonly resolved = new Map<string, string>();

  constructor(options: DbnomicsClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async getJson(url: string): Promise<unknown> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": BRAND_SLUG },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new DbnomicsError(
          `DBnomics has no series at that path (404). Check the identifier at ` +
            `https://db.nomics.world — it is spelled provider/dataset/code, for example ` +
            `FRED/CPIAUCSL/CPIAUCSL.`,
          404,
        );
      }
      if (response.status === 429) {
        throw new DbnomicsError(
          "DBnomics rate-limited this server (429). It is a free non-profit service; retry shortly.",
          429,
        );
      }
      throw new DbnomicsError(
        `DBnomics request failed (${response.status}): ${url}`,
        response.status,
      );
    }
    return response.json();
  }

  private static evict(cache: Map<string, Cached<SeriesDocument>>): void {
    while (cache.size > MAX_CACHED_SERIES) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  /** Fetches one series by its exact DBnomics path, e.g. "FRED/CPIAUCSL/CPIAUCSL". */
  async fetchSeries(path: string): Promise<SeriesDocument> {
    const url = `${this.baseUrl}/series/${path}?observations=1`;

    const cached = this.series.get(url);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;

    const value = parseSeries(await this.getJson(url));
    this.series.set(url, { value, expiresAt: Date.now() + SERIES_TTL_MS });
    DbnomicsClient.evict(this.series);
    return value;
  }

  /**
   * Fetches a catalogue indicator, discovering which path shape its provider
   * uses on first touch and reusing that answer for the rest of the process.
   *
   * Only a "not found" moves on to the next candidate. A timeout or a 500 is
   * upstream trouble rather than a wrong guess, and retrying it against a
   * different path would bury the real error behind a misleading one.
   */
  async fetchIndicator(indicator: IndicatorDescriptor): Promise<SeriesDocument> {
    const known = this.resolved.get(indicator.id);
    if (known !== undefined) return this.fetchSeries(known);

    const candidates = candidatePaths(indicator);
    let lastError: unknown;
    for (const path of candidates) {
      try {
        const document = await this.fetchSeries(path);
        this.resolved.set(indicator.id, path);
        return document;
      } catch (error) {
        const notFound =
          error instanceof DbnomicsError &&
          (error.status === 404 || error.status === undefined);
        if (!notFound) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new DbnomicsError(`DBnomics has no series for indicator "${indicator.id}".`, 404);
  }
}

let singleton: DbnomicsClient | null = null;

/** Lazy, so importing a tool module does not construct a client. */
export function getDbnomicsClient(): DbnomicsClient {
  singleton ??= new DbnomicsClient();
  return singleton;
}
