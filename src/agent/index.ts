// The StopLoss agent: reacts to inbound email, sets stops, and runs cancels and sign-ups after approval.
// It may call other modules through their index.ts (skill section 6). Long work runs in after() from src/app.
import { CANCEL_STEPS, runCancel, runSignup, SIGNUP_STEPS } from "@/cancel";
import { requestApproval } from "@/approval";
import {
  addEvent,
  applyTerms,
  createRun,
  dueStops,
  findLivePositionByDomain,
  getPosition,
  getRun,
  openPosition,
  recordEmail,
  setEvidence,
  transition,
  updateEmailOutcome,
  updateRun,
  advanceRun,
} from "@/db";
import { classify, ensureInbox, getMessage, listInbox, parseSender, serviceName, stopLossAddress } from "@/inbox";
import { lookupTerms } from "@/terms";
import type { AgentRun, ApprovalRequest, Position } from "@/types";

function dollars(cents: number | null, currency: string): string {
  return cents == null ? "an unknown price" : `${currency === "USD" ? "$" : currency + " "}${(cents / 100).toFixed(2)}`;
}

function when(iso: string | null): string {
  if (!iso) return "an unknown date";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.DISPLAY_TIME_ZONE ?? "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Reads the newest login code or sign-in link sent to the StopLoss address by `domain` since `since`.
// The code goes straight into the browser; it is never stored or shown to the model.
function emailLoginFor(domain: string) {
  return async (since: Date): Promise<{ code: string | null; link: string | null }> => {
    const items = await listInbox(15);
    for (const item of items) {
      if (new Date(item.received_at) < since) continue;
      if (parseSender(item.from).domain !== domain) continue;
      const m = await getMessage(item.message_id);
      const body = `${m.subject}\n${m.text}`;
      const code = body.match(/\b(\d{6,8})\b/)?.[1] ?? body.match(/\bcode[:\s]+([A-Z0-9]{5,10})\b/i)?.[1] ?? null;
      const links = [...(m.html ?? m.text).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]);
      const link =
        links.find((l) => /(verify|confirm|magic|login|log-in|signin|sign-in|auth|token)/i.test(l) && new URL(l).hostname.endsWith(domain)) ??
        null;
      if (code || link) return { code, link };
    }
    return { code: null, link: null };
  };
}

// --- Inbound email ---------------------------------------------------------------------------------

export async function handleInboundEmail(messageId: string): Promise<void> {
  const msg = await getMessage(messageId);
  const sender = parseSender(msg.from);
  const name = serviceName(sender);
  const category = classify(msg.subject, msg.text);
  const fresh = await recordEmail({
    message_id: msg.message_id,
    thread_id: msg.thread_id,
    inbox_id: (await ensureInbox()).inboxId,
    from_address: sender.address,
    from_name: sender.name,
    subject: msg.subject,
    preview: msg.preview,
    received_at: msg.received_at,
    category,
    action: "ignored",
    position_id: null,
    extracted: { service_name: name, service_domain: sender.domain },
  });
  if (!fresh) return; // A webhook retry for mail we already handled.

  const live = await findLivePositionByDomain(sender.domain);

  if (category === "welcome" || (category === "receipt" && !live)) {
    const { position, created } = await openPosition({
      service_name: name,
      service_domain: sender.domain,
      signup_email: msg.to[0] ?? (await stopLossAddress()),
      created_by: "email",
      evidence_email_id: msg.message_id,
      opened_at: msg.received_at,
    });
    if (created) await addEvent(position.id, "position_opened", "Position opened", `Detected from ${name}'s welcome email`);
    await addEvent(position.id, "email_received", "Email received", msg.subject, { message_id: msg.message_id });
    await updateEmailOutcome(msg.message_id, { action: created ? "position_created" : "terms_updated", position_id: position.id });
    await readTerms(position, msg.text, msg.message_id);
    return;
  }

  if (category === "trial_ending" && live) {
    await addEvent(live.id, "email_received", "Trial ending email", msg.subject, { message_id: msg.message_id });
    if (live.status === "open") {
      await requestApproval(live, "cancel");
      await addEvent(live.id, "stop_pending", "Stop triggered", `${name} says the trial is ending`);
    }
    await updateEmailOutcome(msg.message_id, { action: "stop_triggered", position_id: live.id });
    return;
  }

  if (category === "cancellation" && live) {
    await setEvidence(live.id, msg.message_id);
    await transition(live.id, ["open", "stop_pending", "approved", "cancelling", "failed"], "closed");
    await addEvent(live.id, "proof_received", "Confirmation received", `We received a confirmation email from ${name}`, {
      message_id: msg.message_id,
    });
    await addEvent(live.id, "position_closed", "Subscription closed", "Your subscription has been cancelled and will not renew");
    await updateEmailOutcome(msg.message_id, { action: "proof_received", position_id: live.id });
    return;
  }

  await updateEmailOutcome(msg.message_id, {
    action: category === "login_code" ? "login_code" : "ignored",
    position_id: live?.id ?? null,
  });
}

