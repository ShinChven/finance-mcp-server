import YahooFinance from "yahoo-finance2";

export type YahooFinanceClient = InstanceType<typeof YahooFinance>;

/**
 * Reuse one client so Yahoo cookies and the process-local request queue are
 * shared across stateless MCP requests.
 */
export const yahooFinanceClient: YahooFinanceClient = new YahooFinance({
  queue: { concurrency: 2, interval: 250 },
  suppressNotices: ["yahooSurvey"],
  versionCheck: false,
});
