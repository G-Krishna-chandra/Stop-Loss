// AgentMail: the StopLoss address, reading mail, and classifying what arrives (skill section 6).
export { ensureInbox, getMessage, listInbox, stopLossAddress } from "./agentmail";
export type { FullMessage, InboxListItem } from "./agentmail";
export { classify, parseSender, serviceName } from "./classify";
export type { Sender } from "./classify";
export { verifyReceived, WebhookError } from "./webhook";
export type { ReceivedRef } from "./webhook";
