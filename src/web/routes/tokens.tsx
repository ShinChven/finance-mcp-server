import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldAlert } from "lucide-react";
import { ConfirmDialog, Modal } from "../components/modal.js";
import { DataTable, FilterPills, SearchInput, type Column } from "../components/table.js";
import { Badge, Button, CopyField, Input, Label, PageHeader, Select } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { ListResult, TokenItem } from "../lib/types.js";
import { IntegrationGuides } from "./integrations.js";
import { useMe } from "./shell.js";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
  { value: "revoked", label: "Revoked" },
];

const EXPIRY_CHOICES = [
  { value: "", label: "No expiration" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

function isExpired(token: TokenItem): boolean {
  return !!token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
}

function CreateTokenModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const create = useMutation({
    mutationFn: () =>
      api<{ token: string }>("/api/tokens", {
        method: "POST",
        body: {
          name,
          expiresAt: expiryDays
            ? new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString()
            : null,
        },
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      setCreated(data.token);
    },
    onError: (err) => toast("error", err.message),
  });

  if (created) {
    return (
      <Modal title="Token created — set up your client" onClose={onClose} dismissable={false} size="xl">
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex gap-2.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Copy your token now — it will not be shown again</p>
              <p className="mt-1 leading-5 text-amber-800 dark:text-amber-200/80">
                The existing setup guide below has already filled this token into each Bearer configuration.
              </p>
              <div className="mt-3">
                <CopyField label="Token" value={created} />
              </div>
            </div>
          </div>
        </div>
        <IntegrationGuides
          mcpUrl={`${window.location.origin}/mcp`}
          token={created}
          basePath="/tokens"
          defaultClient="claude-code"
        />
        <div className="mt-5 flex justify-end border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <Button onClick={onClose}>I’ve saved my token</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New access token" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Desktop"
            required
            maxLength={100}
            autoFocus
          />
        </div>
        <div>
          <Label>Expiration</Label>
          <Select value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className="w-full">
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Create token
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function TokensPage() {
  const me = useMe();
  const params = useListParams({ per_page: me.preferences.pageSize, sort: "created_at.desc" });
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "revoke" | "delete"; token: TokenItem } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["tokens", params.apiQuery],
    queryFn: () => api<ListResult<TokenItem>>(`/api/tokens?${params.apiQuery}`),
  });

  const act = useMutation({
    mutationFn: (input: { token: TokenItem; action: "enable" | "disable" | "revoke" | "delete" }) => {
      const { token, action } = input;
      if (action === "delete") return api(`/api/tokens/${token.id}`, { method: "DELETE" });
      if (action === "revoke") return api(`/api/tokens/${token.id}/revoke`, { method: "POST" });
      return api(`/api/tokens/${token.id}`, {
        method: "PATCH",
        body: { status: action === "enable" ? "active" : "disabled" },
      });
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      toast("success", `Token ${input.action}d`);
      setConfirm(null);
    },
    onError: (err) => toast("error", err.message),
  });

  const columns: Column<TokenItem>[] = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (t) => (
        <div>
          <div className="font-medium">{t.name}</div>
          <code className="text-xs text-zinc-400">{t.tokenPrefix}</code>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (t) =>
        t.status === "active" && isExpired(t) ? <Badge value="expired" /> : <Badge value={t.status} />,
    },
    {
      key: "expires_at",
      label: "Expires",
      sortable: true,
      render: (t) => (t.expiresAt ? formatDate(t.expiresAt) : "Never"),
    },
    {
      key: "last_used_at",
      label: "Last access",
      sortable: true,
      render: (t) => (
        <div>
          {formatRelative(t.lastUsedAt)}
          {t.lastUsedIp && <div className="text-xs text-zinc-400">{t.lastUsedIp}</div>}
        </div>
      ),
    },
    { key: "created_at", label: "Created", sortable: true, render: (t) => formatDate(t.createdAt) },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-1.5">
          {t.status !== "revoked" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => act.mutate({ token: t, action: t.status === "active" ? "disable" : "enable" })}
            >
              {t.status === "active" ? "Disable" : "Enable"}
            </Button>
          )}
          {t.status !== "revoked" ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm({ action: "revoke", token: t })}>
              Revoke
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirm({ action: "delete", token: t })}>
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
        title="Access Tokens"
        description="Personal tokens for connecting MCP clients with a Bearer header."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4" /> New token
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search tokens…" />
        <FilterPills params={params} paramKey="status" options={STATUS_OPTIONS} />
      </div>
      <DataTable
        params={params}
        columns={columns}
        rows={query.data?.items}
        rowKey={(t) => t.id}
        loading={query.isPending}
        empty={{
          title: "No access tokens",
          description: "Create a token to connect an MCP client such as Claude with a Bearer header.",
        }}
        total={query.data?.total ?? 0}
        totalPages={query.data?.total_pages ?? 1}
      />
      {showCreate && <CreateTokenModal onClose={() => setShowCreate(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.action === "revoke" ? "Revoke token?" : "Delete token?"}
          message={
            confirm.action === "revoke"
              ? `"${confirm.token.name}" will immediately stop working. This cannot be undone.`
              : `"${confirm.token.name}" will be permanently removed from the list.`
          }
          confirmLabel={confirm.action === "revoke" ? "Revoke" : "Delete"}
          danger
          busy={act.isPending}
          onConfirm={() => act.mutate({ token: confirm.token, action: confirm.action })}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
