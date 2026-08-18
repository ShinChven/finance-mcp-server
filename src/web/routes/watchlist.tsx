/**
 * Watchlists.
 *
 * The page is a two-pane view: the lists on the left, the selected list priced
 * on the right. Which list is open, the search text, the kind filter and the
 * sort all live in the URL, so a particular view is a link.
 *
 * Sorting happens client-side even though the URL drives it, because the
 * interesting columns — price, change, distance to target — are computed per
 * request and never stored, so the database cannot order by them.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Target,
  Trash2,
} from "lucide-react";
import { Modal, ConfirmDialog } from "../components/modal.js";
import { FilterPills, SearchInput } from "../components/table.js";
import { useToast } from "../components/toast.js";
import { Button, Card, EmptyState, Input, Label, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type {
  AddItemsResult,
  WatchlistItem,
  WatchlistItemsResult,
  WatchlistSummary,
} from "../lib/types.js";
import { detectItemKind, KIND_LABELS } from "../../shared/watchlist.js";

const KIND_FILTERS = [
  { value: "symbol", label: "Instruments" },
  { value: "fund", label: "China funds" },
];

/** Quotes go stale quickly; a minute is often enough to matter and cheap enough to pay. */
const QUOTE_REFRESH_MS = 60_000;

function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-zinc-500";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const digits = Math.abs(value) < 10 ? 4 : 2;
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${currency ? ` ${currency}` : ""}`;
}

export default function WatchlistPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useListParams();
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<WatchlistSummary | null>(null);
  const [deleting, setDeleting] = useState<WatchlistSummary | null>(null);
  const [editingItem, setEditingItem] = useState<WatchlistItem | null>(null);

  const lists = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => api<{ items: WatchlistSummary[] }>("/api/watchlists"),
  });

  // Falls back to the first list so a bare /watchlist is never an empty frame;
  // the URL still wins whenever it names one.
  const selectedId = params.list || lists.data?.items[0]?.id || "";

  const itemsQuery = useMemo(() => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.kind) search.set("kind", params.kind);
    return search.toString();
  }, [params.q, params.kind]);

  const items = useQuery({
    queryKey: ["watchlist-items", selectedId, itemsQuery],
    queryFn: () =>
      api<WatchlistItemsResult>(`/api/watchlists/${selectedId}/items?${itemsQuery}`),
    enabled: selectedId !== "",
    refetchInterval: QUOTE_REFRESH_MS,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    void queryClient.invalidateQueries({ queryKey: ["watchlist-items"] });
  }

  const createList = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api<WatchlistSummary>("/api/watchlists", { method: "POST", body }),
    onSuccess: (list) => {
      setCreating(false);
      params.update({ list: list.id });
      invalidate();
      toast("success", `Created "${list.name}".`);
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const renameList = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; description: string | null }) =>
      api<WatchlistSummary>(`/api/watchlists/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
      toast("success", "Watchlist updated.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const deleteList = useMutation({
    mutationFn: (id: string) => api(`/api/watchlists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      params.update({ list: "" });
      invalidate();
      toast("success", "Watchlist deleted.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const addItems = useMutation({
    mutationFn: (body: { items: { ref: string; note?: string; targetPrice?: number }[] }) =>
      api<AddItemsResult>(`/api/watchlists/${selectedId}/items`, { method: "POST", body }),
    onSuccess: (result) => {
      setAdding(false);
      invalidate();
      if (result.skipped.length > 0) {
        toast("success", `Added ${result.added.length}; ${result.skipped.join(", ")} already tracked.`);
      } else {
        toast("success", `Added ${result.added.length} item${result.added.length === 1 ? "" : "s"}.`);
      }
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, ...body }: { id: string; note: string | null; targetPrice: number | null }) =>
      api(`/api/watchlists/${selectedId}/items/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setEditingItem(null);
      invalidate();
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const removeItem = useMutation({
    mutationFn: (id: string) =>
      api(`/api/watchlists/${selectedId}/items/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast("error", error.message),
  });

  const selected = lists.data?.items.find((list) => list.id === selectedId) ?? null;
  const sorted = useSortedItems(items.data?.items ?? [], params.sort);

  return (
    <>
      <PageHeader
        title="Watchlists"
        description="Instruments and China funds you are tracking, priced on load. The same lists are readable and editable over MCP, so an assistant works from what you see here."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New list
          </Button>
        }
      />

      {lists.isPending ? (
        <Spinner />
      ) : (lists.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No watchlists yet"
            description="Create one here, or just ask your assistant to track something — watchlistAdd creates your first list automatically."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <ListSidebar
            lists={lists.data?.items ?? []}
            selectedId={selectedId}
            onSelect={(id) => params.update({ list: id })}
          />

          <div className="min-w-0">
            {items.data?.summary && <SummaryTiles summary={items.data.summary} />}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <SearchInput params={params} placeholder="Search symbol, name, note…" />
              <div className="flex flex-wrap items-center gap-2">
                <FilterPills params={params} paramKey="kind" options={KIND_FILTERS} />
                <Button variant="secondary" size="sm" onClick={() => void items.refetch()}>
                  <RefreshCw className={`size-3.5 ${items.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button size="sm" onClick={() => setAdding(true)} disabled={selectedId === ""}>
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
            </div>

            {selected && (
              <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{selected.name}</span>
                {selected.description && <span>· {selected.description}</span>}
                <button
                  onClick={() => setRenaming(selected)}
                  className="cursor-pointer text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                  aria-label="Rename watchlist"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => setDeleting(selected)}
                  className="cursor-pointer text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  aria-label="Delete watchlist"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}

            <ItemsTable
              items={sorted}
              loading={items.isPending}
              sort={params.sort}
              onSort={(next) => params.update({ sort: next })}
              onEdit={setEditingItem}
              onRemove={(id) => removeItem.mutate(id)}
            />
          </div>
        </div>
      )}

      {creating && (
        <ListDialog
          title="New watchlist"
          busy={createList.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(values) => createList.mutate(values)}
        />
      )}

      {renaming && (
        <ListDialog
          title="Edit watchlist"
          initial={renaming}
          busy={renameList.isPending}
          onClose={() => setRenaming(null)}
          onSubmit={(values) =>
            renameList.mutate({
              id: renaming.id,
              name: values.name,
              description: values.description ?? null,
            })
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete watchlist"
          message={`"${deleting.name}" and its ${deleting.itemCount} item${
            deleting.itemCount === 1 ? "" : "s"
          } will be removed. Notes and targets go with it.`}
          confirmLabel="Delete"
          danger
          busy={deleteList.isPending}
          onConfirm={() => deleteList.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {adding && (
        <AddItemsDialog
          busy={addItems.isPending}
          onClose={() => setAdding(false)}
          onSubmit={(items) => addItems.mutate({ items })}
        />
      )}

      {editingItem && (
        <EditItemDialog
          item={editingItem}
          busy={updateItem.isPending}
          onClose={() => setEditingItem(null)}
          onSubmit={(patch) => updateItem.mutate({ id: editingItem.id, ...patch })}
        />
      )}
    </>
  );
}

/** Client-side because live values are computed per request, never stored. */
function useSortedItems(items: WatchlistItem[], sort: string): WatchlistItem[] {
  return useMemo(() => {
    if (!sort) return items;
    const [field, direction] = sort.split(".");
    const sign = direction === "asc" ? 1 : -1;
    const value = (item: WatchlistItem): number | string => {
      switch (field) {
        case "change":
          return item.live.changePercent ?? Number.NEGATIVE_INFINITY;
        case "price":
          return item.live.price ?? Number.NEGATIVE_INFINITY;
        case "target":
          return item.targetDistancePercent ?? Number.NEGATIVE_INFINITY;
        case "ref":
          return item.ref;
        default:
          return item.addedAt;
      }
    };
    return [...items].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * sign;
      }
      return (left - right) * sign;
    });
  }, [items, sort]);
}

function ListSidebar({
  lists,
  selectedId,
  onSelect,
}: {
  lists: WatchlistSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="h-fit p-2">
      {lists.map((list) => (
        <button
          key={list.id}
          onClick={() => onSelect(list.id)}
          className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            list.id === selectedId
              ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Star className="size-3.5 shrink-0" />
            <span className="truncate">{list.name}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">{list.itemCount}</span>
        </button>
      ))}
    </Card>
  );
}

function SummaryTiles({ summary }: { summary: NonNullable<WatchlistItemsResult["summary"]> }) {
  const tiles = [
    { label: "Tracked", value: String(summary.items), hint: `${summary.priced} priced` },
    {
      label: "Advancing",
      value: `${summary.advancing} / ${summary.declining}`,
      hint: "up vs down",
    },
    {
      label: "Average move",
      value: formatPercent(summary.averageChangePercent),
      hint: "equal-weighted breadth",
      tone: summary.averageChangePercent,
    },
    {
      label: "Best / worst",
      value: summary.best ? `${summary.best.ref}` : "—",
      hint: summary.worst ? `worst ${summary.worst.ref}` : "",
    },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-3">
          <div className="text-xs text-zinc-500">{tile.label}</div>
          <div
            className={`mt-1 text-lg font-semibold tabular-nums ${
              "tone" in tile ? signClass(tile.tone as number | null) : ""
            }`}
          >
            {tile.value}
          </div>
          {tile.hint && <div className="text-xs text-zinc-400">{tile.hint}</div>}
        </Card>
      ))}
    </div>
  );
}

const COLUMNS: { key: string; label: string; sortable?: boolean; align?: string }[] = [
  { key: "ref", label: "Item", sortable: true },
  { key: "price", label: "Last", sortable: true, align: "text-right" },
  { key: "change", label: "Change", sortable: true, align: "text-right" },
  { key: "target", label: "Target", sortable: true, align: "text-right" },
  { key: "note", label: "Note" },
  { key: "actions", label: "", align: "text-right" },
];

function ItemsTable({
  items,
  loading,
  sort,
  onSort,
  onEdit,
  onRemove,
}: {
  items: WatchlistItem[];
  loading: boolean;
  sort: string;
  onSort: (next: string) => void;
  onEdit: (item: WatchlistItem) => void;
  onRemove: (id: string) => void;
}) {
  const [sortField, sortDirection] = sort.split(".");

  if (loading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing tracked here yet"
          description="Add a symbol like NVDA or 0700.HK, or a 6-digit China fund code."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase dark:border-zinc-800">
              {COLUMNS.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-medium ${column.align ?? ""}`}>
                  {column.sortable ? (
                    <button
                      className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-zinc-800 dark:hover:text-zinc-200"
                      onClick={() =>
                        onSort(
                          sortField === column.key && sortDirection === "desc"
                            ? `${column.key}.asc`
                            : `${column.key}.desc`,
                        )
                      }
                    >
                      {column.label}
                      {sortField === column.key &&
                        (sortDirection === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs font-medium">{item.ref}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                      {KIND_LABELS[item.kind]}
                    </span>
                  </div>
                  {item.name && (
                    <div className="max-w-60 truncate text-xs text-zinc-400" title={item.name}>
                      {item.name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.live.available ? (
                    <>
                      <div>{formatPrice(item.live.price, item.live.currency)}</div>
                      <div className="text-[10px] text-zinc-400">
                        {item.live.basis === "nav" ? "NAV" : item.live.marketState?.toLowerCase() ?? "market"}
                        {item.live.asOf ? ` · ${formatRelative(item.live.asOf)}` : ""}
                      </div>
                    </>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                      title={item.live.unavailableReason}
                    >
                      <CircleAlert className="size-3.5" /> no data
                    </span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${signClass(item.live.changePercent)}`}>
                  {formatPercent(item.live.changePercent)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.targetPrice === null ? (
                    <span className="text-zinc-300 dark:text-zinc-600">—</span>
                  ) : (
                    <>
                      <div className="flex items-center justify-end gap-1 text-xs">
                        <Target className="size-3 text-zinc-400" />
                        {item.targetPrice}
                      </div>
                      {item.targetDistancePercent !== null && (
                        <div className={`text-[10px] ${signClass(item.targetDistancePercent)}`}>
                          {formatPercent(item.targetDistancePercent)} vs target
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="block max-w-64 truncate text-xs text-zinc-500" title={item.note ?? ""}>
                    {item.note ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => onEdit(item)}
                      aria-label={`Edit ${item.ref}`}
                      className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => onRemove(item.id)}
                      aria-label={`Remove ${item.ref}`}
                      className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ListDialog({
  title,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: WatchlistSummary;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string; description?: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") return;
          onSubmit({ name: name.trim(), description: description.trim() || undefined });
        }}
        className="space-y-3"
      >
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="AI infrastructure"
            maxLength={80}
            autoFocus
          />
        </div>
        <div>
          <Label>Description (optional)</Label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this list is for"
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || name.trim() === ""}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Accepts several refs at once, comma or newline separated, because adding a
 * theme's worth of names one dialog at a time is the tedious path.
 */
function AddItemsDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (items: { ref: string; note?: string; targetPrice?: number }[]) => void;
}) {
  const [refs, setRefs] = useState("");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");

  const parsed = refs
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return (
    <Modal title="Add to watchlist" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed.length === 0) return;
          const targetPrice = target.trim() === "" ? undefined : Number(target);
          onSubmit(
            parsed.map((ref) => ({
              ref,
              ...(note.trim() !== "" && { note: note.trim() }),
              // A single target only makes sense for a single item.
              ...(parsed.length === 1 && targetPrice !== undefined && Number.isFinite(targetPrice)
                ? { targetPrice }
                : {}),
            })),
          );
        }}
        className="space-y-3"
      >
        <div>
          <Label>Symbols or fund codes</Label>
          <Input
            value={refs}
            onChange={(event) => setRefs(event.target.value)}
            placeholder="NVDA, 0700.HK, 161125"
            autoFocus
          />
          <p className="mt-1 text-xs text-zinc-400">
            Comma separated. A bare 6-digit number is read as a China fund code; anything else as a
            Yahoo symbol.
          </p>
          {parsed.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {parsed.map((ref) => (
                <span
                  key={ref}
                  className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800"
                >
                  {ref} · {KIND_LABELS[detectItemKind(ref)]}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label>Note (optional)</Label>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why you are tracking this"
            maxLength={500}
          />
        </div>
        {parsed.length <= 1 && (
          <div>
            <Label>Target price (optional)</Label>
            <Input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="120"
              inputMode="decimal"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || parsed.length === 0}>
            Add {parsed.length > 0 ? parsed.length : ""}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditItemDialog({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: WatchlistItem;
  busy: boolean;
  onClose: () => void;
  onSubmit: (patch: { note: string | null; targetPrice: number | null }) => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const [target, setTarget] = useState(item.targetPrice === null ? "" : String(item.targetPrice));

  return (
    <Modal title={item.ref} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = target.trim() === "" ? null : Number(target);
          onSubmit({
            note: note.trim() === "" ? null : note.trim(),
            targetPrice: parsed !== null && Number.isFinite(parsed) ? parsed : null,
          });
        }}
        className="space-y-3"
      >
        <div>
          <Label>Note</Label>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            autoFocus
          />
        </div>
        <div>
          <Label>Target price</Label>
          <Input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            placeholder="Leave blank to clear"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
