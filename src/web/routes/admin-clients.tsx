import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../components/modal.js";
import { DataTable, FilterPills, SearchInput, type Column } from "../components/table.js";
import { Badge, Button, PageHeader } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { AdminClientItem, ListResult } from "../lib/types.js";
import { useMe } from "./shell.js";

export default function AdminClientsPage() {
  const me = useMe();
  const params = useListParams({ per_page: me.preferences.pageSize, sort: "created_at.desc" });
  const [confirmDelete, setConfirmDelete] = useState<AdminClientItem | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["admin-clients", params.apiQuery],
    queryFn: () => api<ListResult<AdminClientItem>>(`/api/admin/clients?${params.apiQuery}`),
  });

  const update = useMutation({
    mutationFn: (input: { clientId: string; status: "active" | "disabled" }) =>
      api(`/api/admin/clients/${input.clientId}`, { method: "PATCH", body: { status: input.status } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      toast("success", "Client updated");
    },
    onError: (err) => toast("error", err.message),
  });

  const remove = useMutation({
    mutationFn: (clientId: string) => api(`/api/admin/clients/${clientId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      toast("success", "Client deleted");
      setConfirmDelete(null);
    },
    onError: (err) => toast("error", err.message),
  });

  const columns: Column<AdminClientItem>[] = [
    {
      key: "name",
      label: "Client",
      sortable: true,
      render: (client) => (
        <div>
          <div className="font-medium">{client.clientName}</div>
          <code className="text-xs text-zinc-400">{client.clientId}</code>
        </div>
      ),
    },
    {
      key: "redirects",
      label: "Redirect URIs",
      render: (client) => (
        <span className="text-xs text-zinc-500" title={client.redirectUris.join("\n")}>
          {client.redirectUris.length} URI{client.redirectUris.length === 1 ? "" : "s"}
        </span>
      ),
    },
    { key: "grants", label: "Users", render: (client) => client.grantCount },
    { key: "status", label: "Status", render: (client) => <Badge value={client.status} /> },
    {
      key: "last_used_at",
      label: "Last access",
      sortable: true,
      render: (client) => formatRelative(client.lastUsedAt),
    },
    {
      key: "created_at",
      label: "Registered",
      sortable: true,
      render: (client) => formatDate(client.createdAt),
    },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (client) => (
        <div className="flex justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              update.mutate({
                clientId: client.clientId,
                status: client.status === "active" ? "disabled" : "active",
              })
            }
          >
            {client.status === "active" ? "Disable" : "Enable"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(client)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="All OAuth Clients"
        description="Every client registered via OAuth 2.1 dynamic registration. Disabling a client blocks it for all users."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search by name or client ID…" />
        <FilterPills
          params={params}
          paramKey="status"
          options={[
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </div>
      <DataTable
        params={params}
        columns={columns}
        rows={query.data?.items}
        rowKey={(client) => client.clientId}
        loading={query.isPending}
        empty={{
          title: "No registered clients",
          description: "MCP clients register automatically when they start an OAuth flow.",
        }}
        total={query.data?.total ?? 0}
        totalPages={query.data?.total_pages ?? 1}
      />
      {confirmDelete && (
        <ConfirmDialog
          title="Delete client?"
          message={`${confirmDelete.clientName} and every user authorization for it will be permanently removed.`}
          confirmLabel="Delete client"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.clientId)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
