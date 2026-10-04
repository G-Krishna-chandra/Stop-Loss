import { Mastra } from "@mastra/core";
import { InMemoryStore, type MastraCompositeStore } from "@mastra/core/storage";
import type { ApprovalService } from "../approval/index.js";
import type { Canceller } from "../cancel/index.js";
import {
  InvalidTransitionError,
  type Db,
  type IngestEvent,
  type IngestResult,
} from "../db/index.js";
import type { TermsLookup } from "../terms/index.js";
import type { Position } from "../types.js";
import {
  AWAIT_DECISION_STEP,
  STOP_WORKFLOW_ID,
  createStopWorkflow,
  runIdFor,
  type Decision,
} from "./workflow.js";

// The agent wires the modules into the one loop (stop-loss skill, section 2):
//   welcome email -> position + terms -> (trial-ending email OR schedule) -> approval request
//   -> human decision -> cancel -> cancellation email -> closed.
//
// Design:
//  - emit() is what src/inbox calls. It records the event through src/db and answers at once; any
//    follow-up work runs in the background, so the webhook is acknowledged quickly.
//  - Every step is idempotent and guarded by the position's status (compare-and-set in src/db),
//    so a duplicate delivery, a double resume, or a crash can repeat work without harm.
//  - sweep() is the durable safety net. Run it on startup and on a timer. It starts due stops,
//    fills in missing terms, and picks up approvals that were resolved in another process (e.g. the
//    CLI) or whose workflow run is gone. Everything it does is also race-safe.
//  - Assumes ONE agent process. Two processes would still be safe (the database settles races) but
//    could start duplicate workflow runs for the same position.

export interface AgentLog {
  level: "info" | "warn" | "error";
  msg: string;
  [field: string]: unknown;
}

export interface AgentDeps {
  db: Db;
  approval: ApprovalService;
  terms: TermsLookup;
  canceller: Canceller;
  /** Mastra storage. Defaults to in-memory; use a persistent store so suspended runs survive restarts. */
  storage?: MastraCompositeStore;
  /** Start the approval flow this many days before the renewal date. */
  stopLeadDays?: number;
  /** Give up on terms lookups after this many failures per position. */
  maxTermsAttempts?: number;
  now?: () => Date;
  log?: (entry: AgentLog) => void;
}

export interface SweepReport {
  terms_filled: number;
  stops_started: number;
  approved_resumed: number;
  approved_cancelled_directly: number;
}

export interface Agent {
  /** Hand this to src/inbox as its `emit`. */
  emit(event: IngestEvent): Promise<IngestResult>;
  sweep(): Promise<SweepReport>;
  /** Resolves when all background work started so far has finished. For tests and clean shutdown. */
  idle(): Promise<void>;
  /** Stops listening for approval decisions. */
  close(): void;
}

const NOT_SUSPENDED = /not suspended|no (suspended|snapshot)|not found/i;

