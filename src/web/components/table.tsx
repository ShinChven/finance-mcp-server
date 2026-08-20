import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button, Card, EmptyState, Input, Spinner } from "./ui.js";
import type { useListParams } from "../lib/params.js";

type ListParams = ReturnType<typeof useListParams>;

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Debounced search box writing to the `q` search param (replace: true per keystroke). */
export function SearchInput({ params, placeholder }: { params: ListParams; placeholder?: string }) {
  const [text, setText] = useState(params.q);
  useEffect(() => setText(params.q), [params.q]);
  useEffect(() => {
    if (text === params.q) return;
    const handle = setTimeout(() => params.update({ q: text }, { replace: true }), 300);
    return () => clearTimeout(handle);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="pl-9"
      />
    </div>
  );
}

/** Status/filter pills that write a search param. */
export function FilterPills({
  params,
  paramKey,
  options,
  clears,
}: {
  params: ListParams;
  paramKey: "status" | "role" | "action" | "provider" | "scope" | "kind";
  options: { value: string; label: string }[];
  /**
   * Params cleared alongside this one, for filters that scope another filter.
   * Picking a different fund provider has to drop the scope chosen under the
   * previous one — otherwise the URL keeps a category that provider does not
   * have, and the pills show a selection the results do not reflect.
   */
  clears?: ("status" | "role" | "action" | "provider" | "scope" | "kind")[];
}) {
  const current = params[paramKey];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
      {[{ value: "", label: "All" }, ...options].map((option) => (
        <button
          key={option.value}
          onClick={() =>
            params.update({
              [paramKey]: option.value,
              ...Object.fromEntries((clears ?? []).map((key) => [key, ""])),
            })
          }
          className={
            current === option.value
              ? "cursor-pointer rounded-md bg-white px-2.5 py-1 text-xs font-medium shadow-sm dark:bg-zinc-700"
              : "cursor-pointer rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ params, total, totalPages }: { params: ListParams; total: number; totalPages: number }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800">
      <span>
        Page {params.page} of {totalPages} · {total} total
      </span>
      <div className="ml-auto flex gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={params.page <= 1}
          onClick={() => params.update({ page: params.page - 1 })}
        >
          <ChevronLeft className="size-3.5" /> Prev
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={params.page >= totalPages}
          onClick={() => params.update({ page: params.page + 1 })}
        >
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function DataTable<T>({
  params,
  columns,
  rows,
  rowKey,
  loading,
  empty,
  total,
  totalPages,
}: {
  params: ListParams;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading: boolean;
  empty: { title: string; description?: string };
  total: number;
  totalPages: number;
}) {
  const [sortField, sortDirection] = params.sort.split(".");

  function toggleSort(key: string) {
    const next = sortField === key && sortDirection === "desc" ? `${key}.asc` : `${key}.desc`;
    params.update({ sort: next });
  }

  return (
    <Card>
      {loading && !rows ? (
        <Spinner />
      ) : !rows || rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase dark:border-zinc-800">
                {columns.map((column) => (
                  <th key={column.key} className={`px-4 py-3 font-medium ${column.className ?? ""}`}>
                    {column.sortable ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-zinc-800 dark:hover:text-zinc-200"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        {sortField === column.key &&
                          (sortDirection === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3 ${column.className ?? ""}`}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination params={params} total={total} totalPages={totalPages} />
    </Card>
  );
}
