import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, Layers, RefreshCw, X } from "lucide-react";
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
  IngestScope,
  JobsResult,
  ListResult,
  SyncPreview,
} from "../lib/types.js";
import { useMe } from "./shell.js";

/** Categories a sync can be started for, in the order they appear as buttons. */
const CATEGORIES: { scope: Exclude<IngestScope, "codes">; label: string; hint: string }[] = [
  { scope: "qdii", label: "QDII", hint: "Overseas-investing funds — the ones with US, HK and JP holdings." },
  { scope: "index", label: "Index-tracking", hint: "Funds with a declared 跟踪标的 mandate." },
  { scope: "equity", label: "Equity & balanced", hint: "股票型 and 混合型 funds." },
  { scope: "all", label: "Entire universe", hint: "Every fund on record. Expect a very long run." },
];

const STATUS_FILTERS = [
  { value: "cached", label: "Cached" },
  { value: "uncached", label: "Not cached" },
  { value: "failing", label: "Failing" },
];

function isJobActive(job: IngestJobItem | undefined): boolean {
  return job?.status === "running" || job?.status === "queued";
}

export default function FundsPage() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useListParams({ per_page: me.preferences.pageSize });
  const [pending, setPending] = useState<Exclude<IngestScope, "codes"> | null>(null);

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
          {fund.trackingIndex && (
            <span className="text-xs text-zinc-400">tracks {fund.trackingIndex}</span>
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
      render: (fund) =>
        fund.holdingsCount > 0 ? (
          <span className="tabular-nums">{fund.holdingsCount}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      key: "holdings_synced_at",
      label: "Cached",
      sortable: true,
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
      <PageHeader
        title="Fund Cache"
        description="Holdings are downloaded here so the stock- and sector-level tools can answer. Eastmoney only serves fund → holdings, so the reverse lookups exist only for funds cached below."
      />

      <StatTiles stats={stats.data} />

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Cache a category</h2>
          {!running && me.role !== "admin" && (
            <span className="text-xs text-zinc-400">Admins only</span>
          )}
        </div>

        {running && current ? (
          <ActiveJob job={current} onCancel={() => cancel.mutate(current.id)} busy={cancel.isPending} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map((category) => {
              const coverage = stats.data?.byScope[category.scope];
              return (
                <button
                  key={category.scope}
                  disabled={me.role !== "admin"}
                  onClick={() => setPending(category.scope)}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-200 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/5"
                >
                  <Download className="mt-0.5 size-4 shrink-0 text-indigo-500" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{category.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{category.hint}</div>
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
        )}
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search code, name, company…" />
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills params={params} paramKey="type" options={CATEGORIES.filter((c) => c.scope !== "all").map((c) => ({ value: c.scope, label: c.label }))} />
          <FilterPills params={params} paramKey="status" options={STATUS_FILTERS} />
        </div>
      </div>

      <DataTable
        params={params}
        columns={columns}
        rows={list.data?.items}
        rowKey={(fund) => fund.code}
        loading={list.isPending}
        empty={{
          title: "No funds match",
          description: "Run a category sync to populate the fund index, or clear the filters.",
        }}
        total={list.data?.total ?? 0}
        totalPages={list.data?.total_pages ?? 1}
      />

      <JobHistory jobs={jobs.data?.items ?? []} />

      {pending && (
        <SyncConfirm
          scope={pending}
          onClose={() => setPending(null)}
          onStarted={() => {
            setPending(null);
            void queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
          }}
        />
      )}

      {params.fund && (
        <HoldingsDialog code={params.fund} onClose={() => params.update({ fund: "" })} />
      )}
    </>
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
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <span className="font-medium capitalize">{job.scope}</span> sync running —{" "}
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
  scope,
  onClose,
  onStarted,
}: {
  scope: Exclude<IngestScope, "codes">;
  onClose: () => void;
  onStarted: () => void;
}) {
  const toast = useToast();
  const [force, setForce] = useState(false);

  const preview = useQuery({
    queryKey: ["sync-preview", scope, force],
    queryFn: () => api<SyncPreview>(`/api/sync/preview?scope=${scope}&force=${force}`),
  });

  const start = useMutation({
    mutationFn: () => api<IngestJobItem>("/api/sync", { method: "POST", body: { scope, force } }),
    onSuccess: () => {
      toast("success", "Sync started.");
      onStarted();
    },
    onError: (error: Error) => {
      toast("error", error instanceof ApiError && error.status === 409 ? "A sync is already running." : error.message);
    },
  });

  const label = CATEGORIES.find((category) => category.scope === scope)?.label ?? scope;
  const data = preview.data;

  return (
    <Modal title={`Cache ${label} funds`} onClose={onClose}>
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
            <Row label="API requests" value={data.estimatedRequests.toLocaleString()} />
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

          {data.toFetch === 0 && !force && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              Everything in this category is already cached and fresh. There is nothing to fetch.
            </p>
          )}

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
function HoldingsDialog({ code, onClose }: { code: string; onClose: () => void }) {
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
        <FundHoldings result={query.data} />
      ) : null}
    </Modal>
  );
}

function FundHoldings({ result }: { result: FundHoldingsResult }) {
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

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
        <span>
          Code <code className="text-zinc-700 dark:text-zinc-300">{result.fund.code}</code>
        </span>
        {result.fund.company && <span>{result.fund.company}</span>}
        <span>Report {result.latestReport ?? "—"}</span>
        <span>Cached {formatRelative(result.fund.holdingsSyncedAt)}</span>
      </div>

      {/* Eastmoney discloses a top-20 portfolio, so the weights never sum to
          100. Saying so stops the gap reading as missing data. */}
      <p className="mb-3 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500 dark:bg-zinc-800/50">
        {result.items.length} disclosed position{result.items.length === 1 ? "" : "s"} covering{" "}
        <span className="font-medium tabular-nums">{result.disclosedWeight.toFixed(1)}%</span> of net
        asset value. Quarterly reports disclose only the largest holdings, so the remainder is not
        missing — it is undisclosed.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((holding) => (
              <tr
                key={holding.symbol}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="px-3 py-2 font-mono text-xs">{holding.symbol}</td>
                <td className="px-3 py-2">{holding.name ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{holding.weight.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
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
                <span className="font-medium capitalize">{job.scope}</span>
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
