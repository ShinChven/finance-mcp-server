import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { ConfirmDialog } from "../components/modal.js";
import { DataTable, FilterPills, SearchInput, type Column } from "../components/table.js";
import { Badge, Button, PageHeader } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { GrantItem, ListResult } from "../lib/types.js";
import { useMe } from "./shell.js";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
  { value: "revoked", label: "Revoked" },
];

export default function ClientsPage() {
  const me = useMe();
  const params = useListParams({ per_page: me.preferences.pageSize, sort: "created_at.desc" });
  const [confirm, setConfirm] = useState<{ action: "revoke" | "delete"; grant: GrantItem } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["clients", params.apiQuery],
    queryFn: () => api<ListResult<GrantItem>>(`/api/clients?${params.apiQuery}`),
  });

  const act = useMutation({
    mutationFn: (input: { grant: GrantItem; action: "enable" | "disable" | "revoke" | "delete" }) => {
      const { grant, action } = input;
      if (action === "delete") return api(`/api/clients/${grant.id}`, { method: "DELETE" });
      if (action === "revoke") return api(`/api/clients/${grant.id}/revoke`, { method: "POST" });
      return api(`/api/clients/${grant.id}`, {
        method: "PATCH",
        body: { status: action === "enable" ? "active" : "disabled" },
      });
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast("success", `Client access ${input.action}d`);
      setConfirm(null);
    },
    onError: (err) => toast("error", err.message),
  });

  const columns: Column<GrantItem>[] = [
    {
      key: "name",
      label: "Client",
      sortable: true,
      render: (g) => (
        <div className="flex items-center gap-2.5">
          {g.logoUri ? (
            <img src={g.logoUri} alt="" className="size-7 rounded" />
          ) : (
            <div className="grid size-7 place-items-center rounded bg-zinc-100 dark:bg-zinc-800">
              <Plug className="size-3.5 text-zinc-400" />
            </div>
          )}
          <div>
            <div className="font-medium">{g.clientName}</div>
            <code className="text-xs text-zinc-400">{g.clientId.slice(0, 13)}…</code>
          </div>
        </div>
      ),
    },
    { key: "scope", label: "Scope", render: (g) => <code className="text-xs">{g.scope}</code> },
    {
      key: "status",
      label: "Status",
      render: (g) => (
        <div className="flex gap-1">
          <Badge value={g.status} />
          {g.clientStatus === "disabled" && <Badge value="disabled" label="client disabled" />}
        </div>
      ),
    },
    {
      key: "last_used_at",
      label: "Last access",
      sortable: true,
      render: (g) => formatRelative(g.lastUsedAt),
    },
    { key: "created_at", label: "Authorized", sortable: true, render: (g) => formatDate(g.createdAt) },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (g) => (
        <div className="flex justify-end gap-1.5">
          {g.status !== "revoked" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => act.mutate({ grant: g, action: g.status === "active" ? "disable" : "enable" })}
            >
              {g.status === "active" ? "Disable" : "Enable"}
            </Button>
          )}
          {g.status !== "revoked" ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm({ action: "revoke", grant: g })}>
              Revoke
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirm({ action: "delete", grant: g })}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="OAuth Clients"
        description="Applications you have authorized via OAuth 2.1 (PKCE) to access the MCP server as you."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search clients…" />
        <FilterPills params={params} paramKey="status" options={STATUS_OPTIONS} />
      </div>
      <DataTable
        params={params}
        columns={columns}
        rows={query.data?.items}
        rowKey={(g) => g.id}
        loading={query.isPending}
        empty={{
          title: "No authorized clients",
          description:
            "When an MCP client connects via OAuth, it registers automatically and appears here after you approve it.",
        }}
        total={query.data?.total ?? 0}
        totalPages={query.data?.total_pages ?? 1}
      />
      {confirm && (
        <ConfirmDialog
          title={confirm.action === "revoke" ? "Revoke client access?" : "Remove client?"}
          message={
            confirm.action === "revoke"
              ? `${confirm.grant.clientName} will lose access immediately and all of its tokens will be invalidated.`
              : `${confirm.grant.clientName} will be removed from your list. It can request access again later.`
          }
          confirmLabel={confirm.action === "revoke" ? "Revoke access" : "Remove"}
          danger
          busy={act.isPending}
          onConfirm={() => act.mutate({ grant: confirm.grant, action: confirm.action })}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
