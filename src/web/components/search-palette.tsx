/**
 * One search box, reachable from every page.
 *
 * It lives in the shell rather than on a page because the thing it searches —
 * everything this server can address — is not any one page's subject. The
 * watchlist's own search box filters the list you are looking at, which is
 * correct for a list and useless for "does this server know about 易方达"; both
 * boxes now exist and each does one job.
 *
 * State: the query is a URL param (`?find=`), so a search is a link and the
 * watchlist's empty state can hand its own unmatched query straight to it. Only
 * whether the overlay is *open* is local — a ⌘K press that opened nothing yet
 * has no query to put in the URL, and an empty param would be indistinguishable
 * from an absent one.
 *
 * Results are unpriced by design; see `routes/search.ts`. Opening one prices it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Compass, Search, X } from "lucide-react";
import type { DiscoverIdea, IdeaListResult } from "../../shared/discover.js";
import { symbolPath } from "../../shared/symbol.js";
import { api } from "../lib/api.js";
import { fallbackIdea, ideaParam, looksLikeRef } from "../lib/discover.js";
import type { useListParams } from "../lib/params.js";
import { IdeaListSkeleton, IdeaRow } from "./ideas.js";

const DEBOUNCE_MS = 250;

export function SearchPalette({
  params,
  onClose,
  onNavigate,
}: {
  params: ReturnType<typeof useListParams>;
  /** Dismissed without going anywhere: clears `?find=` as well as closing. */
  onClose: () => void;
  /**
   * Closed *because* the URL is about to change. Kept separate because both
   * would otherwise write search params in the same tick, and the second write
   * computes from the params the first one has not committed yet — which
   * silently drops whichever param the first one set.
   */
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState(params.find);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // The URL follows the keystrokes at arm's length: `replace` so a search does
  // not bury the page behind it under one history entry per character.
  useEffect(() => {
    if (text === params.find) return;
    const handle = setTimeout(() => params.update({ find: text }, { replace: true }), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = params.find.trim();
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api<IdeaListResult>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });

  const items = useMemo(() => {
    const found = results.data?.items ?? [];
    if (query === "" ) return found;
    // Only when nothing came back exactly: the index is right far more often
    // than it is behind, and an "add anyway" row above real results would be
    // the wrong default.
    const exact = found.some((idea) => idea.ref.toUpperCase() === query.toUpperCase());
    return exact || !looksLikeRef(query) ? found : [...found, fallbackIdea(query)];
  }, [results.data, query]);

  useEffect(() => setCursor(0), [query]);

  function open(idea: DiscoverIdea) {
    // One write, both params: see `onNavigate` above.
    params.update({ idea: ideaParam(idea), find: "" });
    onNavigate();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => (value + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => (value - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = items[cursor];
      if (chosen === undefined) return;
      // Shift+Enter goes straight to an instrument's own page; Enter previews.
      if (event.shiftKey && chosen.kind === "symbol") {
        onNavigate();
        navigate(symbolPath(chosen.ref));
        return;
      }
      open(chosen);
    }
  }

  const active = items[cursor];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search instruments and funds"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-fit max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Search className="size-4 shrink-0 text-zinc-400" />
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search any symbol, company, or fund — NVDA, 腾讯, 易方达…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {query === "" ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">
              Type a name or a code. Searches this server's fund index and Yahoo Finance at once.
            </p>
          ) : results.isPending ? (
            <IdeaListSkeleton rows={5} />
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">
              Nothing matched "{query}".
            </p>
          ) : (
            items.map((idea) => (
              <IdeaRow
                key={`${idea.kind}:${idea.ref}`}
                idea={idea}
                active={
                  active !== undefined && active.kind === idea.kind && active.ref === idea.ref
                }
                onOpen={open}
              />
            ))
          )}

          {results.data?.degraded?.map((failure) => (
            <p key={failure.source} className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              {failure.source === "symbols" ? "Yahoo Finance" : "The fund index"} did not answer, so
              these results are partial.
            </p>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          <span>↑↓ to move · ↵ to preview · ⇧↵ full page · esc to close</span>
          <Link
            to="/discover"
            // The destination carries no query, so `find` goes with it.
            onClick={onNavigate}
            className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <Compass className="size-3.5" /> Browse instead
          </Link>
        </div>
      </div>
    </div>
  );
}
