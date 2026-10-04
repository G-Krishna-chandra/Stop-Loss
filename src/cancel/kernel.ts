import Kernel from "@onkernel/sdk";

// The only file that imports the Kernel SDK. Exact calls (Kernel docs + SDK types):
//   kernel.browsers.create({ profile: { name }, timeout_seconds })   -> { session_id, browser_live_view_url }
//   kernel.browsers.replays.start(id) / .stop(replay_id, { id_or_name }) / .list(id)  -> replay_view_url
//   kernel.browsers.playwright.execute(id, { code, timeout_sec })    -> { success, result, error, stderr }
//   kernel.browsers.deleteByID(id)
// Profiles: parallel sessions load the SAME profile read-only (save_changes is never set), which
// Kernel documents as safe for any number of browsers. Logging in happens once, separately.

export interface KernelSession {
  session_id: string;
  live_view_url: string | null;
}

export interface ExecuteResult {
  success: boolean;
  result?: unknown;
  error?: string;
  stderr?: string;
}

/** The slice of Kernel this module uses. Tests supply a fake. */
export interface KernelApi {
  createBrowser(options: { profile_name?: string; timeout_seconds: number; stealth?: boolean }): Promise<KernelSession>;
  startReplay(session_id: string): Promise<{ replay_id: string }>;
  execute(session_id: string, code: string, timeout_sec: number): Promise<ExecuteResult>;
  stopReplay(session_id: string, replay_id: string): Promise<void>;
  replayViewUrl(session_id: string, replay_id: string): Promise<string | null>;
  deleteBrowser(session_id: string): Promise<void>;
}

export function createKernelApi(apiKey?: string): KernelApi {
  const kernel = new Kernel(apiKey ? { apiKey } : {});
  return {
    async createBrowser({ profile_name, timeout_seconds, stealth }) {
      const browser = await kernel.browsers.create({
        timeout_seconds,
        ...(stealth !== undefined ? { stealth } : {}),
        ...(profile_name ? { profile: { name: profile_name } } : {}),
      });
      return { session_id: browser.session_id, live_view_url: browser.browser_live_view_url ?? null };
    },
    async startReplay(session_id) {
      const replay = await kernel.browsers.replays.start(session_id);
      return { replay_id: replay.replay_id };
    },
    async execute(session_id, code, timeout_sec) {
      const response = await kernel.browsers.playwright.execute(session_id, { code, timeout_sec });
      return {
        success: response.success,
        ...(response.result !== undefined ? { result: response.result } : {}),
        ...(response.error !== undefined ? { error: response.error } : {}),
        ...(response.stderr !== undefined ? { stderr: response.stderr } : {}),
      };
    },
    async stopReplay(session_id, replay_id) {
      await kernel.browsers.replays.stop(replay_id, { id_or_name: session_id });
    },
    async replayViewUrl(session_id, replay_id) {
      const replays = await kernel.browsers.replays.list(session_id);
      return replays.find((r) => r.replay_id === replay_id)?.replay_view_url ?? null;
    },
    async deleteBrowser(session_id) {
      await kernel.browsers.deleteByID(session_id);
    },
  };
}
