// A compact snapshot of StopLoss for the voice assistant: positions, approvals waiting, and browser runs.
import { getStats, listPendingApprovals, listPositions, listRuns, pauseStaleRuns } from "@/db";
import { day, money, price } from "@/surface/format";

export const dynamic = "force-dynamic";

export async function GET() {
  await pauseStaleRuns();
  const [positions, approvals, runs, stats] = await Promise.all([listPositions(), listPendingApprovals(), listRuns(8), getStats()]);
  const names = new Map(positions.map((p) => [p.id, p.service_name]));
  return Response.json({
    exposure: `${money(stats.exposure_cents)} per month`,
    positions: positions.map((p) => ({
      id: p.id,
      service: p.service_name,
      status: p.status,
      trial: p.has_trial === false ? "no free trial (free plan)" : p.trial_days != null ? `${p.trial_days} days` : "unknown",
      renews: p.has_trial === false ? null : p.renewal_date ? day(p.renewal_date) : null,
      price: p.renewal_price_cents == null ? null : price(p.renewal_price_cents, p.currency, p.billing_period),
      stop: p.stop_at ? day(p.stop_at) : null,
    })),
    approvals: approvals.map((a) => ({
      id: a.id,
      kind: a.kind,
      position_id: a.position_id,
      service: names.get(a.position_id) ?? "unknown",
      question: a.detail,
    })),
    runs: runs.map((r) => {
      const active = r.steps.find((s) => s.status === "active" || s.status === "failed");
      return {
        id: r.id,
        kind: r.kind === "cancel" ? "cancel" : "sign-up",
        service: r.service_name,
        status: r.status,
        step: active ? `${active.title}: ${active.detail}` : null,
        note: r.error,
        started: r.started_at,
      };
    }),
  });
}
