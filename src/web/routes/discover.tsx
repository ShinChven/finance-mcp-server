/**
 * Discover — the page for when you cannot name what you are looking for.
 *
 * The watchlist answers "how is what I track doing" and search answers "where
 * is the thing I can name". Neither answers the question a markets app is
 * usually opened with, which is *show me something*, and until this page
 * existed the only way into a watchlist was to already know a code.
 *
 * Five tabs, ordered by how much the reader has to bring: trending and movers
 * need nothing, themes need an idea, funds need a name, and related needs a
 * watchlist to be related to. Which tab is open, which region, which screen and
 * which theme all live in the URL, so a particular reading is a link — the same
 * rule every other page here follows.
 *
 * "Surprise me" is not a gimmick: a page of five tabs is still a wall of
 * choices, and one instrument chosen by nobody is the fastest way out of it.
 */

import { useQuery } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";
import {
  DEFAULT_MOVER_SCREEN,
  DEFAULT_TRENDING_REGION,
  DISCOVER_TABS,
  MOVER_SCREENS,
  TRENDING_REGIONS,
  isDiscoverTab,
  isMoverScreen,
  isTrendingRegion,
  type DiscoverIdea,
  type DiscoverTab,
  type IdeaListResult,
  type ThemeSummary,
} from "../../shared/discover.js";

