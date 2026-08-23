import { useEffect, useState } from "react";
import { NavLink, Outlet, redirect, useNavigate, useRouteLoaderData } from "react-router";
import {
  BookOpen,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  NotebookPen,
  Plug,
  ScrollText,
  Server,
  Sparkles,
  Settings,
  Star,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { useRealtime } from "../lib/use-realtime.js";
import { realtime, type RealtimeStatus } from "../lib/realtime.js";
import type { Me } from "../lib/types.js";

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
function RealtimeIndicator({ status }: { status: RealtimeStatus }) {
  if (status === "open") {
    return (
      <span
        title="Live: this page updates as data changes"
        aria-label="Live updates connected"
        className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500"
      />
    );
  }
  return (
    <span
      title="Not receiving live updates. Reload to see the latest data."
      className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
    >
      <span className="size-2 animate-pulse rounded-full bg-amber-500" />
      {status === "connecting" ? "Connecting" : "Offline"}
    </span>
  );
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
  }`;

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
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }[];
}[] = [
  { items: [{ to: "/", label: "Overview", icon: LayoutDashboard, end: true }] },
  {
    label: "Workspace",
    items: [
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const realtimeStatus = useRealtime();

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
        <span className="font-semibold">MCP Server</span>
      </header>

      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-zinc-900/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <Server className="size-5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-semibold">MCP Server</span>
          <RealtimeIndicator status={realtimeStatus} />
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Any click inside the nav dismisses the drawer, including a link back
            to the route already open, which no location change would catch. */}
        <nav
          onClick={() => setNavOpen(false)}
          aria-label="Main"
          className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3"
        >
          {NAV_SECTIONS.filter((section) => !section.adminOnly || me.role === "admin").map((section) => {
            const headingId = section.label && `nav-${section.label.toLowerCase()}`;
            return (
              <div
                key={section.label ?? "home"}
                className="flex flex-col gap-1"
                role={section.label ? "group" : undefined}
                aria-labelledby={headingId}
              >
                {section.label && (
                  <div id={headingId} className="mt-4 mb-1 px-3 text-xs font-medium text-zinc-400 uppercase">
                    {section.label}
                  </div>
                )}
                {section.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink key={to} to={to} end={end} className={navItemClass}>
                    <Icon className="size-4" /> {label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="relative border-t border-zinc-200 p-3 dark:border-zinc-800">
          {menuOpen && (
            <div className="absolute bottom-full left-3 mb-1 w-52 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <button
                onClick={logout}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
          >
            {me.avatarUrl ? (
              <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
            ) : (
              <div className="grid size-8 place-items-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="truncate text-xs text-zinc-400">{me.email}</div>
            </div>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:ml-60 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
