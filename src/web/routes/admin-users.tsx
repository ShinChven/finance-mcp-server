import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { Modal } from "../components/modal.js";
import { DataTable, FilterPills, SearchInput, type Column } from "../components/table.js";
import { Badge, Button, Input, Label, PageHeader, Select } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { ListResult, Me } from "../lib/types.js";
import { useMe } from "./shell.js";

type UserItem = Me;

function InviteUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const queryClient = useQueryClient();
  const toast = useToast();

  const create = useMutation({
    mutationFn: () =>
      api("/api/admin/users", { method: "POST", body: { email, name: name || undefined, role } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast("success", `${email} can now sign in with Google`);
      onClose();
    },
    onError: (err) => toast("error", err.message),
  });

  return (
    <Modal title="Invite user" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label>Google email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            required
            autoFocus
          />
          <p className="mt-1 text-xs text-zinc-400">
            They sign in with this Google account — no password is created.
          </p>
        </div>
        <div>
          <Label>Name (optional)</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")} className="w-full">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminUsersPage() {
  const me = useMe();
  const params = useListParams({ per_page: me.preferences.pageSize, sort: "created_at.desc" });
  const [showInvite, setShowInvite] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["admin-users", params.apiQuery],
    queryFn: () => api<ListResult<UserItem>>(`/api/admin/users?${params.apiQuery}`),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; body: { status?: string; role?: string } }) =>
      api(`/api/admin/users/${input.id}`, { method: "PATCH", body: input.body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast("success", "User updated");
    },
    onError: (err) => toast("error", err.message),
  });

  const columns: Column<UserItem>[] = [
    {
      key: "email",
      label: "User",
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-2.5">
          {u.avatarUrl ? (
            <img src={u.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
          ) : (
            <div className="grid size-7 place-items-center rounded-full bg-zinc-100 text-xs font-medium dark:bg-zinc-800">
              {u.email.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="font-medium">{u.displayName || u.name || "—"}</div>
            <div className="text-xs text-zinc-400">{u.email}</div>
          </div>
        </div>
      ),
    },
    { key: "role", label: "Role", render: (u) => <Badge value={u.role} /> },
    { key: "status", label: "Status", render: (u) => <Badge value={u.status} /> },
    {
      key: "last_login_at",
      label: "Last login",
      sortable: true,
      render: (u) => formatRelative(u.lastLoginAt),
    },
    { key: "created_at", label: "Created", sortable: true, render: (u) => formatDate(u.createdAt) },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (u) =>
        u.id === me.id ? (
          <span className="text-xs text-zinc-400">you</span>
        ) : (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => update.mutate({ id: u.id, body: { role: u.role === "admin" ? "user" : "admin" } })}
            >
              {u.role === "admin" ? "Demote" : "Make admin"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                update.mutate({ id: u.id, body: { status: u.status === "active" ? "disabled" : "active" } })
              }
            >
              {u.status === "active" ? "Disable" : "Enable"}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in to this MCP server. Disabled users lose dashboard and token access."
        actions={
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="size-4" /> Invite user
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput params={params} placeholder="Search by email or name…" />
        <div className="flex gap-2">
          <FilterPills
            params={params}
            paramKey="role"
            options={[
              { value: "admin", label: "Admins" },
              { value: "user", label: "Users" },
            ]}
          />
          <FilterPills
            params={params}
            paramKey="status"
            options={[
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
        </div>
      </div>
      <DataTable
        params={params}
        columns={columns}
        rows={query.data?.items}
        rowKey={(u) => u.id}
        loading={query.isPending}
        empty={{ title: "No users found" }}
        total={query.data?.total ?? 0}
        totalPages={query.data?.total_pages ?? 1}
      />
      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}
    </>
  );
}
