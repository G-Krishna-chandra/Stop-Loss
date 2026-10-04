// Public surface of src/approval. Any surface (CLI, HTTP, web UI, ...) and src/agent import
// from here and nowhere deeper. No UI code lives in this module.
export { createApprovalService } from "./service.js";
export type {
  ApprovalService,
  PendingApproval,
  RequestOptions,
  ResolveMeta,
  ResolvedHandler,
  Resolution,
} from "./service.js";
export { ApprovalNotAllowedError, PositionChangedError, ResumeFailedError } from "./errors.js";
export { describeCancel, formatMoney, sanitizeDetail } from "./detail.js";
