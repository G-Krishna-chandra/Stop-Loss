import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENERIC_RECIPE, PageResult } from "./recipes.js";

// Runs the generic cancel recipe in a REAL Chromium against fixture pages served through route
// interception (no network). It executes the exact code string Kernel would run, with `page` in
// scope. Skipped when no Chromium is installed (set PLAYWRIGHT_CHROMIUM_PATH to point at one).

const CHROMIUM =
  process.env["PLAYWRIGHT_CHROMIUM_PATH"] ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL = "https://www.notion.so/settings/billing";

type Site = Record<string, string>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (page: unknown) => Promise<unknown>;

describe.skipIf(!existsSync(CHROMIUM))("generic recipe in a real browser", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function runOn(site: Site) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const visited: string[] = [];
    await page.route("**/*", (route) => {
      const path = new globalThis.URL(route.request().url()).pathname;
      visited.push(path);
      const body = site[path];
      return body === undefined
        ? route.fulfill({ status: 404, body: "not found" })
        : route.fulfill({ status: 200, contentType: "text/html", body });
    });
    const code = GENERIC_RECIPE.buildCode({ cancel_url: URL, service_name: "Notion" });
    const run = new AsyncFunction("page", code);
    const raw = await run(page);
    await context.close();
    return { result: PageResult.parse(raw), visited };
  }

  const go = (to: string, label: string) => `<button onclick="location.href='${to}'">${label}</button>`;

  it("cancels through a two-step flow", async () => {
    const { result, visited } = await runOn({
      "/settings/billing": `<h1>Billing</h1><p>Plus plan</p>${go("/confirm", "Cancel subscription")}`,
      "/confirm": `<h1>Are you sure?</h1>${go("/billing-back", "Keep my plan")}${go("/done", "Yes, cancel")}`,
      "/done": `<h1>Done</h1><p>Your subscription has been cancelled.</p>`,
    });
    expect(result.outcome).toBe("cancelled");
    expect(visited).toContain("/done");
  });

  it("works with links as well as buttons", async () => {
    const { result } = await runOn({
      "/settings/billing": `<a href="/done">Cancel plan</a>`,
      "/done": `<p>Cancellation confirmed.</p>`,
    });
    expect(result.outcome).toBe("cancelled");
  });

  it("STOPS at a retention offer and does not click through it", async () => {
    const { result, visited } = await runOn({
      "/settings/billing": go("/offer", "Cancel subscription"),
      "/offer": `<h1>Wait!</h1><p>Stay and get 50% off for 3 months.</p>${go("/accepted", "Accept offer")}${go("/done", "Cancel subscription anyway")}`,
      "/accepted": `<p>Offer applied</p>`,
      "/done": `<p>Your subscription has been cancelled.</p>`,
    });
    expect(result.outcome).toBe("retention_offer");
    expect(result.detail).toMatch(/50% off/);
    expect(visited).not.toContain("/done");
    expect(visited).not.toContain("/accepted");
  });

  it("reports needs_login and never touches the form", async () => {
    const { result, visited } = await runOn({
      "/settings/billing": `<form action="/login"><input type="email" name="e"><input type="password" name="p"><button>Sign in</button></form>`,
      "/login": `<p>logged in</p>`,
    });
    expect(result.outcome).toBe("needs_login");
    expect(visited).not.toContain("/login");
  });

  it("does not mistake 'you will not be charged if you cancel' for a cancellation", async () => {
    const { result } = await runOn({
      "/settings/billing": `<p>If you cancel your subscription you will not be charged again. Your plan has been active since 2026.</p>`,
    });
    expect(result.outcome).toBe("failed");
  });

  it("is not stopped by an upsell on the first page", async () => {
    const { result } = await runOn({
      "/settings/billing": `<p>Save 20% off with the annual plan!</p>${go("/done", "Cancel subscription")}`,
      "/done": `<p>Your subscription has been cancelled.</p>`,
    });
    expect(result.outcome).toBe("cancelled");
  });

  it("never clicks controls that also say delete, close account, keep, go back or stay", async () => {
    // Every label here MATCHES the cancel pattern, so only the exclusion filter keeps them unclicked.
    const { result, visited } = await runOn({
      "/settings/billing": [
        go("/del", "Delete account and cancel subscription"),
        go("/close", "Close my account and end my subscription"),
        go("/keep", "Keep subscription, do not cancel my subscription"),
        go("/dont", "Don't cancel my plan"),
        go("/stay", "Stay, never cancel my membership"),
      ].join(""),
      "/del": `<p>Your subscription has been cancelled.</p>`,
      "/close": `<p>Your subscription has been cancelled.</p>`,
      "/keep": `<p>Your subscription has been cancelled.</p>`,
      "/dont": `<p>Your subscription has been cancelled.</p>`,
      "/stay": `<p>Your subscription has been cancelled.</p>`,
    });
    expect(result.outcome).toBe("failed");
    expect(visited).toEqual(["/settings/billing"]);
  });

  it("gives up after a few clicks instead of wandering", async () => {
    const loop = (n: number) => `<p>step ${n}</p>${go(`/s${n + 1}`, "Cancel subscription")}`;
    const site: Site = { "/settings/billing": loop(0) };
    for (let i = 1; i <= 8; i++) site[`/s${i}`] = loop(i);
    const { result, visited } = await runOn(site);
    expect(result.outcome).toBe("failed");
    expect(visited.length).toBeLessThanOrEqual(6); // the start page plus at most 4 clicks
  });

  it("fails clearly when the page has no cancel control", async () => {
    const { result } = await runOn({ "/settings/billing": `<h1>Billing</h1><p>Nothing to see</p>` });
    expect(result).toMatchObject({ outcome: "failed", detail: expect.stringMatching(/no cancel control/) });
  });
});
