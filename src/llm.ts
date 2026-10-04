// Shared Claude helper (via Neon AI Gateway). Like types.ts, any module may import it.
// The model only ever fills in one typed answer: it gets no tools that act on the world.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-5-5';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.NEON_AI_GATEWAY_TOKEN || !process.env.NEON_AI_GATEWAY_BASE_URL) {
      throw new Error('NEON_AI_GATEWAY_TOKEN and NEON_AI_GATEWAY_BASE_URL must be set.');
    }
    client = new Anthropic({
      authToken: process.env.NEON_AI_GATEWAY_TOKEN,
      baseURL: `${process.env.NEON_AI_GATEWAY_BASE_URL}/anthropic`,
    });
  }
  return client;
}

export function llmAvailable(): boolean {
  return Boolean(process.env.NEON_AI_GATEWAY_TOKEN && process.env.NEON_AI_GATEWAY_BASE_URL);
}

/**
 * Asks Claude for one structured answer. Returns null if the model didn't answer or the answer
 * fails the schema. The gateway rejects `strict` and `output_config.format`, so the Zod parse
 * here is the guarantee.
 */
export async function ask<T extends z.ZodObject>(opts: {
  name: string;
  description: string;
  schema: T;
  system: string;
  user: string;
  effort?: 'low' | 'medium' | 'high';
}): Promise<z.infer<T> | null> {
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: opts.effort ?? 'low' },
    system: opts.system,
    tools: [{ name: opts.name, description: opts.description, input_schema: inputSchema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `${opts.user}\n\nAnswer by calling ${opts.name}.` }],
  });
  if (res.stop_reason === 'refusal') return null;
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.name);
  if (!call) return null;
  const parsed = opts.schema.safeParse(call.input);
  return parsed.success ? parsed.data : null;
}

/** Wraps untrusted text so the model treats it as data. */
export function untrusted(label: string, text: string): string {
  return `<${label}>\n${text.replaceAll(`</${label}>`, '')}\n</${label}>`;
}
