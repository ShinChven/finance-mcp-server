/**
 * Notes.
 *
 * The dashboard half of the note tools: the same rows an assistant writes over
 * MCP, in a form a person can read, correct and file. Collections on the left,
 * results in the middle, one note open in a dialog — and every part of that
 * state lives in the URL, so a filtered view or an open note is a link.
 *
 * Listings never carry note bodies. The cards render the summary the writer was
 * asked for, plus a snippet when a search matched something further down, and
 * the body arrives only for the note actually opened.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bot,
  Eye,
  Folder,
  FolderPlus,
  Inbox,
  NotebookPen,
  Pencil,
  Pin,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { ConfirmDialog, Modal } from "../components/modal.js";
import { SearchInput } from "../components/table.js";
import { Markdown } from "../components/markdown.js";
import { useToast } from "../components/toast.js";
import {
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
import type {
  ListResult,
  NoteCard,
  NoteCollection,
  NoteDetail,
  NoteFacets,
} from "../lib/types.js";
import {
  MAX_BODY_LENGTH,
  NOTE_SORTS,
  parseSymbolInput,
  parseTagInput,
  type NoteStatus,
} from "../../shared/notes.js";

const SORT_LABELS: Record<(typeof NOTE_SORTS)[number], string> = {
  relevance: "Best match",
  updated: "Last updated",
  created: "Newest",
  title: "Title",
};

/** Facets are a browsing aid, not a directory; the long tail stays behind search. */
const FACET_LIMIT = 12;

