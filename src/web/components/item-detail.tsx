/**
 * The pane beside the table: one item, in as much depth as the sources allow.
 *
 * Tabbed rather than stacked because the four things a reader wants here answer
 * different questions and only one is wanted at a time — and because only the
 * active tab fetches. Opening an item would otherwise fire a series request, a
 * profile request and a news request at once, behind a queue two deep, to fill
 * three panels of which two are not being looked at.
 *
 * Which tab is open lives in `?tab=`, like every other piece of page state, so
 * a link to an item at 5Y with its levels showing reproduces exactly that.
 */

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  DEFAULT_SERIES_RANGE,
  isSeriesRange,
  type SeriesRangeId,
} from "../../shared/series.js";
import { api } from "../lib/api.js";
import type { LevelDraft, LevelPatch } from "../lib/levels.js";
import type { SeriesResult, WatchlistItem } from "../lib/types.js";
import { Card } from "./ui.js";
import { QuoteStatsPanel } from "./instrument-stats.js";
import { LevelsPanel, PriceRail } from "./price-levels.js";
import { PriceChart } from "./price-chart.js";

export type DetailTab = "chart" | "levels" | "stats";

const TABS: { id: DetailTab; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "levels", label: "Levels" },
  { id: "stats", label: "Stats" },
];

export function ItemDetail({
  item,
  listId,
  tab,
  range,
  busy,
  onTab,
  onRange,
  onAddLevels,
  onUpdateLevel,
  onRemoveLevel,
  onClose,
}: {
  item: WatchlistItem;
  listId: string;
  tab: DetailTab;
  range: SeriesRangeId;
  busy: boolean;
  onTab: (next: DetailTab) => void;
  onRange: (next: SeriesRangeId) => void;
  onAddLevels: (levels: LevelDraft[]) => void;
  onUpdateLevel: (levelId: string, patch: LevelPatch) => void;
  onRemoveLevel: (levelId: string) => void;
  onClose: () => void;
}) {
  const usableRange: SeriesRangeId = isSeriesRange(range) ? range : DEFAULT_SERIES_RANGE;

  const series = useQuery({
    queryKey: ["item-series", listId, item.id, usableRange],
    queryFn: () =>
      api<SeriesResult>(
        `/api/watchlists/${listId}/items/${item.id}/series?range=${usableRange}`,
      ),
    // Only while the chart is the tab being looked at.
    enabled: tab === "chart",
    // Deliberately no refetch interval: bars change once a day, and inheriting
    // the list's minute-by-minute refresh would turn one open chart into a
    // standing request against a throttled upstream.
    staleTime: 5 * 60 * 1_000,
    retry: false,
  });

  return (
    <Card className="h-fit p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium">{item.ref}</div>
          {item.name && <div className="truncate text-xs text-zinc-400">{item.name}</div>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close item detail"
          className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label={`${item.ref} detail`}
        className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={entry.id === tab}
            onClick={() => onTab(entry.id)}
            className={`cursor-pointer border-b-2 px-3 py-1.5 text-xs transition-colors ${
              entry.id === tab
                ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "chart" && (
        <>
          {series.isError ? (
            <p className="py-6 text-center text-xs text-amber-600 dark:text-amber-400">
              {(series.error as Error).message}
            </p>
          ) : (
            <PriceChart
              item={item}
              series={series.data?.series ?? null}
              range={usableRange}
              onRange={onRange}
              pending={series.isPending}
            />
          )}
          <div className="mt-3">
            <PriceRail item={item} tall />
          </div>
        </>
      )}

      {tab === "levels" && (
        <LevelsPanel
          item={item}
          busy={busy}
          onAdd={onAddLevels}
          onUpdate={onUpdateLevel}
          onRemove={onRemoveLevel}
        />
      )}

      {tab === "stats" && (
        <QuoteStatsPanel
          stats={item.live.stats}
          extended={item.live.extended}
          returns={item.live.returns}
          price={item.live.price}
        />
      )}
    </Card>
  );
}
