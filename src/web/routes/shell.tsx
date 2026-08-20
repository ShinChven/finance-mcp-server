import { useEffect, useState } from "react";
import { NavLink, Outlet, redirect, useNavigate, useRouteLoaderData } from "react-router";
import {
  Activity,
  Bot,
  BookOpen,
  Database,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Plug,
  ScrollText,
  Server,
  Sparkles,
  Settings,
  Star,
  Users,
  Wrench,
} from "lucide-react";
import { api, ApiError } from "../lib/api.js";
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

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
  }`;

export default function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => applyTheme(me.preferences.theme), [me.preferences.theme]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    navigate("/login");
  }

  const displayName = me.displayName || me.name || me.email;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 px-5 py-5">
          <Server className="size-5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-semibold">MCP Server</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          <NavLink to="/" end className={navItemClass}>
            <LayoutDashboard className="size-4" /> Overview
          </NavLink>
          <NavLink to="/activity" className={navItemClass}>
            <History className="size-4" /> Recent Activity
          </NavLink>
          <NavLink to="/assistant" className={navItemClass}>
            <Bot className="size-4" /> Assistant
          </NavLink>
          <NavLink to="/connector-setup" className={navItemClass}>
            <BookOpen className="size-4" /> Connector Setup
          </NavLink>
          <NavLink to="/tools" className={navItemClass}>
            <Wrench className="size-4" /> Tools
          </NavLink>
          <NavLink to="/watchlist" className={navItemClass}>
            <Star className="size-4" /> Watchlists
          </NavLink>
          <NavLink to="/notes" className={navItemClass}>
            <NotebookPen className="size-4" /> Notes
          </NavLink>
          <NavLink to="/skills" className={navItemClass}>
            <Sparkles className="size-4" /> Skills
          </NavLink>
          <NavLink to="/funds" className={navItemClass}>
            <Database className="size-4" /> Funds
          </NavLink>
          <NavLink to="/tokens" className={navItemClass}>
            <KeyRound className="size-4" /> Access Tokens
          </NavLink>
          <NavLink to="/clients" className={navItemClass}>
            <Plug className="size-4" /> OAuth Clients
          </NavLink>
          <NavLink to="/settings" className={navItemClass}>
            <Settings className="size-4" /> Settings
          </NavLink>
          {me.role === "admin" && (
            <>
              <div className="mt-4 mb-1 px-3 text-xs font-medium text-zinc-400 uppercase">Admin</div>
              <NavLink to="/admin/users" className={navItemClass}>
                <Users className="size-4" /> Users
              </NavLink>
              <NavLink to="/admin/clients" className={navItemClass}>
                <Activity className="size-4" /> All Clients
              </NavLink>
              <NavLink to="/admin/audit" className={navItemClass}>
                <ScrollText className="size-4" /> Audit Log
              </NavLink>
            </>
          )}
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
      <main className="ml-60 min-w-0 flex-1 px-6 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
