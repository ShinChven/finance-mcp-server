import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Clock, KeyRound, Plug, TriangleAlert } from "lucide-react";
import { Card, CopyField, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatAction, formatRelative } from "../lib/format.js";
import type { Overview } from "../lib/types.js";
import { useMe } from "./shell.js";

function StatCard({
  icon,
  label,
  value,
  to,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  to?: string;
  warn?: boolean;
}) {
  const body = (
    <Card
      className={`flex items-center gap-3.5 p-4 ${to ? "transition-shadow hover:shadow-md" : ""} ${
        warn ? "border-amber-300 dark:border-amber-500/40" : ""
      }`}
    >
      <div
        className={`grid size-10 place-items-center rounded-lg ${
          warn
            ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
            : "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function OverviewPage() {
  const me = useMe();
  const query = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/overview") });

  if (query.isPending) return <Spinner />;
  const data = query.data;
  if (!data) return null;

  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.displayName || me.name || me.email}`}
        description="Your MCP server access at a glance."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<KeyRound className="size-5" />} label="Active tokens" value={data.activeTokens} to="/tokens" />
        <StatCard
          icon={<TriangleAlert className="size-5" />}
          label="Expiring within 14 days"
          value={data.expiringSoon}
          to="/tokens?status=active"
          warn={data.expiringSoon > 0}
        />
        <StatCard icon={<Plug className="size-5" />} label="Connected clients" value={data.activeGrants} to="/clients" />
        <StatCard icon={<Clock className="size-5" />} label="Last MCP access" value={formatRelative(data.lastMcpAccess)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">Connect an MCP client</h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Point your MCP client at this Streamable HTTP endpoint. Authenticate with a personal access token
            (Bearer header) or let the client sign in via OAuth 2.1.
          </p>
          <CopyField value={mcpUrl} />
          <Link
            to="/integrations"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            Open step-by-step integration guides <ArrowRight className="size-4" />
          </Link>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link
              to="/activity"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-zinc-400">No activity yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {formatAction(entry.action)}
                    {entry.targetId && (
                      <span className="ml-1.5 text-xs text-zinc-400">{entry.targetId.slice(0, 8)}…</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{formatRelative(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
