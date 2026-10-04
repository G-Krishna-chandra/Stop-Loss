// Which integrations have credentials. Values are never exposed; only presence.
export type IntegrationKey = "DATABASE_URL" | "AGENTMAIL_API_KEY" | "EXA_API_KEY" | "NEON_AI_GATEWAY_TOKEN" | "KERNEL_API_KEY" | "ELEVENLABS_API_KEY";

export const INTEGRATIONS: { key: IntegrationKey; name: string; role: string; where: string }[] = [
  { key: "DATABASE_URL", name: "Neon", role: "Positions ledger and the scheduled stop check", where: "console.neon.tech → your project → Connect → pooled connection string" },
  { key: "AGENTMAIL_API_KEY", name: "AgentMail", role: "Your StopLoss address and inbox", where: "console.agentmail.to → API Keys" },
  { key: "EXA_API_KEY", name: "Exa", role: "Finds trial length, renewal price, and cancel path", where: "dashboard.exa.ai → API Keys" },
  { key: "NEON_AI_GATEWAY_TOKEN", name: "Neon AI Gateway", role: "The model that reads emails and drives the browser agent (also set NEON_AI_GATEWAY_BASE_URL)", where: "Neon console → your branch → AI Gateway tab" },
  { key: "KERNEL_API_KEY", name: "Kernel", role: "Live browser that signs up and cancels in your account", where: "dashboard.onkernel.com → API Keys" },
  { key: "ELEVENLABS_API_KEY", name: "ElevenLabs", role: "The always-on voice assistant (run npm run voice:setup once)", where: "elevenlabs.io → Developers → API Keys" },
];

export function has(key: IntegrationKey): boolean {
  return Boolean(process.env[key]);
}

export function missing(keys: IntegrationKey[]): IntegrationKey[] {
  return keys.filter((k) => !has(k));
}
