import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, MessageSquarePlus, SendHorizonal, Trash2 } from "lucide-react";
import { Markdown } from "../components/markdown.js";
import { ConfirmDialog } from "../components/modal.js";
import { SearchInput } from "../components/table.js";
import { Button, Card, EmptyState, PageHeader, Select, Spinner } from "../components/ui.js";
import { useToast } from "../components/toast.js";
import { api } from "../lib/api.js";
import {
  sendChatMessage,
  type ChatMessageItem,
  type ChatProvidersResponse,
  type ConversationItem,
} from "../lib/chat.js";
import { formatRelative } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { ListResult } from "../lib/types.js";

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(85%,48rem)] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-indigo-100 dark:bg-indigo-500/20">
        <Bot className="size-4 text-indigo-600 dark:text-indigo-300" />
      </div>
      <div className="min-w-0 max-w-[min(85%,48rem)]">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}

function ChatPane({
  conversationId,
  providers,
  onBack,
}: {
  conversationId: string;
  providers: ChatProvidersResponse;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ user: string; streamed: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ["chat-conversation", conversationId],
    queryFn: () =>
      api<{ conversation: ConversationItem; messages: ChatMessageItem[] }>(
        `/api/chat/conversations/${conversationId}`,
      ),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [query.data?.messages.length, pending?.streamed]);

  const changeModel = useMutation({
    mutationFn: (value: string) => {
      const [provider, model] = value.split("::");
      return api(`/api/chat/conversations/${conversationId}`, {
        method: "PATCH",
        body: { provider, model },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-conversation", conversationId] }),
    onError: (err) => toast("error", err.message),
  });

  async function send() {
    const content = input.trim();
    if (!content || pending) return;
    setInput("");
    setPending({ user: content, streamed: "" });
    const result = await sendChatMessage(conversationId, content, (delta) =>
      setPending((current) => (current ? { ...current, streamed: current.streamed + delta } : current)),
    );
    setPending(null);
    if (result.error) toast("error", result.error);
    await queryClient.invalidateQueries({ queryKey: ["chat-conversation", conversationId] });
    await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
  }

  if (query.isPending) return <Spinner />;
  const data = query.data;
  if (!data) return <EmptyState title="Conversation not found" />;

  const modelValue = `${data.conversation.provider}::${data.conversation.model}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-1 shrink-0 cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{data.conversation.title}</h2>
        <Select value={modelValue} onChange={(e) => changeModel.mutate(e.target.value)} className="text-xs">
          {providers.providers.map((provider) => (
            <optgroup key={provider.id} label={provider.label}>
              {provider.models.map((model) => (
                <option key={model.id} value={`${provider.id}::${model.id}`}>
                  {model.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5">
        {data.messages.length === 0 && !pending && (
          <EmptyState title="Start the conversation" description="Ask anything — responses stream in real time." />
        )}
        {data.messages.map((message) => (
          <MessageBubble key={message.id} role={message.role} content={message.content} />
        ))}
        {pending && (
          <>
            <MessageBubble role="user" content={pending.user} />
            {pending.streamed ? (
              <MessageBubble role="assistant" content={pending.streamed} />
            ) : (
              <div className="flex gap-2.5">
                <div className="grid size-7 place-items-center rounded-full bg-indigo-100 dark:bg-indigo-500/20">
                  <Bot className="size-4 animate-pulse text-indigo-600 dark:text-indigo-300" />
                </div>
                <span className="text-sm text-zinc-400">Thinking…</span>
              </div>
            )}
          </>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message the assistant… (Enter to send, Shift+Enter for a new line)"
          rows={Math.min(6, Math.max(1, input.split("\n").length))}
          className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <Button type="submit" disabled={!input.trim() || !!pending} busy={!!pending}>
          <SendHorizonal className="size-4" />
        </Button>
      </form>
    </div>
  );
}

export default function AssistantPage() {
  const params = useListParams({ per_page: 50 });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState<ConversationItem | null>(null);
  const selectedId = params.c;

  const providersQuery = useQuery({
    queryKey: ["chat-providers"],
    queryFn: () => api<ChatProvidersResponse>("/api/chat/providers"),
  });

  const listQuery = useQuery({
    queryKey: ["chat-conversations", params.apiQuery],
    queryFn: () => api<ListResult<ConversationItem>>(`/api/chat/conversations?${params.apiQuery}`),
  });

  const create = useMutation({
    mutationFn: () => api<{ conversation: ConversationItem }>("/api/chat/conversations", { method: "POST", body: {} }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      params.update({ c: data.conversation.id });
    },
    onError: (err) => toast("error", err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/chat/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (selectedId === id) params.update({ c: "" });
      setConfirmDelete(null);
    },
    onError: (err) => toast("error", err.message),
  });

  if (providersQuery.isPending) return <Spinner />;
  const providers = providersQuery.data;

  if (!providers?.enabled) {
    return (
      <>
        <PageHeader title="Assistant" />
        <Card className="p-6">
          <EmptyState
            title="No LLM provider configured"
            description="Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in the server environment to enable the built-in chat assistant."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Built-in chat assistant. Conversations are private to your account."
        actions={
          <Button onClick={() => create.mutate()} busy={create.isPending}>
            <MessageSquarePlus className="size-4" /> New chat
          </Button>
        }
      />
      <Card className="flex h-[calc(100dvh-15rem)] min-h-96 overflow-hidden lg:h-[calc(100vh-14rem)]">
        <aside
          className={`w-full shrink-0 flex-col border-r border-zinc-200 lg:flex lg:w-64 dark:border-zinc-800 ${
            selectedId ? "hidden" : "flex"
          }`}
        >
          <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
            <SearchInput params={params} placeholder="Search chats…" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {listQuery.data?.items.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-zinc-400">No conversations yet.</p>
            )}
            {listQuery.data?.items.map((conversation) => (
              <div
                key={conversation.id}
                className={`group flex items-center gap-1 rounded-lg ${
                  selectedId === conversation.id
                    ? "bg-indigo-50 dark:bg-indigo-500/10"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                }`}
              >
                <button
                  onClick={() => params.update({ c: conversation.id })}
                  className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"
                >
                  <div className="truncate text-sm">{conversation.title}</div>
                  <div className="text-xs text-zinc-400">
                    {conversation.model} · {formatRelative(conversation.updatedAt)}
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDelete(conversation)}
                  className="mr-1 hidden cursor-pointer rounded p-1.5 text-zinc-400 group-hover:block hover:text-red-500"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>
        <main className={`min-w-0 flex-1 p-4 lg:block ${selectedId ? "block" : "hidden"}`}>
          {selectedId ? (
            <ChatPane
              key={selectedId}
              conversationId={selectedId}
              providers={providers}
              onBack={() => params.update({ c: "" })}
            />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                title="Select or start a conversation"
                description="Your chats are saved and can be continued any time."
              />
            </div>
          )}
        </main>
      </Card>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete conversation?"
          message={`"${confirmDelete.title}" and all of its messages will be permanently deleted.`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
