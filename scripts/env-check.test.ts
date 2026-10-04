import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_SPECS, checkEnv, renderEnvReport } from "./env-check.js";

describe("env check", () => {
  it("covers exactly the variables listed in .env.example", () => {
    const listed = readFileSync(".env.example", "utf8")
      .split("\n")
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name));
    expect(ENV_SPECS.map((s) => s.name).sort()).toEqual(listed.sort());
  });

  it("flags missing, blank and misshapen values", () => {
    const rows = checkEnv({
      EXA_API_KEY: "   ",
      AGENTMAIL_WEBHOOK_SECRET: "nope",
      DATABASE_URL: "postgresql://u:p@host/db",
    });
    const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
    expect(by["EXA_API_KEY"]).toBe("missing");
    expect(by["KERNEL_API_KEY"]).toBe("missing");
    expect(by["AGENTMAIL_WEBHOOK_SECRET"]).toBe("check");
    expect(by["DATABASE_URL"]).toBe("ok");
  });

  it("treats unset optional variables as fine", () => {
    const rows = checkEnv({}, ENV_SPECS);
    const optional = rows.filter((r) => r.status === "optional").map((r) => r.name);
    expect(optional).toEqual(expect.arrayContaining(["KERNEL_PROFILE", "DEV_APPROVAL_TOKEN"]));
    expect(rows.find((r) => r.name === "KERNEL_PROJECT_ID")?.status).toBe("missing"); // unchanged for now
  });

  it("never puts a value in the report", () => {
    const secret = "whsec_SUPER_SECRET_VALUE_123";
    const url = "postgresql://user:hunter2@ep-cool-123.neon.tech/db";
    const report = renderEnvReport(
      checkEnv({ AGENTMAIL_WEBHOOK_SECRET: secret, DATABASE_URL: url, EXA_API_KEY: "exa_abc999" }),
    );
    for (const value of [secret, url, "hunter2", "exa_abc999", "neon.tech"]) {
      expect(report).not.toContain(value);
    }
  });

  it("does not leak a misshapen value either", () => {
    const report = renderEnvReport(checkEnv({ AGENTMAIL_WEBHOOK_SECRET: "wrongprefix_TOPSECRET" }));
    expect(report).not.toContain("TOPSECRET");
    expect(report).toContain("whsec_");
  });
});