import { IdeaList } from "../components/ideas.js";
import { useToast } from "../components/toast.js";
import { Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { ideaParam } from "../lib/discover.js";
import { useListParams } from "../lib/params.js";
import { BrowseFunds } from "./funds.js";

const TAB_LABELS: Record<DiscoverTab, string> = {
  trending: "Trending",
  movers: "Movers",
  themes: "Themes",
  funds: "Funds",
  related: "For you",
};

const DESCRIPTIONS: Record<DiscoverTab, string> = {
  trending: "What is being looked at most in one market right now, priced as you read it.",
  movers: "A predefined screen — the day's gainers, losers and most traded.",
  themes:
    "An investment theme resolved into funds three ways at once: funds tracking a matching index, funds with measured sector exposure, and funds exposed to the theme's markets.",
  funds:
    "Search funds by code, name, tracked index, or a stock they hold. A fund nobody has opened yet is fetched when you open it.",
  related:
    "Instruments related to the ones you already track. Seeded from your own lists, with what you hold filtered back out.",
};

/** A row of choices where exactly one is always chosen — unlike a filter. */
function PillGroup<T extends string>({
  options,
  current,
  onPick,
  label,
}: {
  options: readonly { id: T; label: string }[];
  current: T;
  onPick: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === current}
          onClick={() => onPick(option.id)}
          className={
            option.id === current
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

export default function DiscoverPage() {
  const params = useListParams({ tab: "trending" });
  const toast = useToast();
  const tab: DiscoverTab = isDiscoverTab(params.tab) ? params.tab : "trending";

  const open = (idea: DiscoverIdea) => params.update({ idea: ideaParam(idea) });

  /**
   * Fetched on demand rather than prefetched: one click, one upstream call,
   * and a button that quietly cost a request on every page load would be the
   * most expensive thing here.
   */
  const surprise = useQuery({
    queryKey: ["discover", "random"],
    queryFn: () => api<{ item: DiscoverIdea }>("/api/discover/random"),
    enabled: false,
  });

  async function pickForMe() {
    const result = await surprise.refetch();
    if (result.data?.item !== undefined) params.update({ idea: ideaParam(result.data.item) });
    else toast("error", "Nothing to suggest right now. Try again in a moment.");
  }

  return (
    <>
      <PageHeader title="Discover" description={DESCRIPTIONS[tab]} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap">
          {DISCOVER_TABS.map((value) => (
            <button
              key={value}
              onClick={() => params.update({ tab: value })}
              className={`cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors ${
                tab === value
                  ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {TAB_LABELS[value]}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={pickForMe} disabled={surprise.isFetching}>
          <Shuffle className="size-3.5" />
          {surprise.isFetching ? "Picking…" : "Surprise me"}
        </Button>
      </div>

      {tab === "trending" && <TrendingTab params={params} onOpen={open} />}
      {tab === "movers" && <MoversTab params={params} onOpen={open} />}
      {tab === "themes" && <ThemesTab params={params} onOpen={open} />}
      {tab === "funds" && <BrowseFunds params={params} />}
      {tab === "related" && <RelatedTab onOpen={open} />}
    </>
  );
}

type Params = ReturnType<typeof useListParams>;
type OnOpen = (idea: DiscoverIdea) => void;

/** Shared shell: the pills above a list, the list, and any partial-result note. */
function IdeaPanel({
  controls,
  query,
  empty,
  onOpen,
}: {
  controls?: React.ReactNode;
  query: { data: IdeaListResult | undefined; isPending: boolean; isError: boolean; error: unknown };
  empty: { title: string; description?: string };
  onOpen: OnOpen;
}) {
  return (
    <>
      {controls !== undefined && <div className="mb-4 flex flex-wrap items-center gap-2">{controls}</div>}
      {query.isError ? (
        <EmptyState
          title="That list is unavailable right now"
          description={(query.error as Error).message}
        />
      ) : (
        <Card className="p-1.5">
          <IdeaList
            ideas={query.data?.items}
            loading={query.isPending}
            empty={empty}
            onOpen={onOpen}
          />
        </Card>
      )}
    </>
  );
}

function TrendingTab({ params, onOpen }: { params: Params; onOpen: OnOpen }) {
  const region = isTrendingRegion(params.region) ? params.region : DEFAULT_TRENDING_REGION;
  const query = useQuery({
    queryKey: ["discover", "trending", region],
    queryFn: () => api<IdeaListResult>(`/api/discover/trending?region=${region}`),
  });

  return (
    <IdeaPanel
      controls={
        <PillGroup
          label="Market"
          options={TRENDING_REGIONS.map((entry) => ({ id: entry.id, label: entry.label }))}
          current={region}
          onPick={(value) => params.update({ region: value })}
        />
      }
      query={query}
      empty={{
        title: "Nothing trending here",
        description: "The upstream list is empty for this market right now. Try another one.",
      }}
      onOpen={onOpen}
    />
  );
}

function MoversTab({ params, onOpen }: { params: Params; onOpen: OnOpen }) {
  const screen = isMoverScreen(params.screen) ? params.screen : DEFAULT_MOVER_SCREEN;
  const query = useQuery({
    queryKey: ["discover", "movers", screen],
    queryFn: () => api<IdeaListResult>(`/api/discover/movers?screen=${screen}`),
  });

  return (
    <IdeaPanel
      controls={
        <PillGroup
          label="Screen"
          options={MOVER_SCREENS.map((entry) => ({ id: entry.id, label: entry.label }))}
          current={screen}
          onPick={(value) => params.update({ screen: value })}
        />
      }
      query={query}
      empty={{ title: "This screen returned nothing", description: "Try another screen." }}
      onOpen={onOpen}
    />
  );
}

function ThemesTab({ params, onOpen }: { params: Params; onOpen: OnOpen }) {
  const themes = useQuery({
    queryKey: ["discover", "themes"],
    queryFn: () => api<{ items: ThemeSummary[] }>("/api/discover/themes"),
  });

  const theme = params.theme;
  const funds = useQuery({
    queryKey: ["discover", "theme-funds", theme],
    queryFn: () => api<IdeaListResult>(`/api/discover/theme-funds?theme=${encodeURIComponent(theme)}`),
    enabled: theme !== "",
  });

  if (themes.isPending) return <Spinner />;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(themes.data?.items ?? []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === theme}
            onClick={() => params.update({ theme: entry.id === theme ? "" : entry.id })}
            title={entry.aliases.join(" · ")}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
              entry.id === theme
                ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {theme === "" ? (
        <EmptyState
          title="Pick a theme"
          description="Each one resolves to funds three ways: by the index they track, by measured sector exposure, and by the markets they are exposed to."
        />
      ) : (
        <IdeaPanel
          query={funds}
          empty={{
            title: "No cached fund matches this theme yet",
            description:
              "Theme matching reads disclosed holdings, so it only sees funds whose portfolios have been cached. Open a few on the Funds tab, or ask an administrator to sync a category.",
          }}
          onOpen={onOpen}
        />
      )}
    </>
  );
}

function RelatedTab({ onOpen }: { onOpen: OnOpen }) {
  const query = useQuery({
    queryKey: ["discover", "related"],
    queryFn: () => api<IdeaListResult>("/api/discover/related"),
  });

  return (
    <IdeaPanel
      query={query}
      empty={{
        title: "Track something first",
        description:
          "This tab is seeded from the instruments on your own lists — add a couple and it will have something to work from. Funds are not seeds: the upstream relates listings, not fund codes.",
      }}
      onOpen={onOpen}
    />
  );
}
