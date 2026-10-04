import Kernel from "@onkernel/sdk";

let client: Kernel | null = null;

export function kernel(): Kernel {
  if (!client) {
    if (!process.env.KERNEL_API_KEY) throw new Error("KERNEL_API_KEY is not set");
    client = new Kernel({
      apiKey: process.env.KERNEL_API_KEY,
      ...(process.env.KERNEL_PROJECT_ID ? { projectID: process.env.KERNEL_PROJECT_ID } : {}),
    });
  }
  return client;
}

// One saved browser profile per service, so a sign-up's logged-in session is there when it's time to cancel.
export function profileName(domain: string): string {
  return `stoploss-${domain.replace(/[^a-z0-9.-]/gi, "-")}`;
}

async function profileExists(name: string): Promise<boolean> {
  try {
    await kernel().profiles.retrieve(name);
    return true;
  } catch {
    return false;
  }
}

export type Browser = { sessionId: string; liveViewUrl: string | null; replayId: string | null };

// Opens a headful stealth browser. saveProfile creates the service's profile if needed and saves the session into it.
export async function openBrowser(domain: string, opts: { saveProfile: boolean }): Promise<Browser> {
  const name = profileName(domain);
  let useProfile = await profileExists(name);
  if (!useProfile && opts.saveProfile) {
    await kernel().profiles.create({ name }).catch(() => undefined);
    useProfile = true;
  }
  const b = await kernel().browsers.create({
    stealth: true,
    headless: false,
    timeout_seconds: 900,
    ...(useProfile ? { profile: { name, save_changes: opts.saveProfile } } : {}),
  });
  let replayId: string | null = null;
  try {
    replayId = (await kernel().browsers.replays.start(b.session_id)).replay_id;
  } catch {
    replayId = null;
  }
  return { sessionId: b.session_id, liveViewUrl: b.browser_live_view_url ?? null, replayId };
}

// Stops the recording and returns its URL. Closing deletes the browser, which also saves a writable profile.
export async function closeBrowser(b: { sessionId: string; replayId: string | null }, keepOpen = false): Promise<string | null> {
  let replayUrl: string | null = null;
  if (b.replayId) {
    try {
      await kernel().browsers.replays.stop(b.replayId, { id_or_name: b.sessionId });
      const list = await kernel().browsers.replays.list(b.sessionId);
      replayUrl = list.find((r) => r.replay_id === b.replayId)?.replay_view_url ?? null;
    } catch {
      replayUrl = null;
    }
  }
  if (!keepOpen) await kernel().browsers.deleteByID(b.sessionId).catch(() => undefined);
  return replayUrl;
}

// Runs Playwright code inside the browser's VM. `page` is in scope; the snippet's return value comes back as result.
export async function run<T = unknown>(sessionId: string, code: string, timeoutSec = 45): Promise<T> {
  const res = await kernel().browsers.playwright.execute(sessionId, { code, timeout_sec: timeoutSec });
  if (!res.success) throw new Error(res.error ?? "Playwright execution failed");
  return res.result as T;
}
