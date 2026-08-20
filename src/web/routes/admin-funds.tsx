import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, Layers, RefreshCw, X } from "lucide-react";
import {
  completenessNote,
  PROVIDERS,
  scopeLabel,
  selectableScopes,
  type ProviderId,
} from "../../shared/funds.js";
import { Modal } from "../components/modal.js";
import { DataTable, FilterPills, SearchInput, type Column } from "../components/table.js";
import { useToast } from "../components/toast.js";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui.js";
import { api, ApiError } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type {
  FundCacheStats,
  FundHoldingsResult,
  FundItem,
  IngestJobItem,
  JobsResult,
  ListResult,
  ProviderStats,
  SyncPreview,
} from "../lib/types.js";
import { useMe } from "./shell.js";

const CACHE_DESCRIPTION =
  "Holdings are downloaded here so the stock- and sector-level tools can answer. Every source serves fund → holdings only, so the reverse lookups exist for the funds cached below — across all markets at once.";

const STATUS_FILTERS = [
  { value: "cached", label: "Cached" },
  { value: "uncached", label: "Not cached" },
  { value: "failing", label: "Failing" },
];

/** Every category a sync can be started for, flattened across providers. */
interface Category {
  provider: ProviderId;
  scope: string;
  label: string;
}

function isJobActive(job: IngestJobItem | undefined): boolean {
  return job?.status === "running" || job?.status === "queued";
}

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

/**
 * The fund cache console.
 *
 * Admin-only, and admin-only on the server too: a category sync is hours of
 * outbound requests against hosts that rate limit, and the cache it fills is
 * shared by every user. Ordinary accounts never manage it — they read what it
 * produced, through the MCP fund tools and the watchlist pages.
 */
export default function AdminFundsPage() {
  const me = useMe();
  if (me.role !== "admin") {
    return (
      <>
        <PageHeader title="Fund Cache" description={CACHE_DESCRIPTION} />
        <EmptyState
          title="Admins only"
          description="Filling the fund cache is an administrator task. The data it produces is available to you through the fund tools over MCP and on your watchlists."
        />
      </>
    );
  }
  return <FundCacheConsole />;
}

