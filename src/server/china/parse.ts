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

export interface FundBasics {
  code: string;
  name: string | null;
  fundType: string | null;
  /** Declared benchmark index ("跟踪标的"); null when the fund has no mandate. */
  trackingIndex: string | null;
  company: string | null;
  manager: string | null;
  /** Management fee, percent per year. */
  feeRate: number | null;
  /** Net assets in 亿元 (100M CNY), as disclosed on the profile page. */
  fundSize: number | null;
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

      // `\d{3}[A-Z]` catches Tokyo's post-2024 alphanumeric codes (`285A`);
      // without it a QDII's Japanese holdings are dropped with no error.
      const rawCode = cells.find((cell) => /^\d{5,6}$|^[A-Z]{1,5}$|^\d{3}[A-Z]$/.test(cell));
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

const TH_TD_PAIR_RE = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;

/** Values Eastmoney uses to mean "not applicable" on the profile page. */
const NULL_MARKERS = new Set(["", "-", "--", "---", "暂无数据", "该基金无跟踪标的"]);

function cleanValue(raw: string): string | null {
  const value = stripTags(raw).replace(/\s+/g, " ").trim();
  return NULL_MARKERS.has(value) ? null : value;
}

/**
 * `fundf10.eastmoney.com/jbgk_{code}.html` — the 基金概况 table.
 *
 * This is the only source for 跟踪标的, which is what makes index-tracking the
 * high-confidence route from a theme to a fund: a declared mandate does not
 * drift the way a quarterly holdings snapshot does.
 */
export function parseFundBasics(code: string, html: string): FundBasics {
  const fields = new Map<string, string | null>();

  TH_TD_PAIR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TH_TD_PAIR_RE.exec(html)) !== null) {
    const label = stripTags(match[1] ?? "").replace(/\s+/g, "");
    if (label === "") continue;
    if (!fields.has(label)) fields.set(label, cleanValue(match[2] ?? ""));
  }

  const read = (...labels: string[]): string | null => {
    for (const label of labels) {
      const value = fields.get(label);
      if (value !== undefined && value !== null) return value;
    }
    return null;
  };

  // "0.80%（每年）" → 0.8
  const feeRaw = read("管理费率", "管理费");
  const feeRate = feeRaw === null ? null : toNumber(/(-?\d+(?:\.\d+)?)\s*%/.exec(feeRaw)?.[1]);

  // "12.34亿元（截止至：2026-03-31）" → 12.34
  const sizeRaw = read("资产规模", "最新规模");
  const fundSize = sizeRaw === null ? null : toNumber(/(-?\d+(?:\.\d+)?)\s*亿/.exec(sizeRaw)?.[1]);

  return {
    code,
    name: read("基金全称", "基金简称"),
    fundType: read("基金类型"),
    // Only 跟踪标的 — deliberately NOT falling back to 业绩比较基准, which for an
    // active fund is a blended benchmark, not a mandate. Filling this field from
    // it would make every active fund look like an index fund.
    trackingIndex: read("跟踪标的"),
    company: read("基金管理人"),
    manager: read("基金经理人", "基金经理"),
    feeRate,
    fundSize,
  };
}
