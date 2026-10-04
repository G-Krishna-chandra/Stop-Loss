// The StopLoss agent: reacts to inbound email, sets stops, and runs cancels and sign-ups after approval.
// It may call other modules through their index.ts (skill section 6). Long work runs in after() from src/app.
import { CANCEL_STEPS, type CardFieldBinding, runCancel, runSignup, SIGNUP_STEPS } from "@/cancel";
import { fillCard, getCardStatus, requestCard, vaultName, waitForCard } from "@/cards";
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
import { classify, ensureInbox, getMessage, htmlToText, listInbox, parseSender, registrableDomain, serviceName, stopLossAddress } from "@/inbox";
import { lookupTerms, lookupWebTerms } from "@/terms";
import type { AgentRun, ApprovalRequest, Position, Terms } from "@/types";

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

// Reads the newest login code or sign-in link sent to the StopLoss address since `since`.
// First choice: mail from the service's own domain (chat.openai.com and its mail from openai.com both reduce to
// openai.com). Fallback: the newest login-code or verification email, since the agent just asked for one.
// The code goes straight into the browser; it is never stored or shown to the model.
// A number right after the word "code" wins over any other long number in the email.
function findCode(text: string): string | null {
  return (
    text.match(/\bcode\b[^\d]{0,120}?\b(\d{4,8})\b/i)?.[1] ??
    text.match(/\b(\d{6,8})\b/)?.[1] ??
    text.match(/\bcode[:\s]+([A-Z0-9]{5,10})\b/i)?.[1] ??
    null
  );
}

