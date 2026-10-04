// Which integrations have credentials. Values are never exposed; only presence.
export type IntegrationKey = "DATABASE_URL" | "AGENTMAIL_API_KEY" | "EXA_API_KEY" | "AI_GATEWAY_API_KEY" | "KERNEL_API_KEY";

export const INTEGRATIONS: { key: IntegrationKey; name: string; role: string; where: string }[] = [
  { key: "DATABASE_URL", name: "Neon", role: "Positions ledger and the scheduled stop check", where: "console.neon.tech → your project → Connect → pooled connection string" },
  { key: "AGENTMAIL_API_KEY", name: "AgentMail", role: "Your StopLoss address and inbox", where: "console.agentmail.to → API Keys" },
  { key: "EXA_API_KEY", name: "Exa", role: "Finds trial length, renewal price, and cancel path", where: "dashboard.exa.ai → API Keys" },
  { key: "AI_GATEWAY_API_KEY", name: "Vercel AI Gateway", role: "The model that reads emails and drives the agent", where: "vercel.com → AI Gateway → API Keys" },
  { key: "KERNEL_API_KEY", name: "Kernel", role: "Live browser that signs up and cancels in your account", where: "dashboard.onkernel.com → API Keys" },
];

export function has(key: IntegrationKey): boolean {
  return Boolean(process.env[key]);
}

export function missing(keys: IntegrationKey[]): IntegrationKey[] {
  return keys.filter((k) => !has(k));
}
