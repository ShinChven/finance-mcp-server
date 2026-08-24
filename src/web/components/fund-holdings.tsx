/**
 * One fund's portfolio, and the on-demand fetch that fills it.
 *
 * Shared by the fund pages every signed-in user reaches and by the admin sync
 * console, because opening a fund means the same thing on both: it is reading
 * the cache, not managing it.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { completenessNote, PROVIDERS, TRAILING_PERIODS } from "../../shared/funds.js";
import { Modal } from "./modal.js";
import { EmptyState, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { formatPercent, formatRelative, signClass } from "../lib/format.js";
import type { FundHoldingsResult, TrailingReturns } from "../lib/types.js";

/**
 * Opening a fund that has never been synced fetches it there and then.
 *
 * This is why the fund pages need no administrator: a reader who opens one fund
 * gets it cached on the spot, in a couple of seconds, instead of being told to
 * ask someone to run a batch sync. The two are not the same act — this is a
 * handful of requests for a fund already named, de-duplicated and throttled
 * server-side, where a batch run walks a whole category for hours.
 *
 * The fetch is a POST (it has side effects and outbound cost), fired once per
 * open, and the holdings query is invalidated when it lands.
 */
export function HoldingsDialog({
  code,
  highlight,
  onClose,
}: {
  code: string;
  /** The list's search term, so the position that matched can be picked out. */
  highlight: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [triggered, setTriggered] = useState(false);

  const query = useQuery({
    queryKey: ["fund-holdings", code],
    queryFn: () => api<FundHoldingsResult>(`/api/funds/${code}/holdings`),
  });

  const cacheNow = useMutation({
    mutationFn: () => api<{ status: string; message: string }>(`/api/funds/${code}/cache`, { method: "POST" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["fund-holdings", code] });
      void queryClient.invalidateQueries({ queryKey: ["funds"] });
      void queryClient.invalidateQueries({ queryKey: ["fund-stats"] });
    },
  });

  // NAV counts as much as holdings here: the dialog now opens with a row of
  // trailing returns, and a fund whose NAV step never ran would show eight em
  // dashes with no way for the reader to ask for the data.
  const uncached =
    query.data !== undefined &&
    (query.data.fund.holdingsSyncedAt === null || query.data.fund.navSyncedAt === null);
  useEffect(() => {
    if (!uncached || triggered) return;
    setTriggered(true);
    cacheNow.mutate();
  }, [uncached, triggered]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title={query.data?.fund.name ?? code} onClose={onClose} size="xl">
      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{(query.error as Error).message}</p>
      ) : cacheNow.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
          <p className="mt-2 text-sm text-zinc-500">
            Not cached yet — fetching this fund's holdings and NAV now.
          </p>
          <p className="mt-1 text-xs text-zinc-400">Requests are throttled, so this takes a few seconds.</p>
        </div>
      ) : cacheNow.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {(cacheNow.error as Error).message}
        </p>
      ) : query.data ? (
        <FundHoldings result={query.data} highlight={highlight} />
      ) : null}
    </Modal>
  );
}

function FundHoldings({ result, highlight }: { result: FundHoldingsResult; highlight: string }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
        <span>
          Code <code className="text-zinc-700 dark:text-zinc-300">{result.fund.code}</code>
        </span>
        <span>{PROVIDERS[result.fund.provider]?.label ?? result.fund.provider}</span>
        {result.fund.company && <span>{result.fund.company}</span>}
        <span>Report {result.latestReport ?? "—"}</span>
        <span>Cached {formatRelative(result.fund.holdingsSyncedAt)}</span>
      </div>

      {/* Above the portfolio, and outside the empty case: a fund whose NAV is
          cached but whose positions are not still has a return to report, and
          it is the first thing anyone asks of a fund. */}
      <TrailingReturnsStrip returns={result.trailingReturns} />

      {result.items.length === 0 ? (
        <EmptyState
          title="No holdings cached for this fund"
          description={
            result.fund.lastSyncError
              ? `The last fetch failed: ${result.fund.lastSyncError}`
              : "This fund published no positions in its latest report."
          }
        />
      ) : (
        <HoldingsTable result={result} highlight={highlight} />
      )}
    </>
  );
}

