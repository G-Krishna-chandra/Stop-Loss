import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

// The stop workflow for ONE position, as a Mastra workflow that suspends at the approval and
// resumes when a human decides (stop-loss skill, section 5):
//
//   request-approval -> await-decision (SUSPENDS) -> cancel
//
// The workflow only orchestrates. The logic (and every safety rule) lives in the injected
// functions, which are idempotent and race-safe, so a repeated resume or a restart is harmless.
// There is deliberately no LLM in this loop: email and web text are data, and no model output
// can trigger a cancel. A cancel needs a human decision.

export const STOP_WORKFLOW_ID = "stop-workflow";
export const AWAIT_DECISION_STEP = "await-decision";

export const runIdFor = (position_id: string) => `stop-${position_id}`;

export interface StopFlowDeps {
  /** Moves the position to stop_pending and raises the approval. Null when it is not allowed. */
  requestApproval(position_id: string): Promise<string | null>;
  /** Claims the approved position and runs one cancel attempt. Returns a short outcome label. */
  performCancel(position_id: string): Promise<string>;
}

export const Decision = z.enum(["approved", "declined"]);
export type Decision = z.infer<typeof Decision>;

export function createStopWorkflow(deps: StopFlowDeps) {
  const requestApproval = createStep({
    id: "request-approval",
    inputSchema: z.object({ position_id: z.string() }),
    outputSchema: z.object({ position_id: z.string(), approval_id: z.string().nullable() }),
    execute: async ({ inputData }) => ({
      position_id: inputData.position_id,
      approval_id: await deps.requestApproval(inputData.position_id),
    }),
  });

  const awaitDecision = createStep({
    id: AWAIT_DECISION_STEP,
    inputSchema: z.object({ position_id: z.string(), approval_id: z.string().nullable() }),
    outputSchema: z.object({ position_id: z.string(), decision: z.enum(["approved", "declined", "none"]) }),
    resumeSchema: z.object({ decision: Decision }),
    suspendSchema: z.object({ position_id: z.string(), approval_id: z.string() }),
    execute: async ({ inputData, resumeData, suspend }) => {
      if (inputData.approval_id === null) return { position_id: inputData.position_id, decision: "none" as const };
      if (!resumeData) {
        return await suspend({ position_id: inputData.position_id, approval_id: inputData.approval_id });
      }
      return { position_id: inputData.position_id, decision: resumeData.decision };
    },
  });

  const cancel = createStep({
    id: "cancel",
    inputSchema: z.object({ position_id: z.string(), decision: z.enum(["approved", "declined", "none"]) }),
    outputSchema: z.object({ position_id: z.string(), outcome: z.string() }),
    execute: async ({ inputData }) => ({
      position_id: inputData.position_id,
      // Only an explicit human "approved" ever reaches performCancel.
      outcome: inputData.decision === "approved" ? await deps.performCancel(inputData.position_id) : `skipped:${inputData.decision}`,
    }),
  });

  return createWorkflow({
    id: STOP_WORKFLOW_ID,
    inputSchema: z.object({ position_id: z.string() }),
    outputSchema: z.object({ position_id: z.string(), outcome: z.string() }),
  })
    .then(requestApproval)
    .then(awaitDecision)
    .then(cancel)
    .commit();
}
