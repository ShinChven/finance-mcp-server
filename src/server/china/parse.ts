/**
 * Pure parsers for Eastmoney / Tiantian Fund payloads.
 *
 * IMPORTANT: these response shapes are undocumented and were written from the
 * known structure of those endpoints, **not** verified against live responses
 * (the build sandbox has no egress to those hosts). They are deliberately
 * defensive — unknown fields are skipped rather than thrown on — and every
 * parser is a pure string→data function so a format drift is fixed here, with a
 * fixture, without touching the fetch or ingest layers.
 */

import { toCanonicalSymbol } from "./symbols.js";

export interface FundListEntry {
  code: string;
  name: string;
  fundType: string;
  pinyin?: string;
}

export interface NavPoint {
  navDate: string;
  nav: number | null;
  accNav: number | null;
  dailyReturn: number | null;
}

export interface HoldingEntry {
  symbol: string;
  name: string | null;
  weight: number;
  reportDate: string;
}

export interface FundProfile {
  code: string;
  name: string | null;
  /** Subscription fee actually charged, percent. */
  feeRate: number | null;
  /** Stock codes from the latest disclosed portfolio, canonicalized. */
  stockSymbols: string[];
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[%,\s]/g, "");
  if (cleaned === "" || cleaned === "---" || cleaned === "--") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * `fund.eastmoney.com/js/fundcode_search.js`
 * `var r = [["000001","HXCZHH","华夏成长混合","混合型","HUAXIA..."], ...];`
 */
export function parseFundCodeList(source: string): FundListEntry[] {
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let rows: unknown;
  try {
    rows = JSON.parse(source.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  const out: FundListEntry[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [code, pinyin, name, fundType] = row;
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) continue;
    if (typeof name !== "string" || name === "") continue;
    out.push({
      code,
      name,
      fundType: typeof fundType === "string" ? fundType : "",
      ...(typeof pinyin === "string" && pinyin !== "" ? { pinyin } : {}),
    });
  }
  return out;
}

/**
 * `api.fund.eastmoney.com/f10/lsjz` (requires a fund.eastmoney.com Referer).
 * `{"Data":{"LSJZList":[{"FSRQ":"2026-01-02","DWJZ":"1.2340","LJJZ":"3.4560","JZZZL":"0.53"}]}}`
 */
export function parseNavHistory(payload: string | unknown): NavPoint[] {
  let data: unknown = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      return [];
    }
  }

  const list = (data as { Data?: { LSJZList?: unknown } } | null)?.Data?.LSJZList;
  if (!Array.isArray(list)) return [];

  const out: NavPoint[] = [];
  for (const row of list) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as Record<string, unknown>;
    const navDate = typeof entry.FSRQ === "string" ? entry.FSRQ.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(navDate)) continue;
    out.push({
      navDate,
      nav: toNumber(entry.DWJZ),
      accNav: toNumber(entry.LJJZ),
      dailyReturn: toNumber(entry.JZZZL),
    });
  }
  return out;
}

const REPORT_DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{4}-\d{2}-\d{2})/;
const TABLE_RE = /<table[\s\S]*?<\/table>/gi;
const ROW_RE = /<tr[\s\S]*?<\/tr>/gi;
const CELL_RE = /<t[dh][\s\S]*?>([\s\S]*?)<\/t[dh]>/gi;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function quarterEndFrom(text: string): string | null {
  const match = REPORT_DATE_RE.exec(text);
  if (!match) return null;
  if (match[4]) return match[4];
  const [, year, month, day] = match;
  if (!year || !month || !day) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * `fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=...`
 * JSONP: `var apidata={content:"<div><h4>...2026-03-31</h4><table>…</table></div>",…};`
 *
 * The response carries several quarters; each table is preceded by its report
 * date. Rows are `序号 | 股票代码 | 股票名称 | 占净值比例 | …`.
 */
export function parseHoldings(source: string): HoldingEntry[] {
  const contentMatch = /content\s*:\s*"([\s\S]*?)"\s*,\s*(?:arryear|curyear)/.exec(source);
  const html = contentMatch?.[1]
    ? contentMatch[1].replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\r|\\n/g, "")
    : source;

  const out: HoldingEntry[] = [];
  const seen = new Set<string>();

  let tableMatch: RegExpExecArray | null;
  TABLE_RE.lastIndex = 0;
  while ((tableMatch = TABLE_RE.exec(html)) !== null) {
    const table = tableMatch[0];
    // The report date lives in the markup before this table.
    const preceding = html.slice(0, tableMatch.index);
    const reportDate = quarterEndFrom(preceding.slice(-400)) ?? quarterEndFrom(preceding);
    if (!reportDate) continue;

    ROW_RE.lastIndex = 0;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = ROW_RE.exec(table)) !== null) {
      const cells: string[] = [];
      CELL_RE.lastIndex = 0;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = CELL_RE.exec(rowMatch[0])) !== null) {
        cells.push(stripTags(cellMatch[1] ?? ""));
      }
      if (cells.length < 4) continue;

      const rawCode = cells.find((cell) => /^\d{5,6}$|^[A-Z]{1,5}$/.test(cell));
      if (!rawCode) continue;
      const symbol = toCanonicalSymbol(rawCode);
      if (!symbol) continue;

      // The weight is the first percentage-looking cell after the name.
      const weightCell = cells.find((cell) => /^\d+(\.\d+)?%$/.test(cell));
      const weight = toNumber(weightCell);
      if (weight === null) continue;

      const codeIndex = cells.indexOf(rawCode);
      const name = cells[codeIndex + 1] ?? null;

      const key = `${reportDate}:${symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol, name: name === "" ? null : name, weight, reportDate });
    }
  }

  return out;
}

/**
 * `fund.eastmoney.com/pingzhongdata/{code}.js` — a bag of `var x = …;`
 * assignments. Only the few fields the relationship layer needs are read.
 */
export function parseFundProfileJs(code: string, source: string): FundProfile {
  const readString = (name: string): string | null => {
    const match = new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`).exec(source);
    return match?.[1] ?? null;
  };
  const readJson = (name: string): unknown => {
    const match = new RegExp(`var\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\})\\s*;`).exec(
      source,
    );
    if (!match?.[1]) return undefined;
    try {
      return JSON.parse(match[1]);
    } catch {
      return undefined;
    }
  };

  const rawCodes = readJson("stockCodesNew") ?? readJson("stockCodes");
  const stockSymbols: string[] = [];
  if (Array.isArray(rawCodes)) {
    for (const entry of rawCodes) {
      if (typeof entry !== "string") continue;
      // `stockCodesNew` suffixes a market digit onto the 6-digit code.
      const trimmed = entry.length === 7 ? entry.slice(0, 6) : entry;
      const symbol = toCanonicalSymbol(trimmed);
      if (symbol && !stockSymbols.includes(symbol)) stockSymbols.push(symbol);
    }
  }

  return {
    code,
    name: readString("fS_name"),
    feeRate: toNumber(readString("fund_Rate")),
    stockSymbols,
  };
}
