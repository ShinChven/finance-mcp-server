/**
 * Financial statements, as a printed statement lays them out.
 *
 * `fundamentalsTimeSeries` returns a few hundred line items per period, most of
 * them empty for any given company and many of them restatements of each other
 * under different names. A reader wants the dozen lines an annual report puts
 * on its first page, in that order, with the subtotals set apart — so that is
 * what is curated here, per statement. A line every period left empty is
 * dropped rather than printed as a row of dashes.
 */

import type { Statement, StatementPeriod, StatementRow, StatementView } from "../../shared/symbol.js";
import { isoDate, num, record } from "./read.js";

interface LineDef {
  key: string;
  label: string;
  unit?: StatementRow["unit"];
  emphasis?: boolean;
}

export const STATEMENT_LINES: Record<Statement, LineDef[]> = {
  income: [
    { key: "totalRevenue", label: "Total revenue", emphasis: true },
    { key: "costOfRevenue", label: "Cost of revenue" },
    { key: "grossProfit", label: "Gross profit", emphasis: true },
    { key: "researchAndDevelopment", label: "Research & development" },
    { key: "sellingGeneralAndAdministration", label: "Selling, general & admin" },
    { key: "operatingExpense", label: "Operating expense" },
    { key: "operatingIncome", label: "Operating income", emphasis: true },
    { key: "interestExpense", label: "Interest expense" },
    { key: "pretaxIncome", label: "Pretax income" },
    { key: "taxProvision", label: "Tax provision" },
    { key: "netIncome", label: "Net income", emphasis: true },
    { key: "EBITDA", label: "EBITDA" },
    { key: "basicEPS", label: "Basic EPS", unit: "perShare" },
    { key: "dilutedEPS", label: "Diluted EPS", unit: "perShare", emphasis: true },
    { key: "dilutedAverageShares", label: "Diluted shares", unit: "shares" },
  ],
  balance: [
    { key: "totalAssets", label: "Total assets", emphasis: true },
    { key: "currentAssets", label: "Current assets" },
    { key: "cashCashEquivalentsAndShortTermInvestments", label: "Cash & short-term investments" },
    { key: "accountsReceivable", label: "Accounts receivable" },
    { key: "inventory", label: "Inventory" },
    { key: "goodwill", label: "Goodwill" },
    { key: "totalLiabilitiesNetMinorityInterest", label: "Total liabilities", emphasis: true },
    { key: "currentLiabilities", label: "Current liabilities" },
    { key: "currentDebt", label: "Current debt" },
    { key: "longTermDebt", label: "Long-term debt" },
    { key: "totalDebt", label: "Total debt" },
    { key: "netDebt", label: "Net debt" },
    { key: "stockholdersEquity", label: "Shareholders' equity", emphasis: true },
    { key: "workingCapital", label: "Working capital" },
    { key: "tangibleBookValue", label: "Tangible book value" },
    { key: "ordinarySharesNumber", label: "Shares outstanding", unit: "shares" },
  ],
  cashflow: [
    { key: "operatingCashFlow", label: "Operating cash flow", emphasis: true },
    { key: "depreciationAndAmortization", label: "Depreciation & amortization" },
    { key: "stockBasedCompensation", label: "Stock-based compensation" },
    { key: "investingCashFlow", label: "Investing cash flow", emphasis: true },
    { key: "capitalExpenditure", label: "Capital expenditure" },
    { key: "financingCashFlow", label: "Financing cash flow", emphasis: true },
    { key: "cashDividendsPaid", label: "Dividends paid" },
    { key: "repurchaseOfCapitalStock", label: "Share buybacks" },
    { key: "issuanceOfDebt", label: "Debt issued" },
    { key: "repaymentOfDebt", label: "Debt repaid" },
    { key: "freeCashFlow", label: "Free cash flow", emphasis: true },
  ],
};

export const STATEMENT_MODULE: Record<Statement, "financials" | "balance-sheet" | "cash-flow"> = {
  income: "financials",
  balance: "balance-sheet",
  cashflow: "cash-flow",
};

/** How far back to ask: enough for the columns shown, no further. */
export function statementStart(period: StatementPeriod, now = new Date()): string {
  const years = period === "annual" ? 6 : 3;
  return new Date(Date.UTC(now.getUTCFullYear() - years, 0, 1)).toISOString().slice(0, 10);
}

const MAX_COLUMNS: Record<StatementPeriod, number> = { annual: 5, quarterly: 8 };

export function buildStatement(
  symbol: string,
  statement: Statement,
  period: StatementPeriod,
  rows: unknown,
): StatementView {
  const lines = STATEMENT_LINES[statement];
  const periods = (Array.isArray(rows) ? rows : [])
    .map((row) => record(row))
    .map((row) => ({ date: isoDate(row["date"]), row }))
    .filter((entry): entry is { date: string; row: Record<string, unknown> } => entry.date !== null)
    // A period the upstream padded in with no figures at all is not a column.
    .filter((entry) => lines.some((line) => num(entry.row[line.key]) !== null))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_COLUMNS[period]);

  const out: StatementRow[] = [];
  for (const line of lines) {
    const values = periods.map((entry) => num(entry.row[line.key]));
    if (values.every((value) => value === null)) continue;
    out.push({
      key: line.key,
      label: line.label,
      unit: line.unit ?? "money",
      values,
      emphasis: line.emphasis ?? false,
    });
  }

  return {
    symbol,
    statement,
    period,
    columns: periods.map((entry) => entry.date),
    rows: out,
  };
}
