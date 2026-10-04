// Which model StopLoss calls. Neon AI Gateway first (NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN),
// Vercel AI Gateway (AI_GATEWAY_API_KEY) as a fallback.
import { createNeon } from "@neon/ai-sdk-provider";
import type { LanguageModel } from "ai";

const IDS = {
  agent: process.env.AGENT_MODEL ?? "claude-sonnet-5",
  extract: process.env.EXTRACT_MODEL ?? "claude-haiku-4-5",
};

export function hasModel(): boolean {
  return Boolean((process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN) || process.env.AI_GATEWAY_API_KEY);
}

export function model(kind: keyof typeof IDS): LanguageModel {
  const id = IDS[kind];
  if (process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN) {
    const neon = createNeon({ baseURL: process.env.NEON_AI_GATEWAY_BASE_URL, apiKey: process.env.NEON_AI_GATEWAY_TOKEN });
    return neon(id);
  }
  if (process.env.AI_GATEWAY_API_KEY) return id.includes("/") ? id : `anthropic/${id.replace(/-(\d)-(\d)$/, "-$1.$2")}`;
  throw new Error("No model configured. Set NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN in .env.local.");
}
