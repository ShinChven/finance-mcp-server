import { useState } from "react";
import { useRevalidator } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../components/modal.js";
import { Badge, Button, Card, Input, Label, PageHeader, Select, Spinner } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { SessionItem } from "../lib/types.js";
import { useMe } from "./shell.js";
import type { UserPreferences } from "../../shared/preferences.js";

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "preferences", label: "Preferences" },
  { value: "sessions", label: "Sessions" },
];

function ProfileTab() {
  const me = useMe();
  const revalidator = useRevalidator();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(me.displayName ?? "");

  const save = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", body: { displayName: displayName || null } }),
    onSuccess: () => {
      revalidator.revalidate();
      toast("success", "Profile updated");
    },
    onError: (err) => toast("error", err.message),
  });

  return (
    <Card className="max-w-2xl p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label>Email</Label>
          <Input value={me.email} disabled className="opacity-60" />
          <p className="mt-1 text-xs text-zinc-400">Managed by your Google account.</p>
        </div>
        <div>
          <Label>Account name</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={me.name ?? "Your name"}
            maxLength={80}
          />
          <p className="mt-1 text-xs text-zinc-400">Shown in the dashboard instead of your Google name.</p>
        </div>
        <Button type="submit" busy={save.isPending}>
          Save changes
        </Button>
      </form>
    </Card>
  );
}

function PreferencesTab() {
  const me = useMe();
  const revalidator = useRevalidator();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (preferences: UserPreferences) => api("/api/me", { method: "PATCH", body: { preferences } }),
    onSuccess: () => {
      revalidator.revalidate();
      toast("success", "Preferences saved");
    },
    onError: (err) => toast("error", err.message),
  });

  return (
    <Card className="max-w-2xl space-y-5 p-6">
      <div>
        <Label>Theme</Label>
        <Select
          value={me.preferences.theme ?? "system"}
          onChange={(e) => save.mutate({ theme: e.target.value as UserPreferences["theme"] })}
          className="w-full"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </div>
      <div>
        <Label>Rows per page</Label>
        <Select
          value={String(me.preferences.pageSize ?? 20)}
          onChange={(e) => save.mutate({ pageSize: Number(e.target.value) as UserPreferences["pageSize"] })}
          className="w-full"
        >
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
        </Select>
        <p className="mt-1 text-xs text-zinc-400">Default page size for lists across the dashboard.</p>
      </div>
    </Card>
  );
}

function SessionsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ items: SessionItem[] }>("/api/me/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/me/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast("success", "Session revoked");
      setConfirmId(null);
    },
    onError: (err) => toast("error", err.message),
  });

  if (query.isPending) return <Spinner />;

  return (
    <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {query.data?.items.map((session) => (
        <div key={session.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              {session.ip ?? "unknown IP"}
              {session.current && <Badge value="active" label="this device" />}
            </div>
            <div className="truncate text-xs text-zinc-400">
              {session.userAgent ?? "unknown device"} · signed in {formatDate(session.createdAt)} · last valid until{" "}
              {formatRelative(session.expiresAt)}
            </div>
          </div>
          {!session.current && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmId(session.id)}>
              Revoke
            </Button>
          )}
        </div>
      ))}
      {confirmId && (
        <ConfirmDialog
          title="Revoke session?"
          message="The device using this session will be signed out immediately."
          confirmLabel="Revoke"
          danger
          busy={revoke.isPending}
          onConfirm={() => revoke.mutate(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const params = useListParams({ tab: "profile" });

  return (
    <>
      <PageHeader title="Settings" description="Your account, preferences and active sessions." />
      <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => params.update({ tab: tab.value })}
            className={`cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors ${
              params.tab === tab.value
                ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {params.tab === "profile" && <ProfileTab />}
      {params.tab === "preferences" && <PreferencesTab />}
      {params.tab === "sessions" && <SessionsTab />}
    </>
  );
}
