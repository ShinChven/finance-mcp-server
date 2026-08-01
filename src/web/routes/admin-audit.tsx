import { useQuery } from "@tanstack/react-query";
import { DataTable, SearchInput, type Column } from "../components/table.js";
import { PageHeader, Select } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatAction, formatDate } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { AuditItem, ListResult } from "../lib/types.js";
import { useMe } from "./shell.js";

const ACTIONS = [
  "user.login",
  "user.login_denied",
  "user.create",
  "user.update",
  "me.update",
  "me.session_revoke",
  "token.create",
  "token.update",
  "token.revoke",
  "token.delete",
  "chat.message",
  "oauth.client_register",
  "oauth.client_update",
  "oauth.client_delete",
  "oauth.consent_granted",
  "oauth.consent_denied",
  "oauth.grant_update",
  "oauth.grant_revoke",
  "oauth.grant_delete",
];

export default function AdminAuditPage() {
  const me = useMe();
  const params = useListParams({ per_page: me.preferences.pageSize });

  const query = useQuery({
    queryKey: ["admin-audit", params.apiQuery],
    queryFn: () => api<ListResult<AuditItem>>(`/api/admin/audit?${params.apiQuery}`),
  });

  const columns: Column<AuditItem>[] = [
    { key: "created_at", label: "Time", render: (entry) => formatDate(entry.createdAt) },
    {
      key: "actor",
      label: "Actor",
      render: (entry) => entry.actorEmail ?? <span className="text-zinc-400">system</span>,
    },
    { key: "action", label: "Action", render: (entry) => formatAction(entry.action) },
    {
      key: "target",
      label: "Target",
      render: (entry) =>
        entry.targetType ? (
          <span className="text-xs text-zinc-500">
            {entry.targetType} <code className="text-zinc-400">{entry.targetId?.slice(0, 8)}…</code>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "meta",
      label: "Details",
      render: (entry) =>
        entry.meta ? (
          <code className="block max-w-56 truncate text-xs text-zinc-400" title={JSON.stringify(entry.meta, null, 2)}>
            {JSON.stringify(entry.meta)}
          </code>
        ) : (
          "—"
        ),
    },
    { key: "ip", label: "IP", render: (entry) => <span className="text-xs">{entry.ip ?? "—"}</span> },
  ];

  return (
    <>
      <PageHeader title="Audit Log" description="Security-relevant events across all users." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search action, target or actor…" />
        <Select value={params.action} onChange={(e) => params.update({ action: e.target.value })}>
          <option value="">All actions</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {formatAction(action)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        params={params}
        columns={columns}
        rows={query.data?.items}
        rowKey={(entry) => entry.id}
        loading={query.isPending}
        empty={{ title: "No audit entries" }}
        total={query.data?.total ?? 0}
        totalPages={query.data?.total_pages ?? 1}
      />
    </>
  );
}
