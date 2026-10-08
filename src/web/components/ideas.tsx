/**
 * The row every discovery surface renders, and the star that tracks it.
 *
 * Search results, trending, movers, theme funds and the random pick are all
 * `DiscoverIdea`s, so they are all this component. That is the point: whichever
 * way a reader arrived at an instrument, the gesture that starts tracking it is
 * the same one in the same place, and there is only one piece of code that can
 * get "already on a list" wrong.
 *
 * The star adds and never removes. Removal needs the item id, which only the
 * list that holds it knows, and a star that quietly meant "remove from the
 * first list I find" would eventually remove the wrong one. A row that is
 * already tracked says so and offers the reader's other lists instead.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Check, Loader2, Plus, Star } from "lucide-react";
import type { DiscoverIdea } from "../../shared/discover.js";
import { KIND_LABELS } from "../../shared/watchlist.js";
import { api } from "../lib/api.js";
import { formatPercent, signClass } from "../lib/format.js";
import type { AddItemsResult, WatchlistSummary } from "../lib/types.js";
import { EmptyState, Skeleton } from "./ui.js";
import { useToast } from "./toast.js";

/** Prices span four orders of magnitude here; small ones need the extra digits. */
export function formatIdeaPrice(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const digits = Math.abs(value) < 10 ? 4 : 2;
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${currency ? ` ${currency}` : ""}`;
}

/**
 * Adds a ref to one of the reader's lists.
 *
 * Shared by the row star and the preview's own button so both invalidate the
 * same four caches. Missing one of them is how a star ends up still hollow
 * after a successful add.
 */
export function useAddIdea() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ idea, listId }: { idea: DiscoverIdea; listId: string }) =>
      api<AddItemsResult>(`/api/watchlists/${listId}/items`, {
        method: "POST",
        // The kind is sent explicitly rather than left to `detectItemKind`:
        // this row already knows which of the two sources it came from, and a
        // US ETF is the case where guessing from the ref alone is ambiguous.
        body: { items: [{ ref: idea.ref, kind: idea.kind }] },
      }),
    onSuccess: (result, { idea }) => {
      void queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      // The whole prefix, not just this list: a symbol page keys its own
      // "which lists hold this" read under it too, and its star must fill.
      void queryClient.invalidateQueries({ queryKey: ["watchlist-items"] });
      // Both discovery surfaces carry a `tracked` array that is now stale.
      void queryClient.invalidateQueries({ queryKey: ["discover"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      toast(
        "success",
        result.added.length > 0 ? `Added ${idea.ref}.` : `${idea.ref} was already on that list.`,
      );
    },
    onError: (error: Error) => toast("error", error.message),
  });
}

/**
 * The star, plus the list picker it opens.
 *
 * With exactly one list there is no choice to present, so the click adds
 * directly — a menu of one is a step that exists only to be dismissed.
 */
export function TrackButton({ idea, compact = false }: { idea: DiscoverIdea; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const add = useAddIdea();

  const lists = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => api<{ items: WatchlistSummary[] }>("/api/watchlists"),
    // Only fetched once the reader reaches for the star: a page of forty rows
    // must not fire forty list queries to draw forty stars.
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const tracked = idea.tracked.length > 0;
  const options = lists.data?.items ?? [];
  const alreadyOn = new Set(idea.tracked.map((entry) => entry.listId));

  function choose(listId: string) {
    setOpen(false);
    add.mutate({ idea, listId });
  }

  const title = tracked
    ? `On ${idea.tracked.map((entry) => entry.listName).join(", ")}`
    : `Track ${idea.ref}`;

  return (
    <div
      ref={wrapper}
      className="relative"
      // Handled here as well as on the document so the key stops at the menu:
      // a star inside the preview panel would otherwise close the panel too.
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        disabled={add.isPending}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`cursor-pointer rounded-md p-1.5 transition-colors ${
          tracked
            ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10"
            : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        }`}
      >
        {add.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Star className={`size-4 ${tracked ? "fill-current" : ""}`} />
        )}
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
            compact ? "left-0" : "right-0"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-zinc-400 uppercase">
            Add to list
          </div>
          {lists.isPending ? (
            <div className="flex flex-col gap-1 p-1">
              {["w-32", "w-24"].map((width) => (
                <div key={width} className="flex items-center gap-2 px-1 py-1.5">
                  <Skeleton className="size-3.5" />
                  <Skeleton className={`h-3.5 ${width}`} />
                </div>
              ))}
            </div>
          ) : options.length === 0 ? (
            <Link
              to="/watchlist"
              className="block rounded-md px-2 py-2 text-sm text-indigo-600 hover:bg-zinc-100 dark:text-indigo-400 dark:hover:bg-zinc-800"
            >
              Create your first list →
            </Link>
          ) : (
            options.map((list) => {
              const on = alreadyOn.has(list.id);
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => choose(list.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {on ? (
                    <Check className="size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Plus className="size-3.5 shrink-0 text-zinc-400" />
                  )}
                  <span className="truncate">{list.name}</span>
                  {on && <span className="ml-auto text-xs text-zinc-400">on</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** `Instrument` / `Fund (NAV)`, in the same words the watchlist uses. */
function KindBadge({ idea }: { idea: DiscoverIdea }) {
  return (
    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      {idea.quoteType ?? KIND_LABELS[idea.kind]}
    </span>
  );
}

export function IdeaRow({
  idea,
  active = false,
  onOpen,
}: {
  idea: DiscoverIdea;
  active?: boolean;
  onOpen: (idea: DiscoverIdea) => void;
}) {
  /**
   * The row is a container with a real button inside it, not a clickable div.
   *
   * The star and its menu are interactive too, and a control nested inside
   * something that is itself a button is invalid: the outer element swallows
   * the inner ones' names — the row would announce itself as "110022 … add to
   * list, China Internet Giants, Major AI Companies" — and only one of the two
   * can take the keyboard. Two siblings, each with its own job, avoids both.
   */
  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-3 transition-colors ${
        active ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(idea)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium">{idea.ref}</span>
            <KindBadge idea={idea} />
            {idea.exchange && <span className="truncate text-xs text-zinc-400">{idea.exchange}</span>}
          </span>
          <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
            {idea.name ?? "—"}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-sm tabular-nums">
            {formatIdeaPrice(idea.price, idea.currency)}
          </span>
          <span className={`block text-xs tabular-nums ${signClass(idea.changePercent)}`}>
            {idea.changePercent === null ? "" : formatPercent(idea.changePercent)}
          </span>
        </span>
      </button>

      <TrackButton idea={idea} />
    </div>
  );
}

export function IdeaList({
  ideas,
  loading,
  empty,
  onOpen,
  activeKey,
}: {
  ideas: DiscoverIdea[] | undefined;
  loading: boolean;
  empty: { title: string; description?: string };
  onOpen: (idea: DiscoverIdea) => void;
  /** `kind:ref` of the row to mark — the one open in the preview beside the list. */
  activeKey?: string;
}) {
  if (loading) return <IdeaListSkeleton />;
  if (ideas === undefined || ideas.length === 0) {
    return <EmptyState title={empty.title} {...(empty.description !== undefined && { description: empty.description })} />;
  }

  return (
    <div className="flex flex-col">
      {ideas.map((idea) => (
        <IdeaRow
          key={`${idea.kind}:${idea.ref}`}
          idea={idea}
          active={activeKey === `${idea.kind}:${idea.ref}`}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/**
 * Rows in `IdeaRow`'s shape — ref and badge over a name, price over change,
 * and the star — so the list does not reflow when the real ones land.
 */
export function IdeaListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className={`h-3.5 ${index % 3 === 0 ? "w-2/3" : index % 3 === 1 ? "w-1/2" : "w-3/5"}`} />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="size-7 rounded-md" />
        </div>
      ))}
    </div>
  );
}
