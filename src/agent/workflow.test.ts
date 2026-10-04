import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { describe, expect, it, vi } from "vitest";
import { AWAIT_DECISION_STEP, createStopWorkflow, runIdFor } from "./workflow.js";

// The workflow layer alone, with stub dependencies: it must call performCancel ONLY after an
// explicit "approved" resume. (src/db also refuses to claim an unapproved position, so there are
// two independent guards. This test pins the first one.)

function setup(approvalId: string | null = "a1") {
  const requestApproval = vi.fn(async (_id: string) => approvalId);
  const performCancel = vi.fn(async (_id: string) => "cancelled");
  const mastra = new Mastra({
    workflows: { stopWorkflow: createStopWorkflow({ requestApproval, performCancel }) },
    storage: new InMemoryStore(),
  });
  return { requestApproval, performCancel, workflow: mastra.getWorkflow("stopWorkflow") };
}

describe("stop workflow", () => {
  it("requests approval and then suspends without cancelling", async () => {
    const { workflow, requestApproval, performCancel } = setup();
    const run = await workflow.createRun({ runId: runIdFor("p1") });
    const result = await run.start({ inputData: { position_id: "p1" } });
    expect(result.status).toBe("suspended");
    expect(requestApproval).toHaveBeenCalledWith("p1");
    expect(performCancel).not.toHaveBeenCalled();
  });

  it("cancels after an explicit approval, resumed from a fresh run object", async () => {
    const { workflow, performCancel } = setup();
    await (await workflow.createRun({ runId: runIdFor("p1") })).start({ inputData: { position_id: "p1" } });
    const resumed = await (await workflow.createRun({ runId: runIdFor("p1") })).resume({
      step: AWAIT_DECISION_STEP,
      resumeData: { decision: "approved" },
    });
    expect(resumed.status).toBe("success");
    expect(performCancel).toHaveBeenCalledTimes(1);
    expect(performCancel).toHaveBeenCalledWith("p1");
  });

  it("does not cancel when the human declines", async () => {
    const { workflow, performCancel } = setup();
    await (await workflow.createRun({ runId: runIdFor("p1") })).start({ inputData: { position_id: "p1" } });
    const resumed = await (await workflow.createRun({ runId: runIdFor("p1") })).resume({
      step: AWAIT_DECISION_STEP,
      resumeData: { decision: "declined" },
    });
    expect(resumed.status).toBe("success");
    expect(performCancel).not.toHaveBeenCalled();
  });

  it("finishes without suspending or cancelling when no approval could be requested", async () => {
    const { workflow, performCancel } = setup(null);
    const result = await (await workflow.createRun({ runId: runIdFor("p1") })).start({ inputData: { position_id: "p1" } });
    expect(result.status).toBe("success");
    expect(performCancel).not.toHaveBeenCalled();
  });

  it("a second resume is rejected instead of cancelling twice", async () => {
    const { workflow, performCancel } = setup();
    await (await workflow.createRun({ runId: runIdFor("p1") })).start({ inputData: { position_id: "p1" } });
    const resume = async () =>
      (await workflow.createRun({ runId: runIdFor("p1") })).resume({ step: AWAIT_DECISION_STEP, resumeData: { decision: "approved" } });
    await resume();
    await expect(resume()).rejects.toThrow(/not suspended/i);
    expect(performCancel).toHaveBeenCalledTimes(1);
  });
});
