/**
 * Shape knowledge for the SEC EDGAR payloads.
 *
 * Pure functions only — `edgar.ts` does the HTTP. EDGAR's JSON is stable but
 * untyped and quietly inconsistent (columnar filing tables, restated facts
 * repeated across filings), so everything here narrows defensively rather than
 * trusting the payload.
 */

import type { MetricDef } from "./metrics.js";

export interface TickerEntry {
  ticker: string;
  cik: string;
  title: string;
}

export interface FilingRow {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  primaryDocument: string;
  description: string | null;
  /** 8-K item numbers, e.g. ["2.02", "9.01"]; empty for most other forms. */
  items: string[];
  url: string;
}

export interface CompanyInfo {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
}

export type PeriodType = "annual" | "quarterly" | "other";

export interface MetricPoint {
  /** Period end (instant date for balance-sheet metrics). */
  end: string;
  /** Period start; null for instant metrics. */
  start: string | null;
  value: number;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  periodType: PeriodType;
  form: string;
  filed: string;
  accession: string;
  /** The us-gaap concept this value actually came from. */
  concept: string;
}

export interface MetricSeries {
  key: string;
  label: string;
  unit: string;
  /** null when the filer reports none of the aliases. */
  concept: string | null;
  points: MetricPoint[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * EDGAR keys its ticker file on `-` (BRK-B), while quote APIs and humans use
 * `.` (BRK.B). Normalising both ways keeps callers from having to know.
 */
export function normalizeTicker(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

/** `company_tickers.json` is an object keyed by row index, not an array. */
export function parseTickerMap(body: string): Map<string, TickerEntry> {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("SEC ticker map is not an object.");

  const map = new Map<string, TickerEntry>();
  for (const row of Object.values(parsed)) {
    if (!isRecord(row)) continue;
    const ticker = asString(row["ticker"]);
    const cikRaw = row["cik_str"];
    if (ticker === null || typeof cikRaw !== "number") continue;
    const entry: TickerEntry = {
      ticker,
      cik: String(cikRaw).padStart(10, "0"),
      title: asString(row["title"]) ?? ticker,
    };
    // First listing wins: share classes of one issuer share a CIK anyway.
    if (!map.has(entry.ticker)) map.set(entry.ticker, entry);
  }
  if (map.size === 0) throw new Error("SEC ticker map contained no usable rows.");
  return map;
}

export function parseCompanyInfo(body: unknown): CompanyInfo {
  if (!isRecord(body)) throw new Error("SEC submissions payload is not an object.");
  const cik = asString(body["cik"]);
  if (cik === null) throw new Error("SEC submissions payload has no CIK.");
  return {
    cik: cik.padStart(10, "0"),
    name: asString(body["name"]) ?? "",
    tickers: Array.isArray(body["tickers"])
      ? body["tickers"].filter((t): t is string => typeof t === "string")
      : [],
    exchanges: Array.isArray(body["exchanges"])
      ? body["exchanges"].filter((e): e is string => typeof e === "string")
      : [],
    sic: asString(body["sic"]),
    sicDescription: asString(body["sicDescription"]),
    fiscalYearEnd: asString(body["fiscalYearEnd"]),
  };
}

function archiveUrl(cik: string, accession: string, document: string): string {
  // The Archives path uses the CIK without zero padding, and the accession
  // number with its dashes stripped.
  const cikPath = String(Number(cik));
  const accnPath = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accnPath}/${document}`;
}

/**
 * `filings.recent` is columnar — parallel arrays, one entry per filing. Zips
 * them back into rows, dropping any row missing the fields a citation needs.
 */
export function parseFilings(
  body: unknown,
  cik: string,
  options: { forms?: readonly string[]; limit?: number } = {},
): FilingRow[] {
  if (!isRecord(body)) throw new Error("SEC submissions payload is not an object.");
  const filings = body["filings"];
  if (!isRecord(filings)) return [];
  const recent = filings["recent"];
  if (!isRecord(recent)) return [];

  const column = (name: string): unknown[] =>
    Array.isArray(recent[name]) ? (recent[name] as unknown[]) : [];

  const forms = column("form");
  const accessions = column("accessionNumber");
  const filingDates = column("filingDate");
  const reportDates = column("reportDate");
  const documents = column("primaryDocument");
  const descriptions = column("primaryDocDescription");
  const items = column("items");

  const wanted =
    options.forms === undefined || options.forms.length === 0
      ? null
      : new Set(options.forms.map((form) => form.toUpperCase()));
  const limit = options.limit ?? forms.length;

  const rows: FilingRow[] = [];
  for (let i = 0; i < forms.length && rows.length < limit; i += 1) {
    const form = asString(forms[i]);
    const accession = asString(accessions[i]);
    const filingDate = asString(filingDates[i]);
    const document = asString(documents[i]);
    if (form === null || accession === null || filingDate === null || document === null) continue;
    if (wanted !== null && !wanted.has(form.toUpperCase())) continue;

    const rawItems = asString(items[i]);
    rows.push({
      form,
      filingDate,
      reportDate: asString(reportDates[i]),
      accessionNumber: accession,
      primaryDocument: document,
      description: asString(descriptions[i]),
      items: rawItems === null ? [] : rawItems.split(",").map((item) => item.trim()).filter(Boolean),
      url: archiveUrl(cik, accession, document),
    });
  }
  return rows;
}

interface RawFact {
  start: string | null;
  end: string;
  value: number;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  form: string;
  filed: string;
  accession: string;
}

function readFacts(units: unknown, unit: string): RawFact[] {
  if (!isRecord(units)) return [];
  const list = units[unit];
  if (!Array.isArray(list)) return [];

  const facts: RawFact[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const end = asString(raw["end"]);
    const value = raw["val"];
    const filed = asString(raw["filed"]);
    if (end === null || typeof value !== "number" || !Number.isFinite(value) || filed === null) {
      continue;
    }
    facts.push({
      start: asString(raw["start"]),
      end,
      value,
      fiscalYear: typeof raw["fy"] === "number" ? raw["fy"] : null,
      fiscalPeriod: asString(raw["fp"]),
      form: asString(raw["form"]) ?? "",
      filed,
      accession: asString(raw["accn"]) ?? "",
    });
  }
  return facts;
}

const DAY_MS = 86_400_000;

/** Forms whose reporting period is a full fiscal year. */
const ANNUAL_FORMS = ["10-K", "20-F", "40-F"];

function isAnnualFiling(fact: RawFact): boolean {
  return (
    fact.fiscalPeriod === "FY" || ANNUAL_FORMS.some((form) => fact.form.startsWith(form))
  );
}

function classifyDuration(fact: RawFact): PeriodType {
  if (fact.start === null) return "other";
  const span = Date.parse(fact.end) - Date.parse(fact.start);
  if (!Number.isFinite(span)) return "other";
  const days = Math.round(span / DAY_MS);
  // Fiscal years run 52/53 weeks and quarters 13 weeks, so match on a band
  // rather than exact lengths. Span is a property of the fact itself, so this
  // holds no matter which filing the fact was pulled from.
  if (days >= 330 && days <= 400) return "annual";
  if (days >= 60 && days <= 110) return "quarterly";
  return "other";
}

/**
 * Instant facts carry no span, and `fp`/`form` describe the *filing*, not the
 * fact — a fiscal year-end balance restated as a comparative inside a later
 * 10-Q arrives tagged `fp: "Q3"`. Classifying on the winning record alone
 * therefore demotes year-end snapshots to quarterly. Deciding over the whole
 * group fixes that: if any filing ever reported this date in an annual
 * context, the date is a fiscal year end.
 */
function classifyInstant(group: readonly RawFact[]): PeriodType {
  if (group.some(isAnnualFiling)) return "annual";
  if (group.some((fact) => fact.fiscalPeriod?.startsWith("Q") === true)) return "quarterly";
  return "other";
}

interface DedupedFact {
  fact: RawFact;
  periodType: PeriodType;
}

/**
 * Collapses the restatement history down to one value per period.
 *
 * The same fiscal period is re-reported in every filing that shows it as a
 * comparative, so a raw concept can carry 100+ points for ~40 real periods.
 * Latest `filed` wins the value, which is also the restated (most correct)
 * figure — but the period type is decided across the whole group.
 */
function dedupe(facts: RawFact[], kind: MetricDef["kind"]): DedupedFact[] {
  const groups = new Map<string, RawFact[]>();
  for (const fact of facts) {
    const key = kind === "instant" ? fact.end : `${fact.start ?? ""}|${fact.end}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [fact]);
    else group.push(fact);
  }

