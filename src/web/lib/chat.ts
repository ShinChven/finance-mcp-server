export interface ChatProviderInfo {
  id: "anthropic" | "openai" | "gemini";
  label: string;
  models: { id: string; label: string }[];
  defaultModel: string;
}

export interface ChatProvidersResponse {
  enabled: boolean;
  providers: ChatProviderInfo[];
  default: { provider: string; model: string } | null;
}

export interface ConversationItem {
  id: string;
  title: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageItem {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  createdAt: string;
}

type StreamLine =
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessageItem; usage: unknown }
  | { type: "error"; error: string };

/** POSTs a chat message and consumes the ndjson response stream. */
export async function sendChatMessage(
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
): Promise<{ message?: ChatMessageItem; error?: string }> {
  const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok || !response.body) {
    let error = response.statusText;
    try {
      error = ((await response.json()) as { error?: string }).error ?? error;
    } catch {
      // keep status text
    }
    return { error };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { message?: ChatMessageItem; error?: string } = {};

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as StreamLine;
    if (parsed.type === "delta") onDelta(parsed.text);
    else if (parsed.type === "done") result = { message: parsed.message };
    else result = { error: parsed.error };
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);
  return result;
}
