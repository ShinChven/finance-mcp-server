import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { PROVIDERS, selectableScopes, type ProviderId } from "../../shared/funds.js";
import { HoldingsDialog } from "../components/fund-holdings.js";
import { fundColumns } from "../components/fund-table.js";
import { DataTable, FilterPills, SearchInput } from "../components/table.js";
import { EmptyState, PageHeader } from "../components/ui.js";
import { api } from "../lib/api.js";
import { useListParams } from "../lib/params.js";
import type { FundItem, ListResult } from "../lib/types.js";
import { SyncConsole } from "./funds-sync.js";
import { useMe } from "./shell.js";

/**
 * Funds — open to every signed-in user, with the batch sync as an admin tab.
 *
 * Reading the cache and filling it in bulk are different acts with different
 * costs, and only the second is an administrator's. Searching funds, opening a
 * portfolio, and fetching one uncached fund on demand are what the cache exists
 * for; they cost a handful of throttled requests at most, and the MCP fund tools
 * already do exactly this for the same accounts. A batch run walks a whole
 * category for hours and is single-flight across the process, so one person
 * starting one blocks everyone — that is the tab that needs a role.
 *
 * Both live here rather than in separate sections because they are one subject
 * seen from two sides: the sync tab fills what the browse tab reads.
 */
const BROWSE_DESCRIPTION =
  "Search funds by code, name, tracked index, or a stock they hold, and open one to see its disclosed portfolio. A fund nobody has opened yet is fetched when you open it.";

const SYNC_DESCRIPTION =
  "Download a whole category at once so the stock- and sector-level tools can answer across it. Every source serves fund → holdings only, so the reverse lookups exist for the funds cached here — across all markets at once.";

const STATUS_FILTERS = [
  { value: "cached", label: "Cached" },
  { value: "uncached", label: "Not cached" },
];

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

export default function FundsPage() {
  const me = useMe();
  const params = useListParams({ tab: "browse", per_page: me.preferences.pageSize });
  const admin = me.role === "admin";
  // A non-admin who arrives on ?tab=sync — a shared link, a bookmark from a
  // demotion — is told so rather than shown an empty console whose every
  // request would 403.
  const tab = params.tab === "sync" ? "sync" : "browse";

  return (
    <>
      <PageHeader
        title="Funds"
        description={tab === "sync" ? SYNC_DESCRIPTION : BROWSE_DESCRIPTION}
      />

      {/* The tab bar appears only where there is a choice to make: for everyone
          else this page is simply the fund list, not a section with one tab. */}
      {admin && (
        <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {[
            { value: "browse", label: "Browse" },
            { value: "sync", label: "Batch sync" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => params.update({ tab: option.value })}
              className={`cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors ${
                tab === option.value
                  ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {tab === "sync" ? (
        admin ? (
          <SyncConsole />
        ) : (
          <EmptyState
            title="Admins only"
            description="Caching a whole category is an administrator task — it is hours of upstream requests into a cache everyone shares. Opening a single fund caches that fund, and needs no one's approval."
          />
        )
      ) : (
        <BrowseFunds params={params} />
      )}
    </>
  );
}

/** The fund list itself — search, filters, and the portfolio drill-down. */
function BrowseFunds({ params }: { params: ReturnType<typeof useListParams> }) {

  const list = useQuery({
    queryKey: ["funds", params.apiQuery],
    queryFn: () => api<ListResult<FundItem>>(`/api/funds?${params.apiQuery}`),
  });

  const selectedProvider = isProviderId(params.provider) ? params.provider : null;

  // Shared with the admin sync console, minus its failure column: a reader
  // cannot act on "the last sync errored", and opening the fund re-fetches it.
  const columns = fundColumns(params);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search code, name, or holding symbol (e.g. NVDA)…" />
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            params={params}
            paramKey="provider"
            clears={["scope"]}
            // From the shared descriptors rather than from the cache statistics:
            // the provider list is a fact about the build, and reading it here
            // would mean handing every user the operator's view of the cache.
            options={Object.values(PROVIDERS).map((provider) => ({
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
          description: params.q
            ? "Search covers fund code, name, company, tracking index, and the current holdings of cached funds — a stock symbol only matches funds whose portfolio has been cached."
            : "Clear the filters to see the whole index.",
        }}
        total={list.data?.total ?? 0}
        totalPages={list.data?.total_pages ?? 1}
      />

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