  const deduped: DedupedFact[] = [];
  for (const group of groups.values()) {
    let winner = group[0];
    if (winner === undefined) continue;
    for (const fact of group) {
      if (fact.filed > winner.filed) winner = fact;
    }
    deduped.push({
      fact: winner,
      periodType: kind === "instant" ? classifyInstant(group) : classifyDuration(winner),
    });
  }

  return deduped.sort((a, b) =>
    a.fact.end < b.fact.end ? 1 : a.fact.end > b.fact.end ? -1 : 0,
  );
}

/**
 * Pulls one comparable series per metric out of a `companyfacts` payload,
 * resolving each metric to the first alias the filer actually reports.
 */
export function extractMetrics(
  companyFacts: unknown,
  defs: readonly MetricDef[],
): MetricSeries[] {
  const facts = isRecord(companyFacts) ? companyFacts["facts"] : undefined;
  const gaap = isRecord(facts) ? facts["us-gaap"] : undefined;

  return defs.map((def) => {
    if (!isRecord(gaap)) {
      return { key: def.key, label: def.label, unit: def.unit, concept: null, points: [] };
    }

    for (const concept of def.concepts) {
      const node = gaap[concept];
      if (!isRecord(node)) continue;
      const raw = readFacts(node["units"], def.unit);
      if (raw.length === 0) continue;

      const points = dedupe(raw, def.kind).map<MetricPoint>(({ fact, periodType }) => ({
        end: fact.end,
        start: fact.start,
        value: fact.value,
        fiscalYear: fact.fiscalYear,
        fiscalPeriod: fact.fiscalPeriod,
        periodType,
        form: fact.form,
        filed: fact.filed,
        accession: fact.accession,
        concept,
      }));
      return { key: def.key, label: def.label, unit: def.unit, concept, points };
    }

    return { key: def.key, label: def.label, unit: def.unit, concept: null, points: [] };
  });
}
