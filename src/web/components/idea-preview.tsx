/**
 * Look before you track.
 *
 * A discovery page whose only verb is "add" makes the reader commit to a row
 * they have seen four fields of. This is the pane that answers "what is this,
 * actually" — priced now, charted over the same windows the watchlist uses, and
 * with the star right there once they have decided. It opens beside the list
 * rather than over it, so the next row is one click away instead of a close
 * and a click.
 *
 * It deliberately renders the *same* components a tracked item renders:
 * `QuoteStatsPanel` and `PriceChart` for an instrument, `FundDetail` for a
 * fund. A preview that drew its own lighter version of those would be a second
 * rendering of the same instrument that could disagree with the first, and the
 * disagreement would show up exactly when someone was deciding.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { symbolPath } from "../../shared/symbol.js";
import { DEFAULT_SERIES_RANGE, isSeriesRange, type SeriesRangeId } from "../../shared/series.js";
import type { DiscoverIdea, TrackedIn } from "../../shared/discover.js";
import type { DirectionPalette } from "../../shared/preferences.js";
import type { WatchlistItemKind } from "../../shared/watchlist.js";
import { api } from "../lib/api.js";
import { formatPercent, formatRelative, signClass } from "../lib/format.js";
import type { LiveValue, WatchlistItem } from "../lib/types.js";
import type { PriceSeries } from "../../shared/series.js";
import { FundDetail } from "./fund-holdings.js";
import { formatIdeaPrice, TrackButton } from "./ideas.js";
import { QuoteStatsPanel } from "./instrument-stats.js";
import { PriceChart } from "./price-chart.js";
import { SidePanel } from "./side-panel.js";
import { Skeleton } from "./ui.js";

interface PreviewResult {
  item: { kind: WatchlistItemKind; ref: string; name: string | null };
  live: LiveValue | null;
  series: PriceSeries | null;
  /** The reader's lists that already hold this, so the star agrees with the row. */
  tracked: TrackedIn[];
}

/**
 * The chart wants a watchlist item; nothing here is on a watchlist.
 *
 * Rather than teach `PriceChart` a second mode, an untracked instrument is
 * described as what it would be if it were tracked: no levels, no entry price,
 * nothing hit. Every one of those fields is genuinely empty for a row nobody
 * has tracked yet, so this is the honest shape rather than a stub.
 */
function asItem(preview: PreviewResult): WatchlistItem {
  return {
    id: `preview-${preview.item.kind}-${preview.item.ref}`,
    kind: preview.item.kind,
    ref: preview.item.ref,
    name: preview.item.name,
    note: null,
    entryPrice: null,
    entryAt: null,
    currency: preview.live?.currency ?? null,
    sinceEntryPercent: null,
    levels: [],
    nearest: { above: null, below: null },
    addedAt: new Date().toISOString(),
    live: preview.live ?? {
      basis: preview.item.kind === "fund" ? "nav" : "market",
      price: null,
      change: null,
      changePercent: null,
      currency: null,
      marketState: null,
      asOf: null,
      available: false,
      checkedAt: null,
      stale: false,
      stats: null,
      extended: null,
      returns: null,
    },
    spark: null,
  };
}

export function IdeaPreview({
  kind,
  /** Named in full rather than `ref`, which React still treats as special. */
  instrumentRef,
  range,
  palette,
  onRange,
  onClose,
}: {
  kind: WatchlistItemKind;
  instrumentRef: string;
  range: string;
  palette: DirectionPalette;
  onRange: (next: SeriesRangeId) => void;
  onClose: () => void;
}) {
  const usable: SeriesRangeId = isSeriesRange(range) ? range : DEFAULT_SERIES_RANGE;

  const query = useQuery({
    queryKey: ["discover", "preview", kind, instrumentRef, usable],
    queryFn: () =>
      api<PreviewResult>(
        `/api/discover/preview?kind=${kind}&ref=${encodeURIComponent(instrumentRef)}&range=${usable}`,
      ),
    // A new range is the same instrument redrawn, so the price and statistics
    // stay up while only the chart waits. A new instrument starts clean: its
    // predecessor's numbers under its name would be worse than a skeleton.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === kind && previousQuery.queryKey[3] === instrumentRef
        ? previous
        : undefined,
  });

  const preview = query.data;
  const live = preview?.live ?? null;

  // Enough of an idea to draw the star: the address, what it is worth, and
  // which lists already hold it — the last of which the endpoint reports so
  // this star and the row it was opened from can never disagree.
  const idea: DiscoverIdea = {
    kind,
    ref: instrumentRef,
    name: preview?.item.name ?? null,
    exchange: null,
    quoteType: null,
    currency: live?.currency ?? null,
    price: live?.price ?? null,
    changePercent: live?.changePercent ?? null,
    source: "search",
    tracked: preview?.tracked ?? [],
  };

  return (
    <SidePanel
      title={instrumentRef}
      subtitle={preview === undefined ? undefined : (preview.item.name ?? "Unnamed")}
      onClose={onClose}
      scrollKey={`${kind}:${instrumentRef}`}
    >
      {query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{(query.error as Error).message}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {preview === undefined ? (
            <QuoteHeaderSkeleton />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatIdeaPrice(live?.price ?? null, live?.currency ?? null)}
                  </span>
                  <span className={`text-sm tabular-nums ${signClass(live?.changePercent)}`}>
                    {live?.changePercent === null || live?.changePercent === undefined
                      ? ""
                      : formatPercent(live.changePercent)}
                  </span>
                </div>
                <div className="text-xs text-zinc-400">
                  {live?.available === false
                    ? (live.unavailableReason ?? "No price available.")
                    : `${live?.basis === "nav" ? "NAV" : "Quote"} · ${formatRelative(live?.asOf)}`}
                </div>
                {kind === "symbol" && (
                  <Link
                    to={symbolPath(instrumentRef)}
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Full page <ArrowUpRight className="size-3.5" />
                  </Link>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-sm text-zinc-500">Track it</span>
                {/* Aligned to the right, unlike the inline star elsewhere: this
                    one sits against the panel's edge, and a menu that opened
                    rightwards from it would open off the screen. */}
                <TrackButton idea={idea} />
              </div>
            </div>
          )}

          {/* A fund's own page already shows its NAV chart, trailing returns and
              portfolio — the three things worth previewing — so it is shown
              whole rather than partially rebuilt here. It fetches on its own,
              so it starts loading alongside the quote rather than after it. */}
          {kind === "fund" ? (
            <FundDetail code={instrumentRef} />
          ) : preview === undefined ? (
            <>
              <Skeleton className="h-40" />
              <StatsSkeleton />
            </>
          ) : (
            <>
              <PriceChart
                item={asItem(preview)}
                series={preview.series}
                range={usable}
                onRange={onRange}
                pending={query.isPlaceholderData}
                palette={palette}
              />
              <QuoteStatsPanel
                stats={live?.stats ?? null}
                extended={live?.extended ?? null}
                returns={live?.returns ?? null}
                price={live?.price ?? null}
              />
            </>
          )}
        </div>
      )}
    </SidePanel>
  );
}

/** The price block's shape — a figure, its change, its timestamp — and the star. */
function QuoteHeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

/** The two range meters and the tile grid, as `QuoteStatsPanel` lays them out. */
function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((meter) => (
        <div key={meter} className="flex flex-col gap-1.5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
