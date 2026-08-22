/**
 * The fund list's columns, shared by the two pages that show funds.
 *
 * The Funds page and the admin sync console list the same rows for different
 * reasons, and the difference is one column: an operator needs to see that a
 * fund's last sync failed, because fixing it is their job. A reader cannot act
 * on that — opening the fund re-fetches it anyway — so `showSyncErrors` is the
 * only thing that varies, and everything else stays one definition.
 */

import { AlertTriangle } from "lucide-react";
import type { Column } from "./table.js";
import { Badge } from "./ui.js";
import { formatDate, formatRelative } from "../lib/format.js";
import type { useListParams } from "../lib/params.js";
import type { FundItem } from "../lib/types.js";

export interface FundColumnOptions {
  /** Show a failed sync in the "Cached" column instead of the plain watermark. */
  showSyncErrors?: boolean;
}

type ListParams = ReturnType<typeof useListParams>;

export function fundColumns(
  params: Pick<ListParams, "update">,
  options: FundColumnOptions = {},
): Column<FundItem>[] {
  const open = (code: string) => params.update({ fund: code });

  return [
    {
      key: "code",
      label: "Code",
      sortable: true,
      render: (fund) => (
        <button
          onClick={() => open(fund.code)}
          className="cursor-pointer font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {fund.code}
        </button>
      ),
    },
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (fund) => (
        <div className="min-w-0">
          <button
            onClick={() => open(fund.code)}
            className="block max-w-80 cursor-pointer truncate text-left hover:underline"
            title={fund.name}
          >
            {fund.name}
          </button>
          {fund.matchedHolding ? (
            // Says why this row matched — a search for "NVDA" otherwise returns
            // a page of fund names with no visible connection to it.
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              holds {fund.matchedHolding.symbol}
              {fund.matchedHolding.name ? ` ${fund.matchedHolding.name}` : ""} ·{" "}
              {fund.matchedHolding.weight.toFixed(2)}%
            </span>
          ) : (
            fund.trackingIndex && (
              <span className="text-xs text-zinc-400">tracks {fund.trackingIndex}</span>
            )
          )}
        </div>
      ),
    },
    {
      // Which market a fund trades in decides whether a reader can buy it at
      // all, so it earns a column rather than living in the drill-down.
      key: "market",
      label: "Market",
      render: (fund) => (
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {fund.market}
          </span>
          {fund.investsOffshore && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              title="Mandate points outside its own market"
            >
              offshore
            </span>
          )}
        </div>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (fund) => <span className="text-xs text-zinc-500">{fund.fundType ?? "—"}</span>,
    },
    {
      key: "holdings",
      label: "Holdings",
      align: "right",
      render: (fund) =>
        fund.holdingsCount > 0 ? (
          <span className="tabular-nums">{fund.holdingsCount}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      key: "report",
      label: "Report",
      align: "right",
      render: (fund) =>
        fund.latestReport ? (
          // The disclosure date, not the cache date: a fund synced this morning
          // that last reported in 2023 is still showing 2023 data.
          <span className="text-xs tabular-nums text-zinc-500">{fund.latestReport}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      key: "holdings_synced_at",
      label: "Cached",
      sortable: true,
      align: "right",
      render: (fund) =>
        options.showSyncErrors === true && fund.lastSyncError ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
            title={fund.lastSyncError}
          >
            <AlertTriangle className="size-3.5" /> failed
          </span>
        ) : fund.holdingsSyncedAt ? (
          <span className="text-xs text-zinc-500" title={formatDate(fund.holdingsSyncedAt)}>
            {formatRelative(fund.holdingsSyncedAt)}
          </span>
        ) : (
          <Badge value="expired" label="not cached" />
        ),
    },
  ];
}
