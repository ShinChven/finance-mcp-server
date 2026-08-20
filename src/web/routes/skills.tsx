/**
 * Skills.
 *
 * The dashboard half of the skill tools: the procedures an agent loads by name,
 * in a form a person can write, review and publish. A list on the left of the
 * page, one skill open in a dialog — and every part of that state lives in the
 * URL, so a filtered view or an open skill is a link.
 *
 * Two things this page carries that the Notes page does not. Drafts are shown
 * first and marked, because a draft written over MCP is inert until someone
 * here publishes it, and an unreviewed draft that looks like a saved skill is
 * the failure mode this whole gate exists to prevent. And the description field
 * is given more room than its length suggests it deserves: it is the only text
 * an agent matches against, so the editor says so rather than leaving the user
 * to find out when their skill never gets found.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Eye,
  History,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { ConfirmDialog, Modal } from "../components/modal.js";
import { SearchInput } from "../components/table.js";
import { Markdown } from "../components/markdown.js";
import { useToast } from "../components/toast.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
} from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatDate, formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { ListResult, SkillCard, SkillDetail, SkillRevision } from "../lib/types.js";
import {
  isValidSlug,
  MAX_SKILL_BODY_LENGTH,
  MAX_WHEN_TO_USE_LENGTH,
  normalizeSlug,
  SKILL_SORTS,
  skillUri,
  STATUS_LABELS,
  suggestSlug,
  type SkillStatus,
} from "../../shared/skills.js";

const SORT_LABELS: Record<(typeof SKILL_SORTS)[number], string> = {
  relevance: "Best match",
  updated: "Last updated",
  created: "Newest",
  name: "Name",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "any", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

interface SkillFormValues {
  slug: string;
  name: string;
  whenToUse: string;
  body: string;
  status: SkillStatus;
  autoDiscover: boolean;
}

export default function SkillsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useListParams();
  const [deleting, setDeleting] = useState<SkillCard | null>(null);

  const skills = useQuery({
    queryKey: ["skills", params.apiQuery],
    queryFn: () => api<ListResult<SkillCard>>(`/api/skills?${params.apiQuery}`),
  });

  const openId = params.skill;
  const openSkill = useQuery({
    queryKey: ["skill", openId],
    queryFn: () => api<SkillDetail>(`/api/skills/${openId}`),
    enabled: openId !== "" && openId !== "new",
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["skills"] });
    void queryClient.invalidateQueries({ queryKey: ["skill"] });
  }

  const saveSkill = useMutation({
    mutationFn: ({ id, ...body }: SkillFormValues & { id: string }) =>
      id === "new"
        ? api<SkillDetail>("/api/skills", { method: "POST", body })
        : api<SkillDetail>(`/api/skills/${id}`, { method: "PATCH", body }),
    onSuccess: (skill, variables) => {
      invalidate();
      if (variables.id === "new") params.update({ skill: skill.id });
      toast("success", variables.id === "new" ? "Skill created." : "Skill saved.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const publishSkill = useMutation({
    mutationFn: (skill: SkillCard) =>
      api<SkillDetail>(`/api/skills/${skill.id}`, { method: "PATCH", body: { status: "active" } }),
    onSuccess: (skill) => {
      invalidate();
      toast("success", `“${skill.slug}” is live — agents can call it now.`);
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const deleteSkill = useMutation({
    mutationFn: (skill: SkillCard) => api(`/api/skills/${skill.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      if (openId !== "") params.update({ skill: "" });
      toast("success", "Skill deleted.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const items = skills.data?.items ?? [];
  const drafts = items.filter((skill) => skill.status === "draft").length;

  return (
    <>
      <PageHeader
        title="Skills"
        description="Procedures an agent loads by name. Nothing here reaches a conversation until it is asked for."
        actions={
          <Button onClick={() => params.update({ skill: "new" })}>
            <Plus className="size-4" /> New skill
          </Button>
        }
      />

      {drafts > 0 && params.status !== "active" && (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <Bot className="size-4 shrink-0" />
            {drafts === 1
              ? "One draft is waiting for review. Drafts written over MCP cannot be called until you publish them."
              : `${drafts} drafts are waiting for review. Drafts written over MCP cannot be called until you publish them.`}
          </p>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput params={params} placeholder="Search names and descriptions…" />
        <Select
          value={params.status === "" ? "any" : params.status}
          onChange={(e) => params.update({ status: e.target.value === "any" ? "" : e.target.value })}
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </Select>
        <Select value={params.sort} onChange={(e) => params.update({ sort: e.target.value })}>
          <option value="">{params.q === "" ? "Last updated" : "Best match"}</option>
          {SKILL_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </Select>
        {skills.data !== undefined && (
          <span className="text-sm text-zinc-400">
            {skills.data.total} {skills.data.total === 1 ? "skill" : "skills"}
          </span>
        )}
      </div>

      {skills.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={params.q === "" ? "No skills yet" : "Nothing matched"}
            description={
              params.q === ""
                ? "A skill is a procedure you write once so an agent does the task your way every time. Call it by name in any connected client."
                : "Try a shorter search, or clear the status filter."
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onOpen={() => params.update({ skill: skill.id })}
              onPublish={() => publishSkill.mutate(skill)}
              publishing={publishSkill.isPending && publishSkill.variables?.id === skill.id}
              onDelete={() => setDeleting(skill)}
            />
          ))}
        </div>
      )}

      {skills.data !== undefined && skills.data.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={params.page <= 1}
            onClick={() => params.update({ page: params.page - 1 })}
          >
            Previous
          </Button>
          <span className="text-sm text-zinc-400">
            Page {params.page} of {skills.data.total_pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={params.page >= skills.data.total_pages}
            onClick={() => params.update({ page: params.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}

      {openId !== "" && (openId === "new" || openSkill.data !== undefined) && (
        <SkillEditor
          skill={openId === "new" ? null : (openSkill.data ?? null)}
          busy={saveSkill.isPending}
          onClose={() => params.update({ skill: "" })}
          onSubmit={(values) => saveSkill.mutate({ id: openId, ...values })}
          {...(openId !== "new" && openSkill.data !== undefined
            ? {
                onDelete: () => {
                  setDeleting(openSkill.data);
                },
              }
            : {})}
        />
      )}

      {deleting !== null && (
        <ConfirmDialog
          title="Delete skill"
          message={`“${deleting.slug}” and its saved history will be removed. Agents calling that name will stop finding it.`}
          confirmLabel="Delete"
          danger
          busy={deleteSkill.isPending}
          onConfirm={() => deleteSkill.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function SkillRow({
  skill,
  onOpen,
  onPublish,
  publishing,
  onDelete,
}: {
  skill: SkillCard;
  onOpen: () => void;
  onPublish: () => void;
  publishing: boolean;
  onDelete: () => void;
}) {
  const draft = skill.status === "draft";

  return (
    <Card className={draft ? "border-amber-300 dark:border-amber-500/40" : undefined}>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <button
            onClick={onOpen}
            className="cursor-pointer text-left"
            aria-label={`Open ${skill.name}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-indigo-700 dark:bg-zinc-800 dark:text-indigo-300">
                {skill.slug}
              </code>
              <span className="font-medium">{skill.name}</span>
              {skill.status !== "active" && (
                <Badge
                  value={draft ? "disabled" : "expired"}
                  label={STATUS_LABELS[skill.status]}
                />
              )}
              {skill.source === "agent" && (
                <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                  <Bot className="size-3.5" /> written by an agent
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{skill.whenToUse}</p>
          </button>
          <p className="mt-1.5 text-xs text-zinc-400">
            {skill.bodyChars.toLocaleString()} characters · updated{" "}
            <time dateTime={skill.updatedAt} title={formatDate(skill.updatedAt)}>
              {formatRelative(skill.updatedAt)}
            </time>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {draft && (
            <Button size="sm" busy={publishing} onClick={onPublish}>
              <Send className="size-3.5" /> Publish
            </Button>
          )}
          <Button variant="ghost" size="sm" aria-label={`Delete ${skill.name}`} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SkillEditor({
  skill,
  busy,
  onClose,
  onSubmit,
  onDelete,
}: {
  skill: SkillDetail | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: SkillFormValues) => void;
  onDelete?: () => void;
}) {
  const [slug, setSlug] = useState(skill?.slug ?? "");
  const [name, setName] = useState(skill?.name ?? "");
  const [whenToUse, setWhenToUse] = useState(skill?.whenToUse ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [status, setStatus] = useState<SkillStatus>(skill?.status ?? "active");
  const [autoDiscover, setAutoDiscover] = useState(skill?.autoDiscover ?? false);
  const [preview, setPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // A skill edited elsewhere — by an agent, mid-session — should not be
  // silently overwritten by a stale form, so the fields follow the loaded row.
  useEffect(() => {
    if (skill === null) return;
    setSlug(skill.slug);
    setName(skill.name);
    setWhenToUse(skill.whenToUse);
    setBody(skill.body);
    setStatus(skill.status);
    setAutoDiscover(skill.autoDiscover);
  }, [skill]);

  const revisions = useQuery({
    queryKey: ["skill-revisions", skill?.id],
    queryFn: () => api<{ items: SkillRevision[] }>(`/api/skills/${skill!.id}/revisions`),
    enabled: showHistory && skill !== null,
  });

  const slugError = useMemo(() => {
    if (slug === "") return null;
    return isValidSlug(slug) ? null : "Lowercase letters, digits and single hyphens only.";
  }, [slug]);

  const canSave = slug !== "" && slugError === null && name.trim() !== "" && whenToUse.trim() !== "";

  function submit() {
    if (!canSave) return;
    onSubmit({ slug, name: name.trim(), whenToUse: whenToUse.trim(), body, status, autoDiscover });
  }

  return (
    <Modal title={skill === null ? "New skill" : "Edit skill"} size="xl" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              // Only while the slug is untouched — renaming a published skill
              // must never silently move the name agents already call.
              if (skill === null && slug === suggestSlug(name)) setSlug(suggestSlug(next));
            }}
            placeholder="Fund screening workflow"
          />
        </div>
        <div>
          <Label>Call it by</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(normalizeSlug(e.target.value))}
            placeholder="fund-screen"
            className="font-mono"
          />
          {slugError !== null ? (
            <p className="mt-1 text-xs text-red-500">{slugError}</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">
              What you type in chat to run this. Changing it breaks anything that calls the old name.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <Label>When to use it</Label>
          <span className="text-xs text-zinc-400">
            {whenToUse.length}/{MAX_WHEN_TO_USE_LENGTH}
          </span>
        </div>
        <textarea
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value.slice(0, MAX_WHEN_TO_USE_LENGTH))}
          rows={2}
          placeholder="Screening China funds for exposure to a single stock, when the user names a company rather than a fund."
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="mt-1 flex items-start gap-1.5 text-xs text-zinc-400">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          The only line search matches on. Name the situation, not the topic — “helps with funds”
          will never be found.
        </p>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <Label>The procedure</Label>
          <div className="flex items-center gap-3">
            {skill !== null && (
              <button
                onClick={() => setShowHistory((current) => !current)}
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                <History className="size-3.5" /> History
              </button>
            )}
            <button
              onClick={() => setPreview((current) => !current)}
              className="inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <Eye className="size-3.5" /> {preview ? "Edit" : "Preview"}
            </button>
          </div>
        </div>
        {preview ? (
          <div className="min-h-64 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
            {body.trim() === "" ? (
              <p className="text-sm text-zinc-400">Nothing to preview.</p>
            ) : (
              <Markdown>{body}</Markdown>
            )}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_SKILL_BODY_LENGTH))}
            rows={14}
            placeholder={"Steps, rules, the shape of the answer you want back. Markdown is rendered in preview."}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
        )}
        <p className="mt-1 text-xs text-zinc-400">
          {body.length.toLocaleString()}/{MAX_SKILL_BODY_LENGTH.toLocaleString()} characters
        </p>
      </div>

      {showHistory && skill !== null && (
        <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {revisions.isPending ? (
            <p className="text-sm text-zinc-400">Loading history…</p>
          ) : (revisions.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-400">No earlier versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {revisions.data!.items.map((revision) => (
                <li key={revision.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">
                      {formatDate(revision.createdAt)} · {revision.source}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setName(revision.name);
                        setWhenToUse(revision.whenToUse);
                        setBody(revision.body);
                        setShowHistory(false);
                      }}
                    >
                      <Wand2 className="size-3.5" /> Restore into the form
                    </Button>
                  </div>
                  <p className="truncate text-zinc-500">{revision.whenToUse}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <input
          type="checkbox"
          checked={autoDiscover}
          onChange={(e) => setAutoDiscover(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer accent-indigo-600"
        />
        <span className="text-sm">
          <span className="font-medium">List this skill to connected clients</span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
            Advertises it in <code className="font-mono">resources/list</code> as{" "}
            <code className="font-mono">{skillUri(slug === "" ? "name" : slug)}</code>. Leave it off
            and the skill still works — it just has to be called by name rather than shown in a
            browser.
          </span>
        </span>
      </label>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label>Status</Label>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as SkillStatus)}
            className="py-1.5"
          >
            <option value="draft">Draft — not callable</option>
            <option value="active">Active — agents can call it</option>
            <option value="archived">Archived — kept, not callable</option>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {onDelete !== undefined && (
            <Button variant="ghost" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} disabled={!canSave} onClick={submit}>
            <Check className="size-4" /> Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