export function createAgent(deps: AgentDeps): Agent {
  const { db, approval, terms, canceller } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stopLeadDays = deps.stopLeadDays ?? 3;
  const maxTermsAttempts = deps.maxTermsAttempts ?? 3;

  const jobs = new Set<Promise<unknown>>();
  const inFlight = new Set<string>(); // position ids whose stop workflow is being started

  function background(name: string, work: () => Promise<unknown>) {
    const job = work()
      .catch((error: unknown) => {
        log({ level: "error", msg: `agent.${name}.failed`, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => jobs.delete(job));
    jobs.add(job);
  }

  // ---- terms -------------------------------------------------------------------------------

  async function termsFailures(position_id: string): Promise<number> {
    return (await db.listEvents(position_id)).filter((e) => e.type === "terms.failed").length;
  }

  /** Looks up and stores the terms. Returns true if terms are now on the position. */
  async function ensureTerms(position_id: string): Promise<boolean> {
    const position = await db.getPosition(position_id);
    if (!position) return false;
    if (position.renewal_date !== null) return true;
    if ((await termsFailures(position_id)) >= maxTermsAttempts) return false;

    const found = await terms.lookupTerms({ service_name: position.service_name, service_domain: position.service_domain });
    if (!found.ok) {
      await db.appendEvent(position_id, "terms.failed", { reason: found.reason });
      log({ level: "warn", msg: "agent.terms.failed", position_id, reason: found.reason });
      return false;
    }
    await db.setTerms(position_id, found.terms);
    if (found.warnings.length > 0 || !found.official_source) {
      await db.appendEvent(position_id, "terms.note", { official_source: found.official_source, warnings: found.warnings });
    }
    return true;
  }

  // ---- the stop workflow -------------------------------------------------------------------

  async function performCancel(position_id: string): Promise<string> {
    let position: Position;
    try {
      // Claim: approved -> cancelling. Only one caller can win, so a double resume cancels once.
      position = await db.transitionPosition(position_id, "cancelling");
    } catch (error) {
      if (error instanceof InvalidTransitionError) return `not_claimed:${error.from}`;
      throw error;
    }

    const result = await canceller.cancel(position);
    const urls = { live_view_url: result.live_view_url, replay_url: result.replay_url };

    switch (result.outcome) {
      case "cancelled":
        // Stay in `cancelling`. Only the cancellation EMAIL closes the position (email proof).
        await db.appendEvent(position_id, "cancel.completed", { detail: result.detail, ...urls });
        break;
      case "retention_offer":
        await db.appendEvent(position_id, "cancel.retention_offer", { detail: result.detail, ...urls });
        // Stop and wait for a human. The offer is neither accepted nor declined here.
        await approval.requestApproval(position_id, { kind: "retention_offer", detail: result.detail });
        break;
      case "needs_login":
        await db.appendEvent(position_id, "cancel.needs_login", { detail: result.detail, ...urls });
        await db.transitionPosition(position_id, "failed", { reason: `needs login: ${result.detail}` });
        break;
      case "failed":
        await db.appendEvent(position_id, "cancel.failed", { detail: result.detail, ...urls });
        await db.transitionPosition(position_id, "failed", { reason: result.detail });
        break;
    }
    return result.outcome;
  }

  const mastra = new Mastra({
    workflows: {
      stopWorkflow: createStopWorkflow({
        requestApproval: async (position_id) => {
          try {
            return await approval.requestApproval(position_id);
          } catch (error) {
            log({ level: "warn", msg: "agent.request_approval.skipped", position_id, error: error instanceof Error ? error.message : String(error) });
            return null;
          }
        },
        performCancel,
      }),
    },
    storage: deps.storage ?? new InMemoryStore(),
  });
  const workflow = () => mastra.getWorkflow("stopWorkflow");

  /** Starts the stop flow for an open position. It runs until it suspends at the approval. */
  async function startStop(position_id: string): Promise<boolean> {
    if (inFlight.has(position_id)) return false;
    inFlight.add(position_id);
    try {
      // Starting an existing run id would restart it, so only an `open` position may start one.
      const position = await db.getPosition(position_id);
      if (!position || position.status !== "open") return false;
      await ensureTerms(position_id); // best effort: the approval can say "unknown price"
      const run = await workflow().createRun({ runId: runIdFor(position_id) });
      const result = await run.start({ inputData: { position_id } });
      log({ level: "info", msg: "agent.stop.started", position_id, status: result.status });
      return true;
    } finally {
      inFlight.delete(position_id);
    }
  }

  /** Resumes the suspended run with the human's decision. A run that already resumed is a no-op. */
  async function resumeStop(position_id: string, decision: Decision): Promise<"resumed" | "no_run"> {
    try {
      const run = await workflow().createRun({ runId: runIdFor(position_id) });
      await run.resume({ step: AWAIT_DECISION_STEP, resumeData: { decision } });
      return "resumed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (NOT_SUSPENDED.test(message)) return "no_run";
      throw error;
    }
  }

  // A human decided (any surface). Resume in the background so resolveApproval returns at once.
  const stopListening = approval.onResolved(({ approval: request }) => {
    if (request.kind !== "cancel") return;
    const decision = request.status === "approved" ? "approved" : "declined";
    background("resume", () => resumeStop(request.position_id, decision));
  });

  // ---- emails ------------------------------------------------------------------------------

  async function closeWithEvidence(position_id: string, message_id: string): Promise<void> {
    const position = await db.getPosition(position_id);
    if (position?.status === "cancelling") {
      await db.transitionPosition(position_id, "closed", { evidence_email_id: message_id });
      log({ level: "info", msg: "agent.closed", position_id });
    } else {
      // Not proof of anything we did, so it must not close the position.
      await db.appendEvent(position_id, "cancel.email_ignored", { status: position?.status ?? "unknown", message_id });
    }
  }

  function react(event: IngestEvent, result: IngestResult) {
    const position_id = result.position_id;
    if (result.duplicate || !position_id) return;
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "email.welcome":
        background("terms", () => ensureTerms(position_id));
        break;
      case "email.trial_ending":
        background("stop", () => startStop(position_id));
        break;
      case "email.cancellation": {
        const message_id = typeof payload["message_id"] === "string" ? payload["message_id"] : null;
        if (message_id) background("close", () => closeWithEvidence(position_id, message_id));
        break;
      }
    }
  }

  // ---- the durable safety net --------------------------------------------------------------

  async function sweep(): Promise<SweepReport> {
    const report: SweepReport = { terms_filled: 0, stops_started: 0, approved_resumed: 0, approved_cancelled_directly: 0 };

    for (const position of await db.listPositions({ status: ["open"] })) {
      if (position.renewal_date === null && (await ensureTerms(position.id))) report.terms_filled += 1;
    }

    const today = now().toISOString().slice(0, 10);
    for (const position of await db.listDueForStop({ today, within_days: stopLeadDays })) {
      if (await startStop(position.id)) report.stops_started += 1;
    }

    // Approved but not yet claimed: decided in another process, or a crash before the cancel.
    for (const position of await db.listPositions({ status: ["approved"] })) {
      const outcome = await resumeStop(position.id, "approved").catch(() => "no_run" as const);
      if (outcome === "resumed") {
        report.approved_resumed += 1;
      } else {
        // The workflow run is gone. The claim is still race-safe, so cancel directly.
        const label = await performCancel(position.id);
        if (!label.startsWith("not_claimed")) report.approved_cancelled_directly += 1;
      }
    }
    return report;
  }

  return {
    async emit(event) {
      const result = await db.emit(event);
      react(event, result);
      return result;
    },
    sweep,
    async idle() {
      while (jobs.size > 0) await Promise.allSettled([...jobs]);
    },
    close: stopListening,
  };
}
