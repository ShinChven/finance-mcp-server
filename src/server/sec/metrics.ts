/**
 * The curated slice of us-gaap we expose.
 *
 * XBRL has ~500 concepts per filer and no stable cross-company naming, so a
 * fixed catalogue with per-metric alias lists is what makes `secFinancials`
 * comparable across companies. Aliases are ordered: the first concept a filer
 * actually reports wins.
 */

export type MetricKind = "duration" | "instant";

export interface MetricDef {
  /** Stable key we return, independent of which alias the filer used. */
  key: string;
  label: string;
  /** us-gaap concepts in priority order. */
  concepts: readonly string[];
  /** XBRL unit to read out of `units`. */
  unit: string;
  /**
   * `duration` facts carry start+end and are classified by span length;
   * `instant` facts are balance-sheet snapshots with only an end date.
   */
  kind: MetricKind;
}

export const METRIC_DEFS: readonly MetricDef[] = [
  {
    key: "revenue",
    label: "Revenue",
    // ASC 606 renamed this in 2018; older filings still only have Revenues.
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "costOfRevenue",
    label: "Cost of revenue",
    concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "grossProfit",
    label: "Gross profit",
    concepts: ["GrossProfit"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "researchAndDevelopment",
    label: "R&D expense",
    concepts: ["ResearchAndDevelopmentExpense"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "operatingIncome",
    label: "Operating income",
    concepts: ["OperatingIncomeLoss"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "netIncome",
    label: "Net income",
    concepts: ["NetIncomeLoss", "ProfitLoss"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "epsBasic",
    label: "EPS (basic)",
    concepts: ["EarningsPerShareBasic"],
    unit: "USD/shares",
    kind: "duration",
  },
  {
    key: "epsDiluted",
    label: "EPS (diluted)",
    concepts: ["EarningsPerShareDiluted"],
    unit: "USD/shares",
    kind: "duration",
  },
  {
    key: "dilutedShares",
    label: "Weighted average diluted shares",
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    unit: "shares",
    kind: "duration",
  },
  {
    key: "operatingCashFlow",
    label: "Operating cash flow",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "capitalExpenditures",
    label: "Capital expenditures",
    concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"],
    unit: "USD",
    kind: "duration",
  },
  {
    key: "assets",
    label: "Total assets",
    concepts: ["Assets"],
    unit: "USD",
    kind: "instant",
  },
  {
    key: "liabilities",
    label: "Total liabilities",
    concepts: ["Liabilities"],
    unit: "USD",
    kind: "instant",
  },
  {
    key: "stockholdersEquity",
    label: "Stockholders equity",
    concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    unit: "USD",
    kind: "instant",
  },
  {
    key: "cashAndEquivalents",
    label: "Cash and equivalents",
    concepts: ["CashAndCashEquivalentsAtCarryingValue"],
    unit: "USD",
    kind: "instant",
  },
  {
    key: "longTermDebt",
    label: "Long-term debt (noncurrent)",
    concepts: ["LongTermDebtNoncurrent", "LongTermDebt"],
    unit: "USD",
    kind: "instant",
  },
] as const;

export const METRIC_KEYS = METRIC_DEFS.map((def) => def.key) as [string, ...string[]];
