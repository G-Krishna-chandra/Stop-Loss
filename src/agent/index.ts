// Public surface of src/agent. Wire it up in your composition root (a script or server):
//   const agent = createAgent({ db, approval, terms, canceller });
//   inbox handler  -> emit: agent.emit
//   on startup and on a timer -> agent.sweep()
export { createAgent } from "./agent.js";
export type { Agent, AgentDeps, AgentLog, SweepReport } from "./agent.js";
export { STOP_WORKFLOW_ID, createStopWorkflow, runIdFor } from "./workflow.js";