async function readTerms(position: Position, emailText: string, messageId: string | null): Promise<Position> {
  const terms = await lookupTerms({
    service_name: position.service_name,
    service_domain: position.service_domain,
    emailText,
  });
  const updated = await applyTerms(position.id, terms);
  await addEvent(
    position.id,
    "terms_found",
    "Terms extracted",
    updated.trial_days != null
      ? `${updated.trial_days}-day trial, then ${dollars(updated.renewal_price_cents, updated.currency)}${updated.billing_period ? "/" + updated.billing_period : ""}`
      : "Trial length not found yet",
    { source_urls: terms.source_urls },
  );
  if (messageId) {
    await updateEmailOutcome(messageId, {
      action: "position_created",
      position_id: position.id,
      extracted: {
        service_name: updated.service_name,
        service_domain: updated.service_domain,
        trial_days: updated.trial_days,
        renewal_price_cents: updated.renewal_price_cents,
        currency: updated.currency,
        billing_period: updated.billing_period,
        cancel_url: updated.cancel_url,
        renewal_date: updated.renewal_date ?? undefined,
      },
    });
  }
  if (updated.stop_at) {
    await addEvent(position.id, "stop_set", "Stop set", `StopLoss will ask you on ${when(updated.stop_at)}`);
    if (new Date(updated.stop_at) <= new Date()) await requestApproval(updated, "cancel");
  }
  return updated;
}

// --- Scheduled stop check ------------------------------------------------------------------------

export async function checkStops(): Promise<number> {
  const due = await dueStops();
  for (const p of due) {
    await requestApproval(p, "cancel");
    await addEvent(p.id, "stop_pending", "Stop reached", `Renews ${when(p.renewal_date)} for ${dollars(p.renewal_price_cents, p.currency)}`);
  }
  return due.length;
}

// --- After an approval ---------------------------------------------------------------------------

// Returns a run to start in after(), or null when nothing needs to run.
export async function afterApproval(request: ApprovalRequest): Promise<AgentRun | null> {
  if (request.status !== "approved") return null;
  const position = await getPosition(request.position_id);
  if (!position) return null;
  return prepareCancel(position);
}

export async function prepareCancel(position: Position): Promise<AgentRun> {
  const run = await createRun({
    kind: "cancel",
    service_name: position.service_name,
    position_id: position.id,
    target_url: position.cancel_url ?? `https://${position.service_domain}`,
    steps: CANCEL_STEPS,
  });
  await transition(position.id, ["approved", "stop_pending", "open", "failed"], "cancelling");
  await addEvent(position.id, "run_started", "Cancellation requested", "StopLoss opened a live browser to cancel", { run_id: run.id });
  return run;
}

