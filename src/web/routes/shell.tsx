import { useEffect, useState } from "react";
import { NavLink, Outlet, redirect, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import {
  BookOpen,
  ChartCandlestick,
  Compass,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ScrollText,
  Search,
  Server,
  Sparkles,
  Settings,
  Star,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { IdeaPreview } from "../components/idea-preview.js";
import { parseIdeaParam } from "../lib/discover.js";
import { SearchPalette } from "../components/search-palette.js";
import { useListParams } from "../lib/params.js";
import { DEFAULT_SERIES_RANGE } from "../../shared/series.js";
import { useRealtime } from "../lib/use-realtime.js";
import { realtime, type RealtimeStatus } from "../lib/realtime.js";
import type { Me } from "../lib/types.js";
import { BRAND_NAME } from "../../shared/brand.js";

export async function shellLoader({ request }: { request: Request }) {
  try {
    return await api<Me>("/api/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const url = new URL(request.url);
      const next = url.pathname + url.search;
      throw redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    }
    throw err;
  }
}

export function useMe(): Me {
  return useRouteLoaderData("shell") as Me;
}

function applyTheme(theme: string | undefined) {
  const preference = theme ?? "system";
  localStorage.setItem("theme", preference);
  const dark =
    preference === "dark" ||
    (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Whether what is on screen is live.
 *
 * Worth the pixels because of how this dashboard is used: left open on a second
 * screen while the agent works on the first. A page that quietly stopped
 * updating looks exactly like a page where nothing happened, and those two are
 * the only states a viewer needs to be able to tell apart.
 */
function RealtimeIndicator({ status, compact = false }: { status: RealtimeStatus; compact?: boolean }) {
  const live = status === "open";
  const title = live
    ? "Live: this page updates as data changes"
    : "Not receiving live updates. Reload to see the latest data.";
  const dot = `size-2 shrink-0 rounded-full ${live ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`;

  // On the rail there is no room for the word, so the dot carries the whole
  // signal and the reason moves into the tooltip and the accessible name.
  if (compact || live) {
    return (
      <span
        title={title}
        aria-label={live ? "Live updates connected" : "Live updates disconnected"}
        className={compact ? dot : `ml-auto ${dot}`}
      />
    );
  }
  return (
    <span title={title} className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <span className={dot} />
      {status === "connecting" ? "Connecting" : "Offline"}
    </span>
  );
}

const navItemClass =
  (railed: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    `flex items-center rounded-lg py-2 text-sm transition-colors ${
      railed ? "justify-center px-0" : "gap-2.5 px-3"
    } ${
      isActive
        ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
    }`;

const NAV_COLLAPSED_KEY = "nav-collapsed";

/** Storage throws rather than no-ops in some privacy modes; a rail preference
 *  is not worth taking the whole shell down over. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* not worth surfacing: the rail simply reverts on the next load */
  }
}

/**
 * The sidebar, grouped by what the reader came here to do.
 *
 * Three audiences share one list and each wants a different part of it: the
 * workspace is where the day is spent, Connect is read once while wiring up a
 * client and then never again, and Account/Admin are where you go when
 * something is wrong. Grouping them means the eye skips two thirds of the list
 * instead of reading eleven labels top to bottom.
 *
 * Labels match the `PageHeader` title of the page they open — a link whose
 * name changes on arrival costs the reader a beat working out whether they
 * landed where they meant to.
 */
export const NAV_SECTIONS: {
  label?: string;
  adminOnly?: boolean;
  items: {
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    end?: boolean;
    /** Another path prefix that counts as this link being open — a detail page under it. */
    alsoActive?: string;
  }[];
}[] = [
  { items: [{ to: "/", label: "Overview", icon: LayoutDashboard, end: true }] },
  {
    label: "Workspace",
    items: [
      { to: "/markets", label: "Markets", icon: ChartCandlestick, alsoActive: "/symbol/" },
      { to: "/discover", label: "Discover", icon: Compass },
      { to: "/watchlist", label: "Watchlists", icon: Star },
      { to: "/notes", label: "Notes", icon: NotebookPen },
      { to: "/funds", label: "Funds", icon: Landmark },
      { to: "/skills", label: "Skills", icon: Sparkles },
    ],
  },
  {
    // In the order the setup is actually done: read the guide, mint a token,
    // then check what ended up holding a grant.
    label: "Connect",
    items: [
      { to: "/connector-setup", label: "Connector Setup", icon: BookOpen },
      { to: "/tools", label: "MCP Tools", icon: Wrench },
      { to: "/tokens", label: "Access Tokens", icon: KeyRound },
      { to: "/clients", label: "OAuth Clients", icon: Plug },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      // Same Plug as the user-level OAuth Clients on purpose: one entity, two
      // scopes, and the repeated icon is what says so.
      { to: "/admin/clients", label: "All Clients", icon: Plug },
      { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
    ],
  },
];

export default function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Read synchronously on first render rather than in an effect: an effect
  // would paint the full sidebar first and snap it to the rail a frame later.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const realtimeStatus = useRealtime();
  const params = useListParams();
  // Only *whether* the palette is open is local; the query itself is `?find=`.
  // A ⌘K press that has not been typed into yet has no query to put in a URL.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const preview = parseIdeaParam(params.idea);

  // A link carrying a query — the watchlist's empty state hands its own
  // unmatched search over this way — opens the palette on arrival.
  useEffect(() => {
    if (params.find !== "") setPaletteOpen(true);
  }, [params.find]);

  // ⌘K is the shortcut every search palette has; ignoring it inside a field
  // would make it useless from the one place people press it most.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function closePalette() {
    setPaletteOpen(false);
    if (params.find !== "") params.update({ find: "" }, { replace: true });
  }

  /**
   * The rail is a desktop affordance, and the drawer is the same `<aside>`.
   * Gating on `navOpen` means a narrow window always gets labelled links, and
   * keeps the sidebar's width and its contents from ever disagreeing.
   */
  const railed = collapsed && !navOpen;

  function toggleCollapsed() {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  }

  useEffect(() => applyTheme(me.preferences.theme), [me.preferences.theme]);

  // The socket is the first thing to notice an expired session on a tab that
  // has been sitting idle: no query is running to get a 401 of its own.
  useEffect(() => {
    if (realtimeStatus === "unauthorized") navigate("/login");
  }, [realtimeStatus, navigate]);

  // The drawer overlays the page on small screens, so the page behind it must
  // not scroll away underneath.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    // Explicit: the server only notices a dead session on its next recheck,
    // minutes away, and until then this tab holds an authenticated socket.
    realtime.close();
    navigate("/login");
  }

  const displayName = me.displayName || me.name || me.email;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-3 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          className="-ml-1 cursor-pointer rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Menu className="size-5" />
        </button>
        <Server className="size-5 text-indigo-600 dark:text-indigo-400" />
        <span className="font-semibold">{BRAND_NAME}</span>
        <button
          onClick={() => setPaletteOpen(true)}
          aria-label="Search instruments and funds"
          className="ml-auto cursor-pointer rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Search className="size-5" />
        </button>
      </header>

      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-zinc-900/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-200 bg-white transition-[transform,width] duration-200 lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        } ${railed ? "lg:w-16" : ""}`}
      >
        <div className={`flex py-5 ${railed ? "flex-col items-center gap-3 px-2" : "items-center gap-2 px-5"}`}>
          <span className="relative flex shrink-0 items-center">
            <Server className="size-5 text-indigo-600 dark:text-indigo-400" />
            {railed && (
              // `flex` blockifies the dot: width and height are ignored on an
              // inline child, which is what a bare span would give it.
              <span className="absolute -top-0.5 -right-1 flex">
                <RealtimeIndicator status={realtimeStatus} compact />
              </span>
            )}
          </span>
          {!railed && (
            <>
              <span className="font-semibold">{BRAND_NAME}</span>
              <RealtimeIndicator status={realtimeStatus} />
            </>
          )}
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Above the links rather than in them: it opens an overlay, not a
            page, and it is the one control on this rail that is reached from
            every page rather than navigated to. */}
        <div className={railed ? "px-2 pb-1" : "px-3 pb-1"}>
          <button
            onClick={() => setPaletteOpen(true)}
            title={railed ? "Search (⌘K)" : undefined}
            aria-label="Search instruments and funds"
            className={`flex w-full cursor-pointer items-center rounded-lg border border-zinc-200 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60 ${
              railed ? "justify-center px-0" : "gap-2.5 px-3"
            }`}
          >
            <Search className="size-4 shrink-0" />
            {!railed && (
              <>
                <span>Search</span>
                <kbd className="ml-auto rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-700">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        {/* Any click inside the nav dismisses the drawer, including a link back
            to the route already open, which no location change would catch. */}
        <nav
          onClick={() => setNavOpen(false)}
          aria-label="Main"
          className={`flex flex-1 flex-col gap-1 overflow-y-auto pb-3 ${railed ? "px-2" : "px-3"}`}
        >
          {NAV_SECTIONS.filter((section) => !section.adminOnly || me.role === "admin").map((section) => {
            const headingId = section.label && `nav-${section.label.toLowerCase()}`;
            return (
              <div
                key={section.label ?? "home"}
                className="flex flex-col gap-1"
                role={section.label ? "group" : undefined}
                // The heading is not rendered on the rail, so the name it would
                // have provided has to be spelled out instead of referenced.
                aria-label={railed ? section.label : undefined}
                aria-labelledby={railed ? undefined : headingId}
              >
                {section.label &&
                  (railed ? (
                    <hr className="mx-2 mt-3 mb-2 border-zinc-200 dark:border-zinc-800" />
                  ) : (
                    <div id={headingId} className="mt-4 mb-1 px-3 text-xs font-medium text-zinc-400 uppercase">
                      {section.label}
                    </div>
                  ))}
                {section.items.map(({ to, label, icon: Icon, end, alsoActive }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={railed ? label : undefined}
                    className={({ isActive }) =>
                      navItemClass(railed)({
                        isActive: isActive || (alsoActive !== undefined && location.pathname.startsWith(alsoActive)),
                      })
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {/* Kept in the accessibility tree on the rail, where the
                        icon alone would leave the link unnamed. */}
                    <span className={railed ? "sr-only" : undefined}>{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={`relative border-t border-zinc-200 dark:border-zinc-800 ${railed ? "p-2" : "p-3"}`}>
          {menuOpen && (
            <div
              className={`absolute bottom-full mb-1 w-52 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
                railed ? "left-2" : "left-3"
              }`}
            >
              <button
                onClick={logout}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          )}
          <div className={`flex ${railed ? "flex-col items-center gap-2" : "items-center gap-1"}`}>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={railed ? displayName : undefined}
              title={railed ? displayName : undefined}
              className={`flex cursor-pointer items-center rounded-lg py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/60 ${
                railed ? "w-full justify-center px-0" : "min-w-0 flex-1 gap-2.5 px-2"
              }`}
            >
              {me.avatarUrl ? (
                <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
              ) : (
                <div className="grid size-8 place-items-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              {!railed && (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{displayName}</div>
                  <div className="truncate text-xs text-zinc-400">{me.email}</div>
                </div>
              )}
            </button>
            <button
              onClick={toggleCollapsed}
              aria-label={railed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!railed}
              title={railed ? "Expand navigation" : "Collapse navigation"}
              className="hidden shrink-0 cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 lg:block dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {railed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>
        </div>
      </aside>
      <main
        className={`min-w-0 flex-1 px-4 py-5 transition-[margin] duration-200 sm:px-6 sm:py-6 lg:px-8 lg:py-8 ${
          railed ? "lg:ml-16" : "lg:ml-60"
        }`}
      >
        <Outlet />
      </main>

      {/* Both overlays live here rather than on a page: an instrument can be
          searched for, and previewed, from anywhere — including from a page
          that has nothing to do with instruments. */}
      {paletteOpen && (
        <SearchPalette
          params={params}
          onClose={closePalette}
          onNavigate={() => setPaletteOpen(false)}
        />
      )}
      {preview !== null && (
        <IdeaPreview
          kind={preview.kind}
          instrumentRef={preview.ref}
          range={params.range || DEFAULT_SERIES_RANGE}
          palette={me.preferences.directionPalette ?? "classic"}
          onRange={(next) => params.update({ range: next })}
          onClose={() => params.update({ idea: "", range: "" })}
        />
      )}
    </div>
  );
}