function emailLoginFor(domain: string) {
  const site = registrableDomain(domain);
  return async (since: Date): Promise<{ code: string | null; link: string | null }> => {
    const recent = (await listInbox(15)).filter((item) => new Date(item.received_at) >= since);
    const fromSite = recent.filter((item) => parseSender(item.from).domain === site);
    const codeLike = recent.filter((item) => ["login_code", "account_setup"].includes(classify(item.subject, item.preview)));
    for (const item of [...fromSite, ...codeLike]) {
      const m = await getMessage(item.message_id);
      const senderSite = parseSender(m.from).domain;
      // Read the HTML too: some senders (Semrush) put a "cannot be displayed" placeholder in the text part.
      const code = findCode(`${m.subject}\n${m.text}\n${m.html ? htmlToText(m.html) : ""}`);
      const links = [...(m.html ?? m.text).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]);
      const link =
        links.find((l) => {
          if (!/(verify|confirm|magic|login|log-in|signin|sign-in|auth|token)/i.test(l)) return false;
          const host = registrableDomain(new URL(l).hostname);
          return host === site || host === senderSite;
        }) ?? null;
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

function describeOffer(name: string, t: Terms): string {
  if (t.has_trial === false) return `${name} offers no free trial of a paid plan, only a free plan.`;
  const length = t.trial_days != null ? `a ${t.trial_days}-day free trial` : "a free trial (length not found)";
  const plan = t.plan_name ? ` of ${t.plan_name}` : "";
  const after =
    t.renewal_price_cents != null
      ? `, then ${dollars(t.renewal_price_cents, t.currency)}${t.billing_period ? "/" + t.billing_period : ""}`
      : "";
  return `${length}${plan}${after}.`;
}

const cardKey = (runId: string) => `trial-${runId}`;

// Issues this run's single-use Link card (once), waits a bounded time for the user's approval in Link, then has
// Kernel fill it into the checkout. The model only ever sees the messages returned here.
function payWithCardFor(runId: string, serviceName: string) {
  return async ({ pageUrl, bindings }: { pageUrl: string; bindings: CardFieldBinding[] }): Promise<string> => {
    let origin: string;
    try {
      const u = new URL(pageUrl);
      if (u.protocol !== "https:") return "The checkout page isn't https, so the single-use card can't be used here.";
      origin = u.origin;
    } catch {
      return "Couldn't read the checkout page address.";
    }
    const key = cardKey(runId);
    let progress = await requestCard({
      key,
      merchantName: serviceName,
      merchantUrl: origin,
      amountCents: 100,
      context:
        `Start a free trial of ${serviceName} at ${origin}. No charge is expected today; the card is capped at $1.00 ` +
        "for a verification. It is for this one trial sign-up only and must not be used for the renewal or any later charge.",
    }).catch((err: unknown) => ({ state: "failed" as const, detail: err instanceof Error ? err.message : "Link error" }));

    if (progress.state === "awaiting_approval") {
      await updateRun(runId, { card_note: "Approve the $1.00 single-use card in Link to continue.", card_action_url: progress.approvalUrl });
      await advanceRun(runId, "payment", "Waiting for you to approve the single-use card in Link");
      for (let i = 0; i < 3 && progress.state === "awaiting_approval"; i++) {
        progress = await waitForCard(key, 60).catch(() => progress);
      }
      if (progress.state === "awaiting_approval") {
        return "The user hasn't approved the card in Link yet. Finish with needs_card so they can approve it and press Continue.";
      }
    }
    await updateRun(runId, { card_note: null, card_action_url: null });
    if (progress.state === "failed") return `The single-use card couldn't be issued: ${progress.detail} Finish with needs_card.`;

    await advanceRun(runId, "payment", `Filling single-use card${progress.last4 ? ` •••• ${progress.last4}` : ""}, capped at $1`);
    const browserId = (await getRun(runId))?.browser_session_id;
    if (!browserId) return "The browser session is gone. Finish with failed.";
    const filled = await fillCard({ key, browserId, pageUrl, bindings });
    if (filled.status === "completed") {
      return `Card filled${progress.last4 ? ` (•••• ${progress.last4})` : ""}. Check the form, then submit it once.`;
    }
    return `The card fill ended ${filled.status} (${filled.detail}). Do not retry. Finish with failed and say what happened.`;
  };
}

function failSteps(run: AgentRun | null, detail: string) {
  return (run?.steps ?? []).map((s) => (s.status === "active" ? { ...s, status: "failed" as const, detail } : s));
}

export async function executeSignup(runId: string, opts: { resume?: boolean } = {}): Promise<void> {
  const run = await getRun(runId);
  if (!run?.target_url) return;
  const url = new URL(run.target_url);
  const domain = url.hostname.replace(/^www\./, "");
  const email = await stopLossAddress();

  // Research first: only start a run when there is a real trial to start. A free plan is not a position.
  if (!opts.resume) await advanceRun(runId, "research", "Checking whether there is a free trial");
  const terms = await lookupWebTerms(run.service_name, domain).catch(() => null);
  if (!opts.resume && terms?.has_trial === false) {
    const detail = `${run.service_name} has no free trial of a paid plan, only a free plan, so StopLoss didn't create an account.`;
    await updateRun(runId, { status: "failed", error: detail, steps: failSteps(await getRun(runId), detail) });
    return;
  }
  const offer = terms ? describeOffer(run.service_name, terms) : "Not found. Look for a free trial on the pricing page.";
  if (!opts.resume) await advanceRun(runId, "research", `Found ${offer}`, "done");

  const cardsOn = (await getCardStatus()).state === "connected";
  const result = await runSignup(
    runId,
    { url: url.toString(), name: run.service_name, domain, email, fullName: process.env.STOPLOSS_FULL_NAME ?? "StopLoss User", offer },
    { emailLogin: emailLoginFor(domain), ...(cardsOn ? { payWithCard: payWithCardFor(runId, run.service_name) } : {}) },
    { ...opts, ...(cardsOn ? { vault: vaultName() } : {}) },
  );

  if (result.outcome === "done") {
    const card = cardsOn ? await waitForCard(cardKey(runId), 1).catch(() => null) : null;
    const { position, created } = await openPosition({
      service_name: run.service_name,
      service_domain: domain,
      signup_email: email,
      created_by: "signup_run",
      card_last4: card && card.state !== "failed" ? card.last4 : null,
    });
    if (created) await addEvent(position.id, "position_opened", "Trial started", `StopLoss started ${offer}`, { run_id: runId });
    await advanceRun(runId, "position", "Position created", "done");
    await updateRun(runId, { status: "succeeded", position_id: position.id, replay_url: result.replayUrl });
    if (terms) {
      const updated = await applyTerms(position.id, { ...terms, has_trial: true });
      await addEvent(position.id, "terms_found", "Terms extracted", offer, { source_urls: terms.source_urls });
      if (updated.stop_at) await addEvent(position.id, "stop_set", "Stop set", `StopLoss will ask you on ${when(updated.stop_at)}`);
    } else {
      await readTerms(position, "", null);
    }
  } else if (result.outcome === "no_trial") {
    await advanceRun(runId, "confirm_trial", "Account created on the free plan. No trial to watch.", "done");
    await updateRun(runId, { status: "succeeded", error: result.detail, replay_url: result.replayUrl });
  } else if (result.outcome === "needs_card") {
    await advanceRun(runId, "payment", "Enter your card in the live browser, then continue", "active");
    await updateRun(runId, { status: "paused", error: result.detail });
  } else {
    const fresh = await getRun(runId);
    const steps = (fresh?.steps ?? []).map((s) => (s.status === "active" ? { ...s, status: "failed" as const, detail: result.detail } : s));
    await updateRun(runId, { status: "failed", error: result.detail, steps, replay_url: result.replayUrl });
  }
}
