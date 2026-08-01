import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { requireApiKey, type ChatProviderId } from "./models.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatRequest {
  provider: ChatProviderId;
  model: string;
  system: string;
  messages: ChatTurn[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

export interface StreamChatResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

const MAX_OUTPUT_TOKENS = 16000;

async function streamAnthropic(req: StreamChatRequest): Promise<StreamChatResult> {
  const client = new Anthropic({ apiKey: requireApiKey("anthropic") });
  const stream = client.messages.stream(
    {
      model: req.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    },
    { signal: req.signal },
  );
  stream.on("text", (delta) => req.onDelta(delta));
  const final = await stream.finalMessage();
  const text = final.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    text,
    usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
  };
}

async function streamOpenAI(req: StreamChatRequest): Promise<StreamChatResult> {
  const client = new OpenAI({ apiKey: requireApiKey("openai") });
  const stream = await client.chat.completions.create(
    {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system" as const, content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    },
    { signal: req.signal },
  );
  let text = "";
  let usage: StreamChatResult["usage"];
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      req.onDelta(delta);
    }
    if (chunk.usage) {
      usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
    }
  }
  return { text, usage };
}

async function streamGemini(req: StreamChatRequest): Promise<StreamChatResult> {
  const ai = new GoogleGenAI({ apiKey: requireApiKey("gemini") });
  const stream = await ai.models.generateContentStream({
    model: req.model,
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    config: {
      systemInstruction: req.system,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: req.signal,
    },
  });
  let text = "";
  let usage: StreamChatResult["usage"];
  for await (const chunk of stream) {
    const delta = chunk.text;
    if (delta) {
      text += delta;
      req.onDelta(delta);
    }
    if (chunk.usageMetadata) {
      usage = {
        inputTokens: chunk.usageMetadata.promptTokenCount,
        outputTokens: chunk.usageMetadata.candidatesTokenCount,
      };
    }
  }
  return { text, usage };
}

/** Streams one assistant turn from the selected provider, invoking onDelta per text chunk. */
export async function streamChat(req: StreamChatRequest): Promise<StreamChatResult> {
  switch (req.provider) {
    case "anthropic":
      return streamAnthropic(req);
    case "openai":
      return streamOpenAI(req);
    case "gemini":
      return streamGemini(req);
  }
}