/** The disclosed portfolio itself, once there is one to show. */
function HoldingsTable({ result, highlight }: { result: FundHoldingsResult; highlight: string }) {
  const full = result.fund.holdingsCompleteness === "full";
  const enriched = result.enrichedPositions;
  // A top-holdings list can run to hundreds of rows; without this the reader
  // has to scan for the stock that put the fund in the results in the first place.
  const needle = highlight.trim().toLowerCase();

  return (
    <>
      {/* What the disclosed weight means depends entirely on the source: ~62%
          is normal for a top-holdings discloser and alarming for a full one.
          The sentence follows the fund's own convention rather than assuming. */}
      <p className="mb-3 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500 dark:bg-zinc-800/50">
        {result.items.length} disclosed position{result.items.length === 1 ? "" : "s"} covering{" "}
        <span className="font-medium tabular-nums">{result.disclosedWeight.toFixed(1)}%</span> of net
        asset value. {completenessNote(result.fund.holdingsCompleteness)}
        {full && result.disclosedWeight < 90 && (
          <span className="text-amber-600 dark:text-amber-400">
            {" "}
            The shortfall here is unexpected for a full-portfolio source — some rows may have failed
            to parse.
          </span>
        )}
      </p>

      {enriched < result.items.length && (
        <p className="mb-3 text-xs text-zinc-400">
          {enriched} of {result.items.length} positions have been matched against Yahoo. The rest
          show no country or size yet and are excluded from any market-cap filter — enrichment
          catches up on the next sync.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Country</th>
              <th className="px-3 py-2 text-right font-medium">Market cap</th>
              <th className="px-3 py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((holding) => {
              const matched =
                needle.length > 0 &&
                (holding.symbol.toLowerCase().includes(needle) ||
                  (holding.name?.toLowerCase().includes(needle) ?? false));
              return (
                <tr
                  key={holding.symbol}
                  className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                    matched ? "bg-emerald-50 dark:bg-emerald-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs" title={holding.isin ?? undefined}>
                    {holding.symbol}
                  </td>
                  <td className="px-3 py-2">{holding.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{holding.country ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-zinc-500">
                    {formatUsdCompact(holding.marketCapUsd)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      matched ? "font-medium text-emerald-700 dark:text-emerald-400" : ""
                    }`}
                  >
                    {holding.weight.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * What the fund has returned over each standard window.
 *
 * The holdings table says what a fund owns, never how it has done, and the two
 * are read together — a sector bet is judged by what it returned. Each cell
 * names the window it actually measured in its tooltip, because a 1Y figure
 * anchored 361 days back is the honest answer for a fund whose NAV was not
 * published on the anniversary, and a reader comparing funds needs to see when
 * one of them is measured over a stale gap.
 */
function TrailingReturnsStrip({ returns }: { returns: TrailingReturns | null }) {
  if (returns === null) {
    return (
      <p className="mb-3 text-xs text-zinc-400">
        No NAV history is cached for this fund, so its returns cannot be measured.
      </p>
    );
  }

  // Keyed by period so the row can render every window in the shared order and
  // show an em dash for the ones a young fund cannot reach back to — a missing
  // 5Y is absent history, not a zero.
  const measured = new Map(returns.periods.map((entry) => [entry.period, entry]));

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      {/* Four across in two rows until the dialog is wide enough for eight
          columns to hold a figure like +126.40% without clipping it — the row
          must never make the modal scroll sideways to reach the 5Y number. The
          rules are the grid's own gap showing through, not `divide-*`, which
          draws its borders in DOM order and would strand a vertical rule down
          the left of the second row. */}
      <div className="grid grid-cols-4 gap-px bg-zinc-200 md:grid-cols-8 dark:bg-zinc-800">
        {TRAILING_PERIODS.map((period) => {
          const entry = measured.get(period.id);
          return (
            <div
              key={period.id}
              className="bg-white px-1 py-2 text-center sm:px-2 dark:bg-zinc-900"
              title={
                entry
                  ? `${period.title}: ${entry.from} → ${entry.to} (${entry.days} days)` +
                    (entry.annualizedPercent === null
                      ? ""
                      : ` · ${formatPercent(entry.annualizedPercent)} a year`)
                  : `${period.title}: the cached NAV history does not reach back this far`
              }
            >
              <div className="text-[11px] font-medium text-zinc-500 uppercase">{period.label}</div>
              <div
                // A step down on a phone: four columns across a 375px screen
                // leave ~75px a cell, and a long-lived fund's since-inception
                // figure runs to four digits before the decimal point.
                className={`text-xs tabular-nums sm:text-sm ${
                  entry ? signClass(entry.returnPercent) : "text-zinc-400"
                }`}
              >
                {entry ? formatPercent(entry.returnPercent) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Which NAV the figures came from, stated rather than assumed: unit NAV
          drops on every distribution, so a long window measured from it is
          understated by exactly the dividends the fund paid. */}
      <p className="border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        NAV through {returns.asOf}.{" "}
        {returns.basis === "accNav"
          ? "Measured from cumulative NAV, so distributions count as return rather than as a loss."
          : "Measured from unit NAV because no cumulative NAV is cached — distributions are excluded, so the longer windows understate the fund."}
      </p>
    </div>
  );
}

/**
 * Market caps are USD-converted so they can be read down a column that mixes
 * markets, and abbreviated because the exact figure is a weekly snapshot —
 * printing it to the dollar would imply a precision it does not have.
 */
function formatUsdCompact(value: number | null): string {
  if (value === null) return "—";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) return `$${(value / size).toFixed(value / size >= 100 ? 0 : 1)}${suffix}`;
  }
  return `$${Math.round(value).toLocaleString()}`;
}