function FundCacheConsole() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useListParams({ per_page: me.preferences.pageSize });
  const [pending, setPending] = useState<Category | null>(null);

  const stats = useQuery({
    queryKey: ["fund-stats"],
    queryFn: () => api<FundCacheStats>("/api/funds/stats"),
  });

  const jobs = useQuery({
    queryKey: ["sync-jobs"],
    queryFn: () => api<JobsResult>("/api/sync/jobs"),
    // Only poll while something is actually running.
    refetchInterval: (query) => (isJobActive(query.state.data?.items[0]) ? 3000 : false),
  });

  const list = useQuery({
    queryKey: ["funds", params.apiQuery],
    queryFn: () => api<ListResult<FundItem>>(`/api/funds?${params.apiQuery}`),
  });

  const current = jobs.data?.items[0];
  const running = isJobActive(current);
  const selectedProvider = isProviderId(params.provider) ? params.provider : null;

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/sync/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast("success", "Sync will stop after the current fund.");
      void queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const columns: Column<FundItem>[] = [
    {
      key: "code",
      label: "Code",
      sortable: true,
      render: (fund) => (
        <button
          onClick={() => params.update({ fund: fund.code })}
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
            onClick={() => params.update({ fund: fund.code })}
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
        fund.lastSyncError ? (
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

  return (
    <>
      <PageHeader title="Fund Cache" description={CACHE_DESCRIPTION} />

      <StatTiles stats={stats.data} />

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Cache a category</h2>
        </div>

        {running && current ? (
          <ActiveJob job={current} onCancel={() => cancel.mutate(current.id)} busy={cancel.isPending} />
        ) : (
          <div className="space-y-4">
            {(stats.data?.providers ?? []).map((provider) => (
              <ProviderCategories key={provider.id} provider={provider} onPick={setPending} />
            ))}
          </div>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search code, name, or holding symbol (e.g. NVDA)…" />
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            params={params}
            paramKey="provider"
            clears={["scope"]}
            options={(stats.data?.providers ?? []).map((provider) => ({
              value: provider.id,
              label: provider.label,
            }))}
          />
          {/* A scope only narrows within one provider, so the pills appear only
              once a provider is chosen — and reset with it. */}
          {selectedProvider && (
            <FilterPills
              params={params}
              paramKey="scope"
              options={selectableScopes(selectedProvider)
                .filter((scope) => scope.id !== "all")
                .map((scope) => ({ value: scope.id, label: scope.label }))}
            />
          )}
          <FilterPills params={params} paramKey="status" options={STATUS_FILTERS} />
        </div>
      </div>

      {/* A search that matched on holdings returns fund names with nothing in
          them resembling the query, so the page states what it is filtered by
          — and offers the way out, which the pills already have and `q` did not. */}
      {params.q && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
          <span className="text-zinc-600 dark:text-zinc-300">
            Showing funds matching{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">"{params.q}"</span> ·{" "}
            {list.data?.total ?? 0} {list.data?.total === 1 ? "fund" : "funds"}
          </span>
          <button
            type="button"
            onClick={() => params.update({ q: "" })}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 font-medium text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
          >
            <X className="size-3" /> Clear search
          </button>
        </div>
      )}

      <DataTable
        params={params}
        columns={columns}
        rows={list.data?.items}
        rowKey={(fund) => fund.code}
        onRowClick={(fund) => params.update({ fund: fund.code })}
        loading={list.isPending}
        empty={{
          title: "No funds match",
          // The old copy always blamed an unpopulated index, which is wrong
          // advice once funds are cached and reads as a failed sync.
          description: params.q
            ? "Search covers fund code, name, company, tracking index, and the current holdings of cached funds — a stock symbol only matches funds whose portfolio has been cached."
            : "Cache a category above to populate the fund index, or clear the filters.",
        }}
        total={list.data?.total ?? 0}
        totalPages={list.data?.total_pages ?? 1}
      />

      <JobHistory jobs={jobs.data?.items ?? []} />

      {pending && (
        <SyncConfirm
          category={pending}
          onClose={() => setPending(null)}
          onStarted={() => {
            setPending(null);
            void queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
          }}
        />
      )}

      {params.fund && (
        <HoldingsDialog
          code={params.fund}
          highlight={params.q}
          onClose={() => params.update({ fund: "" })}
        />
      )}
    </>
  );
}

/**
 * One provider's category buttons.
 *
 * Grouped by provider rather than pooled into one grid because the scope names
 * only mean something next to their source: both providers offer "equity", and
 * a flat list would put two different populations under one label.
 */
function ProviderCategories({
  provider,
  onPick,
}: {
  provider: ProviderStats;
  onPick: (category: Category) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{provider.label}</h3>
        <span className="font-mono text-xs text-zinc-400">{provider.domicile}</span>
        <span className="text-xs text-zinc-400">
          {provider.completeness === "full" ? "full portfolio" : "top holdings only"}
        </span>
        <span className="text-xs text-zinc-400" title={formatDate(provider.index.syncedAt)}>
          index: {provider.index.funds.toLocaleString()} funds
          {provider.index.syncedAt === null ? "" : `, ${formatRelative(provider.index.syncedAt)}`}
        </span>
      </div>
      {/* The listing is what every count on this card is a count of, so its
          failure belongs here rather than in a log: a provider whose screener
          is blocked otherwise reads as a source with nothing in it, and the
          category buttons below quietly cache nothing forever. */}
      {provider.index.lastError !== null && (
        <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
          Fund index refresh failed: {provider.index.lastError}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {selectableScopes(provider.id).map((scope) => {
          const coverage = provider.byScope[scope.id];
          return (
            <button
              key={scope.id}
              onClick={() => onPick({ provider: provider.id, scope: scope.id, label: scope.label })}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-zinc-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/5"
            >
              <Download className="mt-0.5 size-4 shrink-0 text-indigo-500" />
              <div className="min-w-0">
                <div className="text-sm font-medium">{scope.label}</div>
                {coverage && (
                  <div className="mt-1 text-xs tabular-nums text-zinc-400">
                    {coverage.cached.toLocaleString()} of {coverage.total.toLocaleString()} cached
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatTiles({ stats }: { stats: FundCacheStats | undefined }) {
  const tiles = [
    {
      icon: Database,
      label: "Funds cached",
      value: stats ? `${stats.funds.cached.toLocaleString()} / ${stats.funds.total.toLocaleString()}` : "—",
    },
    { icon: Layers, label: "Holdings rows", value: stats?.holdings.rows.toLocaleString() ?? "—" },
    { icon: Layers, label: "Distinct stocks", value: stats?.holdings.symbols.toLocaleString() ?? "—" },
    { icon: RefreshCw, label: "Latest report", value: stats?.holdings.latestReport ?? "—" },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <tile.icon className="size-3.5" /> {tile.label}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{tile.value}</div>
        </Card>
      ))}
    </div>
  );
}

function jobTitle(job: IngestJobItem): string {
  return `${PROVIDERS[job.provider]?.label ?? job.provider} · ${scopeLabel(job.provider, job.scope)}`;
}

function ActiveJob({
  job,
  onCancel,
  busy,
}: {
  job: IngestJobItem;
  onCancel: () => void;
  busy: boolean;
}) {
  const percent = job.totalFunds > 0 ? Math.round((job.processedFunds / job.totalFunds) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{jobTitle(job)}</span> sync running —{" "}
          <span className="tabular-nums">
            {job.processedFunds.toLocaleString()} / {job.totalFunds.toLocaleString()}
          </span>{" "}
          steps
        </div>
        <Button variant="secondary" size="sm" busy={busy} onClick={onCancel}>
          <X className="size-3.5" /> Stop
        </Button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Started {formatRelative(job.startedAt)}. Requests are throttled, so this runs for a while —
        you can leave the page.
      </p>
    </div>
  );
}

/**
 * The confirmation step: nothing is fetched until the user has seen how many
 * funds a category actually means and how long it will take.
 */
function SyncConfirm({
  category,
  onClose,
  onStarted,
}: {
  category: Category;
  onClose: () => void;
  onStarted: () => void;
}) {
  const toast = useToast();
  const [force, setForce] = useState(false);
  const { provider, scope } = category;

  const preview = useQuery({
    queryKey: ["sync-preview", provider, scope, force],
    queryFn: () =>
      api<SyncPreview>(`/api/sync/preview?provider=${provider}&scope=${scope}&force=${force}`),
  });

  const start = useMutation({
    // `limit: null` is explicit rather than omitted: the preview above prices
    // the entire scope, so the run must not be capped behind the user's back.
    mutationFn: () =>
      api<IngestJobItem>("/api/sync", {
        method: "POST",
        body: { provider, scope, force, limit: null },
      }),
    onSuccess: () => {
      toast("success", "Sync started.");
      onStarted();
    },
    onError: (error: Error) => {
      toast("error", error instanceof ApiError && error.status === 409 ? "A sync is already running." : error.message);
    },
  });

  const data = preview.data;

  return (
    <Modal title={`Cache ${category.label} — ${PROVIDERS[provider].label}`} onClose={onClose}>
      {preview.isPending ? (
        <Spinner />
      ) : preview.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not work out what this would fetch: {(preview.error as Error).message}
        </p>
      ) : data ? (
        <>
          <dl className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            <Row label="Funds in this category" value={data.matched.toLocaleString()} />
            <Row label="Already cached and fresh" value={data.fresh.toLocaleString()} />
            <Row label="Will be fetched" value={data.toFetch.toLocaleString()} emphasis />
            <Row label="Upstream requests" value={data.estimatedRequests.toLocaleString()} />
            <Row
              label="Estimated time"
              value={data.estimatedMinutes < 1 ? "under a minute" : `about ${data.estimatedMinutes} min`}
            />
          </dl>

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Refetch everything
              <span className="block text-xs text-zinc-500">
                Ignores the freshness windows and re-downloads funds that are already up to date.
              </span>
            </span>
          </label>

          {/* `toFetch === 0` has two causes and only one of them means "done".
              An empty fund index matches no candidates either, and the run is
              what seeds it, so the counts above are unknowable until it has. */}
          {data.matched === 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              The fund index for {PROVIDERS[provider].label} has not been downloaded yet, so there is
              nothing here to count. This run fetches the index first — one request — and then caches
              what falls in this category. The figures above will be meaningful next time.
            </p>
          ) : data.toFetch === 0 && !force ? (
            <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              Everything in this category is already cached and fresh. There is nothing to fetch.
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              busy={start.isPending}
              disabled={data.toFetch === 0 && !force}
              onClick={() => start.mutate()}
            >
              Start sync
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`tabular-nums ${emphasis ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * Opening a fund that has never been synced fetches it there and then.
 *
 * Asking someone to go run a category sync for the one fund they just clicked
 * is busywork the server can do in a couple of seconds. The fetch is a POST
 * (it has side effects and outbound cost), fired once per open, and the
 * holdings query is invalidated when it lands.
 */
function HoldingsDialog({
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

  const uncached = query.data?.fund.holdingsSyncedAt === null;
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
  if (result.items.length === 0) {
    return (
      <EmptyState
        title="No holdings cached for this fund"
        description={
          result.fund.lastSyncError
            ? `The last sync failed: ${result.fund.lastSyncError}`
            : "Run a sync covering this fund to download its portfolio."
        }
      />
    );
  }

  const full = result.fund.holdingsCompleteness === "full";
  const enriched = result.enrichedPositions;
  // A top-holdings list can run to hundreds of rows; without this the reader
  // has to scan for the stock that put the fund in the results in the first place.
  const needle = highlight.trim().toLowerCase();

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

function JobHistory({ jobs }: { jobs: IngestJobItem[] }) {
  const finished = jobs.filter((job) => !isJobActive(job));
  if (finished.length === 0) return null;

  return (
    <Card className="mt-4 p-4">
      <h2 className="mb-3 text-sm font-medium">Recent syncs</h2>
      <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {finished.slice(0, 8).map((job) => {
          const dropped = job.summary?.holdingsDropped ?? 0;
          const errors = job.summary?.errors?.length ?? 0;
          return (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <span className="font-medium">{jobTitle(job)}</span>
                <span className="ml-2 text-xs text-zinc-400">{formatDate(job.finishedAt ?? job.createdAt)}</span>
                {job.error && <div className="text-xs text-red-500">{job.error}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {job.summary?.holdingsUpserted !== undefined && (
                  <span className="tabular-nums">{job.summary.holdingsUpserted.toLocaleString()} holdings</span>
                )}
                {job.skippedFresh > 0 && (
                  <span className="tabular-nums">{job.skippedFresh.toLocaleString()} fresh</span>
                )}
                {/* A non-zero drop count means the parser could not read rows
                    the source did return — a format drift, not a quiet no-op. */}
                {dropped > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3" /> {dropped} unparsed
                  </span>
                )}
                {errors > 0 && <span className="text-red-500">{errors} errors</span>}
                <Badge value={job.status === "succeeded" ? "active" : job.status === "failed" ? "revoked" : "disabled"} label={job.status} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
