import { config } from "../config.js";

export type ChatProviderId = "anthropic" | "openai" | "gemini";

export interface ChatModel {
  id: string;
  label: string;
}

export interface ChatProviderInfo {
  id: ChatProviderId;
  label: string;
  models: ChatModel[];
  defaultModel: string;
}

/**
 * Curated latest chat models per provider (as of 2026-07). Update here when
 * new generations ship — the UI and validation both derive from this table.
 */
const CATALOG: Record<ChatProviderId, Omit<ChatProviderInfo, "id">> = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    defaultModel: "claude-opus-4-8",
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-5.6", label: "GPT-5.6" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    ],
    defaultModel: "gpt-5.6",
  },
  gemini: {
    label: "Google Gemini",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    ],
    defaultModel: "gemini-3.5-flash-lite",
  },
};

function apiKeyFor(provider: ChatProviderId): string | undefined {
  switch (provider) {
    case "anthropic":
      return config.ANTHROPIC_API_KEY;
    case "openai":
      return config.OPENAI_API_KEY;
    case "gemini":
      return config.GEMINI_API_KEY;
  }
}

/** Providers whose API key is present in the environment. */
export function configuredProviders(): ChatProviderInfo[] {
  return (Object.keys(CATALOG) as ChatProviderId[])
    .filter((id) => !!apiKeyFor(id))
    .map((id) => ({ id, ...CATALOG[id] }));
}

export function isChatEnabled(): boolean {
  return configuredProviders().length > 0;
}

export function resolveProviderModel(
  provider: string | undefined,
  model: string | undefined,
): { provider: ChatProviderId; model: string } | null {
  const available = configuredProviders();
  const chosen = available.find((p) => p.id === provider) ?? available[0];
  if (!chosen) return null;
  const chosenModel = chosen.models.some((m) => m.id === model) ? model! : chosen.defaultModel;
  return { provider: chosen.id, model: chosenModel };
}

export function requireApiKey(provider: ChatProviderId): string {
  const key = apiKeyFor(provider);
  if (!key) throw new Error(`provider ${provider} is not configured`);
  return key;
}
