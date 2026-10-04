import { Webhook } from "svix";

// AgentMail signs webhooks with Svix. Docs: https://docs.agentmail.to/webhook-verification
// Headers: svix-id, svix-timestamp, svix-signature. The secret starts with "whsec_".
// Verification needs the EXACT raw request body, so never pass a re-serialized JSON object.
// svix 2.x `verify` returns undefined and throws on failure, so this module only answers
// "did AgentMail send this?". Parsing the JSON is the handler's job, after verification.

export class InvalidSignatureError extends Error {}

/** Throws InvalidSignatureError unless the signature is valid. Returns nothing. */
export type VerifyWebhook = (rawBody: string, headers: Headers) => void;

/**
 * Builds a verifier once at startup. A malformed secret throws here, at boot,
 * instead of surfacing later as a misleading "invalid signature" on every request.
 */
export function createVerifier(secret: string): VerifyWebhook {
  const webhook = new Webhook(secret);
  return (rawBody, headers) => {
    const id = headers.get("svix-id");
    const timestamp = headers.get("svix-timestamp");
    const signature = headers.get("svix-signature");
    if (!id || !timestamp || !signature) {
      throw new InvalidSignatureError("missing svix headers");
    }
    try {
      webhook.verify(rawBody, {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      });
    } catch (cause) {
      throw new InvalidSignatureError("signature verification failed", {
        cause,
      });
    }
  };
}