export async function executeCancel(runId: string, opts: { resume?: boolean } = {}): Promise<void> {
  const run = await getRun(runId);
  const position = run?.position_id ? await getPosition(run.position_id) : null;
  if (!run || !position) return;
  const approvedOffer = position.status === "cancelling" && run.error?.toLowerCase().includes("offer") === true;
  const result = await runCancel(runId, position, { emailLogin: emailLoginFor(position.service_domain) }, {
    userDeclinedOffer: approvedOffer,
    resume: opts.resume,
  });

  if (result.outcome === "cancelled") {
    await addEvent(position.id, "run_finished", "Cancellation submitted", result.detail || "The page shows the plan as cancelled", {
      run_id: runId,
      replay_url: result.replay_url,
    });
  } else if (result.outcome === "retention_offer") {
    await requestApproval(position, "retention_offer", result.detail);
  } else if (result.outcome === "needs_login") {
    await addEvent(position.id, "run_step", "Sign-in needed", "Sign in through the live browser, then continue", { run_id: runId });
  } else {
    await transition(position.id, ["cancelling", "approved"], "failed", result.detail);
    await addEvent(position.id, "position_failed", "Cancel not confirmed", `${result.detail} StopLoss did not retry.`, {
      run_id: runId,
      replay_url: result.replay_url,
    });
  }
}

// A retention offer was answered "cancel anyway": continue in a fresh run that declines offers.
export async function afterRetentionOffer(request: ApprovalRequest): Promise<AgentRun | null> {
  if (request.status !== "approved" || request.kind !== "retention_offer") return null;
  const position = await getPosition(request.position_id);
  if (!position) return null;
  const run = await createRun({
    kind: "cancel",
    service_name: position.service_name,
    position_id: position.id,
    target_url: position.cancel_url ?? `https://${position.service_domain}`,
    steps: CANCEL_STEPS,
  });
  await updateRun(run.id, { error: "User declined the retention offer" });
  return run;
}

// --- Agent sign-up -------------------------------------------------------------------------------

export async function prepareSignup(url: string): Promise<AgentRun> {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  const domain = parsed.hostname.replace(/^www\./, "");
  const name = domain.split(".")[0].replace(/^./, (c) => c.toUpperCase());
  return createRun({ kind: "signup", service_name: name, position_id: null, target_url: parsed.toString(), steps: SIGNUP_STEPS });
}

export async function executeSignup(runId: string, opts: { resume?: boolean } = {}): Promise<void> {
  const run = await getRun(runId);
  if (!run?.target_url) return;
  const url = new URL(run.target_url);
  const domain = url.hostname.replace(/^www\./, "");
  const email = await stopLossAddress();
  const result = await runSignup(
    runId,
    { url: url.toString(), name: run.service_name, domain, email, fullName: process.env.STOPLOSS_FULL_NAME ?? "StopLoss User" },
    { emailLogin: emailLoginFor(domain) },
    opts,
  );

  if (result.outcome === "done") {
    const { position, created } = await openPosition({
      service_name: run.service_name,
      service_domain: domain,
      signup_email: email,
      created_by: "signup_run",
    });
    if (created) await addEvent(position.id, "position_opened", "Account created", "StopLoss signed up in a live browser", { run_id: runId });
    await advanceRun(runId, "position", "Position created", "done");
    await updateRun(runId, { status: "succeeded", position_id: position.id, replay_url: result.replayUrl });
    await readTerms(position, "", null);
  } else if (result.outcome === "needs_card") {
    await advanceRun(runId, "payment", "Enter your card in the live browser, then continue", "active");
    await updateRun(runId, { status: "paused", error: result.detail });
  } else {
    const fresh = await getRun(runId);
    const steps = (fresh?.steps ?? []).map((s) => (s.status === "active" ? { ...s, status: "failed" as const, detail: result.detail } : s));
    await updateRun(runId, { status: "failed", error: result.detail, steps, replay_url: result.replayUrl });
  }
}
