// Code that runs inside the Kernel browser VM via playwright.execute. `page` is in scope there.
// Kept as strings on purpose: nothing here runs in our process.

/** Shared helpers prepended to every snippet. `args` is injected as JSON. */
export const HELPERS = String.raw`
const CLICKABLE = 'button, a, [role=button], [role=menuitem], input[type=submit]';
const re = (s) => new RegExp(s, 'i');

async function visibleText() {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 6000);
}

async function observe() {
  const text = await visibleText();
  const emailInput = await firstVisible('input[type=email], input[name*=email i], input[autocomplete=email], input[autocomplete=username]');
  const codeInput = await firstVisible('input[autocomplete=one-time-code], input[inputmode=numeric], input[name*=code i], input[name*=otp i]');
  return { url: page.url(), title: await page.title().catch(() => ''), text, hasEmailInput: !!emailInput, hasCodeInput: !!codeInput };
}

async function firstVisible(selector) {
  const loc = page.locator(selector);
  const n = Math.min(await loc.count(), 20);
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
  return null;
}

// Finds the first visible clickable whose own text matches a pattern, in pattern priority order.
// A bare "Cancel" is skipped: on most sites it dismisses a dialog instead of cancelling a plan.
async function findClickable(patterns) {
  const loc = page.locator(CLICKABLE);
  const n = Math.min(await loc.count(), 300);
  const items = [];
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const t = ((await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60 || /^cancel$/i.test(t)) continue;
    const href = (await el.getAttribute('href').catch(() => null)) || '';
    if (href.startsWith('#') || /skip to (main )?content/i.test(t)) continue;
    items.push({ el, t });
  }
  for (const p of patterns) {
    const hit = items.find((it) => re(p).test(it.t));
    if (hit) return hit;
  }
  return null;
}

async function settle() {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);
}

// Overlays such as cookie banners can swallow a normal click: fall back to a forced click, then a DOM click.
async function robustClick(el) {
  try { await el.click({ timeout: 5000 }); return true; } catch (e) {}
  try { await el.click({ timeout: 3000, force: true }); return true; } catch (e) {}
  try { await el.evaluate((n) => n.click()); return true; } catch (e) {}
  return false;
}

async function click(hit) {
  if (!(await robustClick(hit.el))) return null;
  await settle();
  return hit.t;
}
`;

export const OBSERVE = `return await observe();`;

export const GOTO = `
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await settle();
return await observe();
`;

/** Types the signup email and asks for a code or link. */
export const START_LOGIN = `
const input = await firstVisible('input[type=email], input[name*=email i], input[autocomplete=email], input[autocomplete=username]');
if (!input) return { ok: false, reason: 'no email field' };
await input.fill(args.email);
const hit = await findClickable(['^continue( with email)?$', 'send (me )?(a )?(login |magic |sign.?in )?(code|link)', 'email me', '^(sign|log) ?in$', '^next$', '^continue']);
if (hit) await click(hit); else { await input.press('Enter'); await settle(); }
return { ok: true, ...(await observe()) };
`;

/** Enters a one-time code. Handles one field or one field per digit. */
export const ENTER_CODE = `
const single = await firstVisible('input[autocomplete=one-time-code], input[name*=code i], input[name*=otp i]');
if (single && (await single.getAttribute('maxlength')) !== '1') {
  await single.fill(args.code);
} else {
  const first = await firstVisible('input[inputmode=numeric], input[maxlength="1"]');
  if (!first) return { ok: false, reason: 'no code field' };
  await first.click();
  await page.keyboard.type(args.code, { delay: 80 });
}
await page.waitForTimeout(800);
const hit = await findClickable(['^verify', '^continue', '^(sign|log) ?in', '^submit', '^confirm']);
if (hit) await click(hit); else await settle();
return { ok: true, ...(await observe()) };
`;

/** Clicks one element by priority list, after checking the page is not a retention offer. */
export const CLICK_ONE = `
const before = await observe();
const hit = await findClickable(args.patterns);
if (!hit) return { clicked: null, before, after: before };
const clicked = await click(hit);
return { clicked, before, after: await observe() };
`;

/** Clicks the final confirm, then checks the clicked control is gone (the page actually moved on). */
export const CONFIRM = `
const hit = await findClickable(args.patterns);
if (!hit) return { clicked: null, stillThere: false, after: await observe() };
const label = hit.t;
await click(hit);
await page.waitForTimeout(2500);
const again = await findClickable(['^' + label.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&') + '$']);
return { clicked: label, stillThere: !!again, after: await observe() };
`;

/** Tags every visible clickable with data-sl-idx and lists them for the model to choose from. */
export const LIST_CANDIDATES = `
const loc = page.locator(CLICKABLE);
const n = Math.min(await loc.count(), 300);
const out = [];
for (let i = 0; i < n && out.length < 80; i++) {
  const el = loc.nth(i);
  if (!(await el.isVisible().catch(() => false))) continue;
  const t = ((await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').replace(/\\s+/g, ' ').trim();
  if (!t || t.length > 80) continue;
  const href0 = (await el.getAttribute('href').catch(() => null)) || '';
  if (href0.startsWith('#') || /skip to (main )?content/i.test(t)) continue;
  await el.evaluate((node, idx) => node.setAttribute('data-sl-idx', String(idx)), out.length).catch(() => {});
  out.push({ index: out.length, text: t, href: (await el.getAttribute('href').catch(() => null)) || null });
}
return { page: await observe(), candidates: out };
`;

/** Clicks the element tagged by LIST_CANDIDATES. */
export const CLICK_TAGGED = `
const el = page.locator('[data-sl-idx="' + Number(args.index) + '"]').first();
if (!(await el.count())) return { clicked: null, after: await observe() };
const t = (await el.innerText().catch(() => '')).replace(/\\s+/g, ' ').trim();
if (!(await robustClick(el))) return { clicked: null, after: await observe() };
await settle();
return { clicked: t || '(unlabelled)', after: await observe() };
`;
