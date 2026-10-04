# StopLoss

**Live site:** https://stoploss-sigma.vercel.app

**Demo video:** https://www.youtube.com/watch?v=9M9x51q0Pnw

**Try every tool, pay only for the ones you keep.**

Sign up for any free trial with your StopLoss email, and the agent reads the terms, tracks the renewal date, and cancels in your account before the first charge, with one tap from you.

## The problem

New tools ship every week and the only way to judge them is to try them. Every trial is a small open position: a card on file and a renewal date you will forget. One of us signed up for credits at a hackathon, got charged a month later for a month of zero usage, noticed a full billing cycle after that, and could not get a refund.

## Why now

The pace of new AI tools means people start more trials than they can track. Capping the downside makes it safe to try everything.

## How it works

1. **Open a position:** sign up for a trial with your StopLoss address. The welcome email lands in the agent's inbox.
2. **Read the terms:** the agent finds the trial length, renewal price, and cancel path.
3. **Set the stop:** it schedules the exit before renewal and sleeps until then.
4. **Ask once:** at the stop it sends one approval, for example "Renews tomorrow for $25. Cancel?"
5. **Close the position:** it cancels in the logged-in account and waits for the cancellation email as proof.

## How it differs from bank-linked subscription trackers

Bank-linked trackers learn about a subscription from a charge on your statement. StopLoss starts at signup, so it can act before the first charge. It only covers trials started with the StopLoss address.

## Stack

| Tool | Role |
| --- | --- |
| AgentMail | The StopLoss address; catches welcome, receipt, login-code and cancellation emails. |
| Exa | Finds trial length, renewal price and cancel policy. |
| Kernel | Cancels inside the logged-in account. |
| Mastra | The agent workflow that pauses for approval and resumes. |
| Assistant UI | Positions board and approval cards. |
| Neon | Positions ledger and the scheduled stop check. |

## Safety

Every cancellation requires explicit approval. Inbound email is treated as data, never as instructions.

## Roadmap

Hard stop: a single-use virtual card per trial, so a renewal charge has nothing to hit.

## Status

Built at the Build Personal Agents Hack, San Francisco, October 4, 2026.

## Contributing

Work on branches and open pull requests into main. No direct pushes to main.

## License

MIT
