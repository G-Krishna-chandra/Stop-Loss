---
name: hackathon
description: Event requirements, judging, prizes, demo plan and UI options for the Build Personal Agents Hack (Oct 4, 2026). Load with the stop-loss skill when planning the demo, any user-facing surface, or extra features.
---

# Hackathon context: Build Personal Agents Hack

This file adds event context. It never overrides `.claude/skills/stop-loss/SKILL.md`.
If the two disagree, the stop-loss skill wins and the team resolves it. In particular:
the user-facing surface is still an OPEN DECISION there (section 3). Nothing here picks it.

## 1. Event facts

- Date and place: Oct 4, 2026, Terra Gallery, San Francisco.
- Co-hosts and tools: Neon, Mastra, Exa, Fly.io, Kernel, Executor, Assistant UI, AgentMail.
- Side quests: Best Open Source (CodeRabbit, $10k) and Best UI (Assistant UI, $750).
- Submissions close 4:30 PM PT. The top 6 present: 2 minutes, then 1 minute of Q&A.
- Verify prize amounts and rules on the Luma page before relying on them. They can change.

## 2. What judging rewards (working assumptions, not published criteria)

- Sponsor tools used in a way that is central to the product, not bolted on.
- A demo that works live on a real account. Mock only what is not the core loop.
- A story a judge repeats in one sentence: "It cancels your free trial before the first charge."
- Visible wow: the browser cancelling live, with a number going down.

## 3. Demo plan (3 minutes total)

1. 0:00 The problem in one line: trials charge you before you remember them.
2. 0:20 Sign up for a real trial with the StopLoss address. The welcome email lands. A position appears.
3. 0:50 Terms found (Exa): trial length, price, cancel path, with source links.
4. 1:15 Stop turns pending. The approval request appears. A human approves.
5. 1:30 Kernel cancels in the logged-in account. Show the live view. Show 2+ positions in parallel.
6. 2:15 The cancellation email arrives. The position closes. Exposure drops.
7. 2:40 One line on safety: no auto-cancel, email is data not instructions, retention offers wait for a human.

Always have the 60-second backup recording ready by 3:30 PM. Rehearse the demo twice.

## 4. UI: options, not a decision

Best UI is a $750 side quest, and the live demo needs something to look at, so the surface
decision should be made early. Options, each calling only `resolveApproval` (see stop-loss section 3):

| Option | Good for | Cost |
| --- | --- | --- |
| Assistant UI positions board + approval cards | Best UI prize, visual demo | Most work, a web app |
| Plain page or endpoint with approve/decline buttons | Fast, safe fallback | Plain look |
| Email reply to approve | Matches "email-first" story | Weak visually |
| CLI | Dev and 1:00 PM milestone | Not demo-friendly |

Note: the README mentions an Assistant UI positions board while the stop-loss skill says the
surface is undecided. The team should write the decision into stop-loss section 3 first.

If a web surface is chosen, it lives in `src/surface/` only, reads positions through `src/db`,
and talks to the workflow only through `src/approval`. Elements worth building:

- Exposure meter: total `renewal_price_cents` of `open` + `stop_pending` positions, dropping as stops close.
- Position cards with status, renewal date and a countdown.
- Approval card: price, date, source links, Approve / Keep.
- Embedded Kernel live view per cancelling position.
- Email-proof timeline per position (welcome, terms, approval, cancel, proof).
- Retention-offer card that waits for a human.

## 5. Feature ideas, in priority order

Only after the loop in stop-loss section 2 works once (1:00 PM).

1. Exposure meter and positions board (visual payoff for little logic).
2. Live view and replay links on each position (Kernel already provides them).
3. Parallel cancel view showing several sessions at once.
4. Email-proof timeline per position.
5. Retention-offer approval card.
6. Stretch, out of scope today: virtual cards, importing existing subscriptions, bank linking.

## 6. Open Source side quest

