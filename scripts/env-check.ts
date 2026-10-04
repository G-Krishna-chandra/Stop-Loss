// Pure logic for `npm run check:env`. It reports WHICH variables are set, never their values,
// so the output is safe to paste into chat or a PR.

export interface EnvSpec {
  name: string;
  tool: string;
  usedBy: string;
  /** Optional shape check that only ever returns a boolean, never the value. */
  looksRight?: (value: string) => boolean;
  hint?: string;
  /** Not needed for the core loop. Reported as [optional] when unset and never fails the check. */
  optional?: boolean;
}

// Keep in sync with .env.example (a test fails if they drift).
export const ENV_SPECS: readonly EnvSpec[] = [
  { name: "AGENTMAIL_API_KEY", tool: "AgentMail", usedBy: "src/inbox" },
  {
    name: "AGENTMAIL_WEBHOOK_SECRET",
    tool: "AgentMail",
    usedBy: "src/inbox",
    looksRight: (v) => v.startsWith("whsec_"),
    hint: "should start with whsec_",
  },
  { name: "DATABASE_URL", tool: "Neon", usedBy: "src/db", looksRight: (v) => /^postgres(ql)?:\/\//.test(v), hint: "should start with postgres:// or postgresql://" },
  { name: "EXA_API_KEY", tool: "Exa", usedBy: "src/terms" },
  { name: "KERNEL_API_KEY", tool: "Kernel", usedBy: "src/cancel" },
  { name: "KERNEL_PROJECT_ID", tool: "Kernel", usedBy: "src/cancel" },
  { name: "AI_GATEWAY_API_KEY", tool: "Model access", usedBy: "src/agent" },
  { name: "KERNEL_PROFILE", tool: "Kernel", usedBy: "src/cancel", optional: true },
  { name: "DEV_APPROVAL_TOKEN", tool: "Dev approvals", usedBy: "scripts/run-agent.ts", optional: true },
];

export type EnvStatus = "ok" | "missing" | "check" | "optional";

export interface EnvRow {
  name: string;
  tool: string;
  usedBy: string;
  status: EnvStatus;
  note: string;
}

export function checkEnv(env: Record<string, string | undefined>, specs: readonly EnvSpec[] = ENV_SPECS): EnvRow[] {
  return specs.map((spec) => {
    const value = env[spec.name]?.trim();
    const base = { name: spec.name, tool: spec.tool, usedBy: spec.usedBy };
    if (!value) return { ...base, status: spec.optional ? "optional" : "missing", note: spec.optional ? "not set (optional)" : "not set" };
    if (spec.looksRight && !spec.looksRight(value)) {
      return { ...base, status: "check", note: `set, but ${spec.hint ?? "format looks wrong"}` };
    }
    return { ...base, status: "ok", note: "set" };
  });
}

export function renderEnvReport(rows: readonly EnvRow[]): string {
  const width = Math.max(...rows.map((r) => r.name.length));
  const lines = rows.map(
    (r) =>
      `${r.status === "ok" ? "[ok]      " : r.status === "check" ? "[check]   " : r.status === "optional" ? "[optional]" : "[missing] "} ${r.name.padEnd(width)}  ${r.tool} (${r.usedBy})${r.status === "ok" ? "" : `: ${r.note}`}`,
  );
  const required = rows.filter((r) => r.status !== "optional");
  const ready = required.filter((r) => r.status === "ok").length;
  return `${lines.join("\n")}\n\n${ready}/${required.length} required ready. Values are never printed.`;
}
