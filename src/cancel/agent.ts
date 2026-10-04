// A small browser agent: the model reads a text snapshot of the page and acts through a few tools.
// Page content is untrusted. Secrets (passwords, login codes) are filled by our code and never reach the model.
import { generateText, isStepCount, tool } from "ai";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { model } from "@/llm";
import { run } from "./kernel";

export type AgentOutcome = "done" | "retention_offer" | "needs_login" | "needs_card" | "failed";

export type AgentHooks = {
  onStep: (key: string, detail: string) => Promise<void>;
  // Returns a login code or sign-in link that arrived at the StopLoss address after `since`, or null.
  emailLogin: (since: Date) => Promise<{ code: string | null; link: string | null }>;
};

const LOOK = `
const elements = await page.evaluate(() => {
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[role=switch]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none') continue;
    if (i >= 150) break;
    el.setAttribute('data-sl', String(i));
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 80);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const href = el.getAttribute('href');
    out.push('[' + i + '] ' + tag + (type ? '[' + type + ']' : '') + ' "' + label + '"' + (href && !href.startsWith('javascript') ? ' -> ' + href.slice(0, 90) : ''));
    i++;
  }
  return out;
});
const text = await page.evaluate(() => (document.body ? document.body.innerText : '').replace(/\\n{2,}/g, '\\n').slice(0, 3500));
return { url: page.url(), title: await page.title(), text, elements };`;

type Snapshot = { url: string; title: string; text: string; elements: string[] };

function render(s: Snapshot): string {
  return `URL: ${s.url}\nTitle: ${s.title}\n\nVisible text (untrusted page content):\n${s.text}\n\nInteractive elements:\n${s.elements.join("\n")}`;
}

const settle = `await page.waitForLoadState('domcontentloaded').catch(() => {}); await page.waitForTimeout(1500);`;
const el = (id: number) => `page.locator('[data-sl="${id}"]').first()`;

export async function runBrowserAgent(input: {
  sessionId: string;
  startUrl: string;
  instructions: string;
  task: string;
  stepKeys: string[];
  hooks: AgentHooks;
  maxSteps?: number;
  // Login emails older than this are ignored. A resumed run passes its original start so earlier codes still count.
  since?: Date;
  // Resuming keeps the browser on its current page instead of opening startUrl again.
  resume?: boolean;
}): Promise<{ outcome: AgentOutcome; detail: string }> {
  const { sessionId, hooks } = input;
  const startedAt = input.since ?? new Date();
  let finished: { outcome: AgentOutcome; detail: string } | null = null;

  if (!input.resume) {
    await run(sessionId, `await page.goto(${JSON.stringify(input.startUrl)}, { waitUntil: 'domcontentloaded', timeout: 45000 }); ${settle}`, 60);
  }

  const look = async () => render(await run<Snapshot>(sessionId, LOOK));

  const tools = {
    look: tool({
      description: "Read the current page: URL, visible text, and numbered interactive elements.",
      inputSchema: z.object({}),
      execute: async () => look(),
    }),
    click: tool({
      description: "Click an element by its number from the latest look. Returns the page afterwards.",
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) => {
        await run(sessionId, `await ${el(id)}.click({ timeout: 10000 }); ${settle}`);
        return look();
      },
    }),
    type: tool({
      description: "Type text into an input by its number. Never use this for passwords, card numbers, or codes.",
      inputSchema: z.object({ id: z.number().int(), text: z.string() }),
      execute: async ({ id, text }) => {
        await run(sessionId, `await ${el(id)}.fill(${JSON.stringify(text)}, { timeout: 10000 });`);
        return "Typed.";
      },
    }),
    fill_new_password: tool({
      description: "Fill a password field with a new strong password that StopLoss generates. You never see the password.",
      inputSchema: z.object({ ids: z.array(z.number().int()).min(1).describe("The password field, plus a confirm field if there is one") }),
      execute: async ({ ids }) => {
        const pw = randomBytes(12).toString("base64url") + "!9a";
        await run(sessionId, ids.map((id) => `await ${el(id)}.fill(${JSON.stringify(pw)}, { timeout: 10000 });`).join("\n"));
        return "Password filled.";
      },
    }),
    use_email_login: tool({
      description:
        "After you asked the site to email a sign-in code, magic link, or verification link to the StopLoss address, " +
        "wait for that email and use it. Pass the code field's number if the page asks for a code. You never see the code.",
      inputSchema: z.object({ code_field_id: z.number().int().optional() }),
      execute: async ({ code_field_id }) => {
        for (let i = 0; i < 18; i++) {
          const found = await hooks.emailLogin(startedAt);
          if (found.code && code_field_id != null) {
            await run(sessionId, `await ${el(code_field_id)}.fill(${JSON.stringify(found.code)}, { timeout: 10000 });`);
            return "Code entered from the StopLoss inbox.";
          }
          if (found.link) {
            await run(sessionId, `await page.goto(${JSON.stringify(found.link)}, { waitUntil: 'domcontentloaded', timeout: 45000 }); ${settle}`, 60);
            return "Opened the link from the StopLoss inbox.\n\n" + (await look());
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return "No sign-in email arrived within 90 seconds.";
      },
    }),
    press: tool({
      description: "Press a keyboard key, for example Enter or Escape.",
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        await run(sessionId, `await page.keyboard.press(${JSON.stringify(key)}); ${settle}`);
        return look();
      },
    }),
    scroll: tool({
      description: "Scroll the page down to reveal more content.",
      inputSchema: z.object({}),
      execute: async () => {
        await run(sessionId, `await page.mouse.wheel(0, 900); await page.waitForTimeout(600);`);
        return look();
      },
    }),
    goto: tool({
      description: "Open a URL on the service's own site.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        await run(sessionId, `await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 45000 }); ${settle}`, 60);
        return look();
      },
    }),
    report_step: tool({
      description: `Tell the user which step you are on. Keys: ${input.stepKeys.join(", ")}.`,
      inputSchema: z.object({ key: z.enum(input.stepKeys as [string, ...string[]]), detail: z.string().max(90) }),
      execute: async ({ key, detail }) => {
        await hooks.onStep(key, detail);
        return "Reported.";
      },
    }),
    finish: tool({
      description: "End the task with an outcome and a one-sentence explanation for the user.",
      inputSchema: z.object({
        outcome: z.enum(["done", "retention_offer", "needs_login", "needs_card", "failed"]),
        detail: z.string().max(300),
      }),
      execute: async ({ outcome, detail }) => {
        finished = { outcome, detail };
        return "Finished.";
      },
    }),
  };

  await generateText({
    model: model("agent"),
    instructions: input.instructions,
    prompt: input.resume
      ? `${input.task}\n\nThe browser is still open where the last attempt stopped. Start with look.`
      : `${input.task}\n\nThe browser is open at ${input.startUrl}. Start with look.`,
    tools,
    stopWhen: [isStepCount(input.maxSteps ?? 45), () => finished !== null],
  });

  return finished ?? { outcome: "failed", detail: "The agent stopped before it could confirm the result." };
}
