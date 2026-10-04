import { KeyRound } from "lucide-react";
import { INTEGRATIONS, type IntegrationKey } from "@/config";
import { Card } from "./ui";

// Shown in place of a screen whose integration has no credentials yet.
export function SetupNeeded({ keys, what }: { keys: IntegrationKey[]; what: string }) {
  const rows = INTEGRATIONS.filter((i) => keys.includes(i.key));
  return (
    <Card className="max-w-2xl p-8">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
        <KeyRound className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-900">{what} needs a key</h2>
      <p className="mt-2 text-slate-600">
        Add these to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">.env.local</code> in the repo root, then
        restart <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">npm run dev</code>.
      </p>
      <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-3">
            <div className="font-mono text-sm font-semibold text-slate-900">{r.key}</div>
            <div className="mt-0.5 text-sm text-slate-600">
              {r.name}: {r.role}. Get it at {r.where}.
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
