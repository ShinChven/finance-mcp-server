/**
 * Look before you track.
 *
 * A discovery page whose only verb is "add" makes the reader commit to a row
 * they have seen four fields of. This is the pane that answers "what is this,
 * actually" — priced now, charted over the same windows the watchlist uses, and
 * with the star right there once they have decided.
 *
 * It deliberately renders the *same* components a tracked item renders:
 * `QuoteStatsPanel` and `PriceChart` for an instrument, `FundDetail` for a
 * fund. A preview that drew its own lighter version of those would be a second
 * rendering of the same instrument that could disagree with the first, and the
 * disagreement would show up exactly when someone was deciding.
 */

import { useQuery } from "@tanstack/react-query";
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
import { Modal } from "./modal.js";
import { PriceChart } from "./price-chart.js";
import { Spinner } from "./ui.js";

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
    <Modal title={instrumentRef} onClose={onClose} size="xl">
      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{(query.error as Error).message}</p>
      ) : preview === undefined ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {preview.item.name ?? "Unnamed"}
              </div>
              <div className="flex items-baseline gap-2">
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
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Track it</span>
              <TrackButton idea={idea} compact />
            </div>
          </div>

          {/* A fund's own page already shows its NAV chart, trailing returns and
              portfolio — the three things worth previewing — so it is shown
              whole rather than partially rebuilt here. */}
          {kind === "fund" ? (
            <FundDetail code={instrumentRef} />
          ) : (
            <>
              <PriceChart
                item={asItem(preview)}
                series={preview.series}
                range={usable}
                onRange={onRange}
                pending={query.isFetching}
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
    </Modal>
  );
}
