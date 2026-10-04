// Shows which API keys and settings are in place, without ever printing a value.
// Usage: npm run check:env      (reads .env if present; exits 1 while anything is missing)
import { checkEnv, renderEnvReport } from "./env-check.js";

try {
  process.loadEnvFile(".env");
} catch {
  console.log("(no .env file found, checking the shell environment only)\n");
}

const rows = checkEnv(process.env);
console.log(renderEnvReport(rows));
process.exit(rows.every((r) => r.status === "ok" || r.status === "optional") ? 0 : 1);