export default function NotesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useListParams();
  const [editingCollection, setEditingCollection] = useState<NoteCollection | "new" | null>(null);
  const [deletingCollection, setDeletingCollection] = useState<NoteCollection | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteCard | null>(null);

  const collections = useQuery({
    queryKey: ["note-collections"],
    queryFn: () => api<{ items: NoteCollection[] }>("/api/note-collections"),
  });

  const facets = useQuery({
    queryKey: ["note-facets"],
    queryFn: () => api<NoteFacets>("/api/notes/facets"),
  });

  const notes = useQuery({
    queryKey: ["notes", params.apiQuery],
    queryFn: () => api<ListResult<NoteCard>>(`/api/notes?${params.apiQuery}`),
  });

  const openId = params.note;
  const openNote = useQuery({
    queryKey: ["note", openId],
    queryFn: () => api<NoteDetail>(`/api/notes/${openId}`),
    enabled: openId !== "" && openId !== "new",
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["notes"] });
    void queryClient.invalidateQueries({ queryKey: ["note"] });
    void queryClient.invalidateQueries({ queryKey: ["note-collections"] });
    void queryClient.invalidateQueries({ queryKey: ["note-facets"] });
  }

  const saveNote = useMutation({
    mutationFn: ({ id, ...body }: NoteFormValues & { id: string }) =>
      id === "new"
        ? api<NoteDetail>("/api/notes", { method: "POST", body })
        : api<NoteDetail>(`/api/notes/${id}`, { method: "PATCH", body }),
    onSuccess: (note, variables) => {
      invalidate();
      if (variables.id === "new") params.update({ note: note.id });
      toast("success", variables.id === "new" ? "Note created." : "Note saved.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => api(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeletingNote(null);
      params.update({ note: "" });
      invalidate();
      toast("success", "Note deleted.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const saveCollection = useMutation({
    mutationFn: ({ id, ...body }: { id: string | null; name: string; description: string | null }) =>
      id === null
        ? api<NoteCollection>("/api/note-collections", { method: "POST", body })
        : api<NoteCollection>(`/api/note-collections/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setEditingCollection(null);
      invalidate();
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const deleteCollection = useMutation({
    mutationFn: (id: string) => api(`/api/note-collections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeletingCollection(null);
      params.update({ collection: "" });
      invalidate();
      toast("success", "Collection deleted; its notes are now unfiled.");
    },
    onError: (error: Error) => toast("error", error.message),
  });

  const sortValue = params.sort || (params.q ? "relevance" : "updated");
  const activeStatus = params.status || "active";

  return (
    <>
      <PageHeader
        title="Notes"
        description="What you and your assistant have written down: theses, decisions and context, tagged and linked to the instruments they are about. The same notes are readable and editable over MCP."
        actions={
          <Button onClick={() => params.update({ note: "new" })}>
            <Plus className="size-4" /> New note
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <CollectionSidebar
            collections={collections.data?.items ?? []}
            selected={params.collection}
            onSelect={(collection) => params.update({ collection })}
            onNew={() => setEditingCollection("new")}
            onEdit={setEditingCollection}
            onDelete={setDeletingCollection}
          />
          <FacetPanel
            facets={facets.data}
            tag={params.tag}
            symbol={params.symbol}
            onTag={(tag) => params.update({ tag })}
            onSymbol={(symbol) => params.update({ symbol })}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SearchInput params={params} placeholder="Search titles, summaries, bodies…" />
            <div className="flex flex-wrap items-center gap-2">
              <StatusPills
                value={activeStatus}
                onChange={(status) => params.update({ status: status === "active" ? "" : status })}
              />
              <Select
                value={sortValue}
                onChange={(e) => params.update({ sort: e.target.value })}
                aria-label="Sort notes"
                className="py-1.5 text-xs"
              >
                {NOTE_SORTS.filter((sort) => sort !== "relevance" || params.q).map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <ActiveFilters params={params} collections={collections.data?.items ?? []} />

          {notes.isPending ? (
            <Spinner />
          ) : (notes.data?.items.length ?? 0) === 0 ? (
            <Card>
              <EmptyState
                title={params.q ? `Nothing matches "${params.q}"` : "No notes here yet"}
                description="Write one here, or ask your assistant to save what a conversation established — noteCreate writes to this same list."
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.data?.items.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  onOpen={() => params.update({ note: note.id })}
                  onTag={(tag) => params.update({ tag })}
                  onSymbol={(symbol) => params.update({ symbol })}
                />
              ))}
            </div>
          )}

          {(notes.data?.total_pages ?? 1) > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-zinc-500">
              <span>
                Page {notes.data?.page} of {notes.data?.total_pages} · {notes.data?.total} notes
              </span>
              <div className="flex gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={params.page <= 1}
                  onClick={() => params.update({ page: params.page - 1 })}
                >
                  Prev
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={params.page >= (notes.data?.total_pages ?? 1)}
                  onClick={() => params.update({ page: params.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {openId !== "" && (openId === "new" || openNote.data !== undefined) && (
        <NoteEditor
          key={openId}
          note={openId === "new" ? null : (openNote.data ?? null)}
          collections={collections.data?.items ?? []}
          busy={saveNote.isPending}
          onClose={() => params.update({ note: "" })}
          onSubmit={(values) => saveNote.mutate({ id: openId, ...values })}
          onDelete={
            openId === "new" || openNote.data === undefined
              ? undefined
              : () => setDeletingNote(openNote.data)
          }
        />
      )}

      {editingCollection !== null && (
        <CollectionDialog
          collection={editingCollection === "new" ? null : editingCollection}
          busy={saveCollection.isPending}
          onClose={() => setEditingCollection(null)}
          onSubmit={(values) =>
            saveCollection.mutate({
              id: editingCollection === "new" ? null : editingCollection.id,
              ...values,
            })
          }
        />
      )}

      {deletingCollection !== null && (
        <ConfirmDialog
          title="Delete collection"
          message={`"${deletingCollection.name}" will be removed. Its ${deletingCollection.noteCount} note${
            deletingCollection.noteCount === 1 ? "" : "s"
          } are kept and become unfiled.`}
          confirmLabel="Delete"
          danger
          busy={deleteCollection.isPending}
          onConfirm={() => deleteCollection.mutate(deletingCollection.id)}
          onCancel={() => setDeletingCollection(null)}
        />
      )}

      {deletingNote !== null && (
        <ConfirmDialog
          title="Delete note"
          message={`"${deletingNote.title}" will be gone for good. Archiving keeps it searchable instead.`}
          confirmLabel="Delete"
          danger
          busy={deleteNote.isPending}
          onConfirm={() => deleteNote.mutate(deletingNote.id)}
          onCancel={() => setDeletingNote(null)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Sidebar
 * ---------------------------------------------------------------- */

function CollectionSidebar({
  collections,
  selected,
  onSelect,
  onNew,
  onEdit,
  onDelete,
}: {
  collections: NoteCollection[];
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (collection: NoteCollection) => void;
  onDelete: (collection: NoteCollection) => void;
}) {
  const rowClass = (active: boolean) =>
    `group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
      active
        ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
    }`;

  return (
    <Card className="p-2">
      <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
        <span className="text-xs font-medium text-zinc-400 uppercase">Collections</span>
        <button
          onClick={onNew}
          aria-label="New collection"
          className="cursor-pointer text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>

      <button className={rowClass(selected === "")} onClick={() => onSelect("")}>
        <NotebookPen className="size-4 shrink-0" /> All notes
      </button>
      <button className={rowClass(selected === "none")} onClick={() => onSelect("none")}>
        <Inbox className="size-4 shrink-0" /> Unfiled
      </button>

      {collections.map((collection) => (
        <div key={collection.id} className="group flex items-center">
          <button
            className={`${rowClass(selected === collection.id)} min-w-0 flex-1`}
            onClick={() => onSelect(collection.id)}
            title={collection.description ?? undefined}
          >
            <Folder className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{collection.name}</span>
            <span className="text-xs text-zinc-400">{collection.noteCount}</span>
          </button>
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={() => onEdit(collection)}
              aria-label={`Rename ${collection.name}`}
              className="cursor-pointer p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => onDelete(collection)}
              aria-label={`Delete ${collection.name}`}
              className="cursor-pointer p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function FacetPanel({
  facets,
  tag,
  symbol,
  onTag,
  onSymbol,
}: {
  facets: NoteFacets | undefined;
  tag: string;
  symbol: string;
  onTag: (tag: string) => void;
  onSymbol: (symbol: string) => void;
}) {
  if (facets === undefined) return null;
  if (facets.tags.length === 0 && facets.symbols.length === 0) return null;

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full px-2 py-0.5 text-xs ${
      active
        ? "bg-indigo-600 text-white"
        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    }`;

  return (
    <Card className="p-3">
      {facets.tags.length > 0 && (
        <>
          <div className="mb-2 text-xs font-medium text-zinc-400 uppercase">Tags</div>
          <div className="flex flex-wrap gap-1">
            {facets.tags.slice(0, FACET_LIMIT).map((facet) => (
              <button
                key={facet.tag}
                className={chip(tag === facet.tag)}
                onClick={() => onTag(tag === facet.tag ? "" : facet.tag)}
              >
                {facet.tag} <span className="opacity-60">{facet.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {facets.symbols.length > 0 && (
        <>
          <div className="mt-3 mb-2 text-xs font-medium text-zinc-400 uppercase">Symbols</div>
          <div className="flex flex-wrap gap-1">
            {facets.symbols.slice(0, FACET_LIMIT).map((facet) => (
              <button
                key={`${facet.kind}:${facet.ref}`}
                className={chip(symbol === facet.ref)}
                onClick={() => onSymbol(symbol === facet.ref ? "" : facet.ref)}
              >
                {facet.ref} <span className="opacity-60">{facet.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- *
 * Listing
 * ---------------------------------------------------------------- */

function StatusPills({
  value,
  onChange,
}: {
  value: string;
  onChange: (status: string) => void;
}) {
  const options = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "any", label: "All" },
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={
            value === option.value
              ? "cursor-pointer rounded-md bg-white px-2.5 py-1 text-xs font-medium shadow-sm dark:bg-zinc-700"
              : "cursor-pointer rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The filters that are not visible in their own control, so none is invisible. */
function ActiveFilters({
  params,
  collections,
}: {
  params: ReturnType<typeof useListParams>;
  collections: NoteCollection[];
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (params.collection === "none") {
    chips.push({ key: "collection", label: "Unfiled", clear: () => params.update({ collection: "" }) });
  } else if (params.collection !== "") {
    const name = collections.find((c) => c.id === params.collection)?.name ?? params.collection;
    chips.push({ key: "collection", label: name, clear: () => params.update({ collection: "" }) });
  }
  if (params.tag !== "") {
    chips.push({ key: "tag", label: `#${params.tag}`, clear: () => params.update({ tag: "" }) });
  }
  if (params.symbol !== "") {
    chips.push({ key: "symbol", label: params.symbol, clear: () => params.update({ symbol: "" }) });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
      <span>Filtered by</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={chip.clear}
          className="cursor-pointer rounded-full bg-zinc-100 px-2 py-0.5 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
          {chip.label} ✕
        </button>
      ))}
    </div>
  );
}

function NoteRow({
  note,
  onOpen,
  onTag,
  onSymbol,
}: {
  note: NoteCard;
  onOpen: () => void;
  onTag: (tag: string) => void;
  onSymbol: (symbol: string) => void;
}) {
  return (
    <Card className="p-3 transition-colors hover:border-indigo-300 dark:hover:border-indigo-700">
      <div className="flex items-start gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex items-center gap-1.5">
            {note.pinned && <Pin className="size-3.5 shrink-0 text-amber-500" />}
            {note.status === "archived" && <Archive className="size-3.5 shrink-0 text-zinc-400" />}
            {note.source === "agent" && (
              <Bot className="size-3.5 shrink-0 text-indigo-400" aria-label="Written by an assistant" />
            )}
            <span className="truncate font-medium">{note.title}</span>
          </div>
          {note.summary && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{note.summary}</p>
          )}
          {note.snippet && (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-400 italic">{note.snippet}</p>
          )}
        </button>
        <span className="shrink-0 text-xs text-zinc-400">{formatRelative(note.updatedAt)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {note.collectionName && (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Folder className="size-3" /> {note.collectionName}
          </span>
        )}
        {note.symbols.map((symbol) => (
          <button
            key={`${symbol.kind}:${symbol.ref}`}
            onClick={() => onSymbol(symbol.ref)}
            className="cursor-pointer rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {symbol.ref}
          </button>
        ))}
        {note.tags.map((tag) => (
          <button
            key={tag}
            onClick={() => onTag(tag)}
            className="inline-flex cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-0.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            <Tag className="size-3" />
            {tag}
          </button>
        ))}
        {note.bodyChars > 0 && (
          <span className="ml-auto text-zinc-400">{note.bodyChars.toLocaleString()} chars</span>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- *
 * Editor
 * ---------------------------------------------------------------- */

interface NoteFormValues {
  title: string;
  summary: string | null;
  body: string;
  collectionId: string | null;
  tags: string[];
  symbols: { kind: "symbol" | "fund"; ref: string }[];
  pinned: boolean;
  status: NoteStatus;
}

function NoteEditor({
  note,
  collections,
  busy,
  onClose,
  onSubmit,
  onDelete,
}: {
  note: NoteDetail | null;
  collections: NoteCollection[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: NoteFormValues) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [summary, setSummary] = useState(note?.summary ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [collectionId, setCollectionId] = useState(note?.collectionId ?? "");
  const [tagText, setTagText] = useState((note?.tags ?? []).join(", "));
  const [symbolText, setSymbolText] = useState((note?.symbols ?? []).map((s) => s.ref).join(", "));
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [status, setStatus] = useState<NoteStatus>(note?.status ?? "active");
  const [preview, setPreview] = useState(false);

  // A note edited elsewhere — by an agent, mid-session — should not be silently
  // overwritten by a stale form, so the fields follow the loaded row.
  useEffect(() => {
    if (note === null) return;
    setTitle(note.title);
    setSummary(note.summary ?? "");
    setBody(note.body);
    setCollectionId(note.collectionId ?? "");
    setTagText(note.tags.join(", "));
    setSymbolText(note.symbols.map((symbol) => symbol.ref).join(", "));
    setPinned(note.pinned);
    setStatus(note.status);
  }, [note]);

  const tags = useMemo(() => parseTagInput(tagText), [tagText]);
  const symbols = useMemo(() => parseSymbolInput(symbolText), [symbolText]);

  function submit() {
    if (title.trim() === "") return;
    onSubmit({
      title: title.trim(),
      summary: summary.trim() === "" ? null : summary.trim(),
      body,
      collectionId: collectionId === "" ? null : collectionId,
      tags,
      symbols,
      pinned,
      status,
    });
  }

  return (
    <Modal title={note === null ? "New note" : "Edit note"} size="xl" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this note establishes" />
        </div>
        <div>
          <Label>Collection</Label>
          <Select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="w-full"
          >
            <option value="">Unfiled</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-3">
        <Label>Summary</Label>
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One or two sentences — this is what listings and assistants see first"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Tags</Label>
          <Input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="macro, rate-cut"
          />
          {tags.length > 0 && (
            <p className="mt-1 text-xs text-zinc-400">Saved as: {tags.join(" · ")}</p>
          )}
        </div>
        <div>
          <Label>Symbols</Label>
          <Input
            value={symbolText}
            onChange={(e) => setSymbolText(e.target.value)}
            placeholder="NVDA, 0700.HK, 000834"
          />
          {symbols.length > 0 && (
            <p className="mt-1 text-xs text-zinc-400">
              {symbols.map((symbol) => `${symbol.ref} (${symbol.kind})`).join(" · ")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <Label>Body</Label>
          <button
            onClick={() => setPreview((current) => !current)}
            className="inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            <Eye className="size-3.5" /> {preview ? "Edit" : "Preview"}
          </button>
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
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            rows={14}
            placeholder="The substance. Markdown is rendered in preview."
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
        )}
        <p className="mt-1 text-right text-xs text-zinc-400">
          {body.length.toLocaleString()} / {MAX_BODY_LENGTH.toLocaleString()}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pinned
          </label>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as NoteStatus)}
            className="py-1.5 text-xs"
            aria-label="Note status"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
          {note !== null && (
            <span className="text-xs text-zinc-400">
              {note.source === "agent" ? "Written by an assistant" : "Written here"}
              {note.sourceRef ? ` · ${note.sourceRef}` : ""} · updated {formatDate(note.updatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <Button variant="ghost" onClick={onDelete} className="text-red-600 dark:text-red-400">
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button busy={busy} disabled={title.trim() === ""} onClick={submit}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CollectionDialog({
  collection,
  busy,
  onClose,
  onSubmit,
}: {
  collection: NoteCollection | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string; description: string | null }) => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");

  return (
    <Modal title={collection === null ? "New collection" : "Edit collection"} onClose={onClose}>
      <Label>Name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Macro" autoFocus />
      <div className="mt-3">
        <Label>Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — what belongs in here"
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          busy={busy}
          disabled={name.trim() === ""}
          onClick={() =>
            onSubmit({ name: name.trim(), description: description.trim() || null })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