- Keep the repo public, MIT licensed, with a README that explains the flow and the safety rules.
- Keep PRs small and address CodeRabbit comments (it reviews every PR).
- Never commit secrets. Keep `.env.example` current.
- Tests and per-module READMEs help the open-source story.

## 7. Checklist before submitting (by 4:30 PM)

- Submission form filled in, repo link works, README has run steps.
- Demo account and test services still logged in.
- Backup recording uploaded.
- Presenter and demo driver agreed for the 2 minutes plus Q&A.

## 8. Credits and keys to claim at the hackathon

Sign in at the venue and claim credits for each sponsor tool. Keys go in `.env` (never committed;
`.env.example` lists the names). Order below is the order we need them, because each unblocks
the next milestone. Tick a row when the key is in `.env` AND a real call has worked.

| Done | Tool | Env vars | Used by | Needed for | Docs |
| --- | --- | --- | --- | --- | --- |
| [ ] | AgentMail | `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` | `src/inbox` | Real inbound email. Nothing starts without it. The running code only needs the webhook secret; the API key is for creating the inbox and webhook (setup script, still to do). Register the webhook URL (public, see Fly.io). | https://docs.agentmail.to |
| [ ] | Neon | `DATABASE_URL` | `src/db` | Real storage. Run `npm run db:migrate` once, then re-check with a real welcome email. Dev works without it (in-memory). | https://neon.com/docs |
| [ ] | Exa | `EXA_API_KEY` | `src/terms` | Trial length, price and cancel path. | https://exa.ai/docs |
| [ ] | Kernel | `KERNEL_API_KEY`, `KERNEL_PROJECT_ID` | `src/cancel` | Browser sessions that cancel, plus live view and replay URLs. Must support parallel sessions. | https://kernel.sh/docs |
| [ ] | Model access | `AI_GATEWAY_API_KEY` | `src/agent` | NOT needed for the core loop. The agent is a deterministic Mastra workflow with no LLM in it, on purpose (no model output can trigger a cancel). Only needed if we add an LLM step, e.g. smarter cancel navigation. | https://mastra.ai/docs |
| [ ] | Fly.io | (account login) | deploy | A public URL so AgentMail can reach the webhook. A tunnel works for dev. This is our inference, confirm the plan. | https://fly.io/docs |
| [ ] | Assistant UI | none expected | `src/surface` | Only if the UI decision picks it. Best UI side quest. | https://assistant-ui.com/docs |
| [ ] | Executor | unknown | unknown | Not part of our plan yet. Ask what it offers before spending time. | event page |

Rules: check each tool's docs for the exact call before using it. Do not paste keys into chat,
logs, issues or PRs. If a credit code is needed, redeem it in the sponsor's own dashboard.

## 9. Running the loop

The modules are built and tested (`npm test`). `scripts/run-agent.ts` wires them into one server.

- Rehearse with no keys: `AGENTMAIL_WEBHOOK_SECRET=whsec_<any base64> DEV_APPROVAL_TOKEN=<any> npm run agent:run -- --fake`,
  then in another terminal `npm run inbox:fake -- "Welcome to Notion"`, then `"Your free trial ends tomorrow"`,
  `GET /approvals` and `POST /approvals/:id/approve` with header `x-dev-token`, then `"Your subscription has been cancelled"`.
- Real run: fill `.env` (see section 8, check with `npm run check:env`), `npm run db:migrate`, then `npm run agent:run`.
- Safety: nothing cancels without `resolveApproval(id, "approved")`. The dev approval endpoints are disabled unless `DEV_APPROVAL_TOKEN` is set.

Still to do (needs keys, so last): per-service cancel recipes in `src/cancel/recipes.ts` tested on the 2 or 3 chosen
services, a persistent Mastra store (so suspended runs survive a restart; the sweep already covers crashes), the AgentMail
inbox and webhook setup script, making `KERNEL_PROJECT_ID` optional in `check:env`, and the UI decision.
