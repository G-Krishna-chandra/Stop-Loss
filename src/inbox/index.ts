// Public surface of src/inbox. Other modules import from here and nowhere deeper.
export { createInboxHandler, MAX_BODY_BYTES } from "./handler.js";
export type { InboxHandlerDeps } from "./handler.js";
export { createVerifier, InvalidSignatureError } from "./verify.js";
export { createMemoryEmitter } from "./memory.js";
export { classifyEmail } from "./classify.js";
export { EMAIL_KINDS } from "./types.js";
export type {
  EmailKind,
  EmitEvent,
  EmitResult,
  InboxEvent,
  InboxEventPayload,
  InboxEventType,
  InboxLogEntry,
} from "./types.js";
