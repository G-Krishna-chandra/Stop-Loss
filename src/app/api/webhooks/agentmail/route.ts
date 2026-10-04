// AgentMail message.received webhook. Verifies the signature, answers 200 fast, and handles the email in after().
import { after } from "next/server";
import { handleInboundEmail } from "@/agent";
import { ensureInbox, verifyReceived, WebhookError } from "@/inbox";

export const maxDuration = 300;

export async function POST(req: Request) {
  const raw = await req.text();
  let ref;
  try {
    ref = verifyReceived(raw, req.headers);
  } catch (err) {
    if (err instanceof WebhookError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  if (!ref) return Response.json({ ok: true, ignored: "not message.received" });

  const { inboxId } = await ensureInbox();
  if (ref.inboxId !== inboxId) return Response.json({ ok: true, ignored: "another inbox" });

  after(async () => {
    try {
      await handleInboundEmail(ref.messageId);
    } catch (err) {
      console.error("[agentmail webhook] failed to handle message", ref.messageId, err instanceof Error ? err.message : err);
    }
  });
  return Response.json({ ok: true });
}
