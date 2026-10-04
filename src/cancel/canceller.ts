import type { CancelResult, Position } from "../types.js";
import type { KernelApi } from "./kernel.js";
import { PageResult, pickRecipe, type CancelRecipe } from "./recipes.js";

// Runs ONE cancellation attempt per call. It never retries.
//
// Rules from the stop-loss skill (section 8) enforced here:
//  - Only a position in `cancelling` is accepted. That status is reachable only through a human
//    approval (src/approval) followed by src/agent claiming it, so there is no auto-cancel path.
//  - A retention offer stops the flow and is reported, never accepted or declined.
//  - After an uncertain result the answer is `failed` with a note not to retry automatically.
//    The human looks at the live view or replay and decides.
//  - No passwords or card numbers pass through here. Login state lives in a Kernel profile that a
//    human prepared; a login form means `needs_login`.

export interface CancelLog {
  level: "info" | "warn" | "error";
  msg: string;
  [field: string]: unknown;
}

export interface CancelHooks {
  /** Called as soon as the browser exists, so a UI can show the live view during the run. */
  onLiveView?(position_id: string, url: string): void | Promise<void>;
  log?(entry: CancelLog): void;
}

export interface CancellerOptions {
  kernel: KernelApi;
  recipes?: readonly CancelRecipe[];
  /** Kernel profile holding the logged-in accounts. Loaded read-only, so sessions can run in parallel. */
  profileName?: string;
  /** Maximum simultaneous browser sessions. Check your Kernel plan limit. */
  maxParallel?: number;
  executeTimeoutSec?: number;
  sessionTimeoutSec?: number;
  stealth?: boolean;
  hooks?: CancelHooks;
}

export interface Canceller {
  cancel(position: Position): Promise<CancelResult>;
  /** Runs several cancellations in parallel (bounded). Results keep the input order. Never throws. */
  cancelMany(positions: readonly Position[]): Promise<CancelResult[]>;
}

const MAX_DETAIL_CHARS = 300;
const RETRY_WARNING = " Do not retry automatically; check the live view or replay first.";

export function cleanDetail(raw: string): string {
  const cleaned = raw
    .replace(new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > MAX_DETAIL_CHARS ? `${cleaned.slice(0, MAX_DETAIL_CHARS - 1)}…` : cleaned;
}

function failed(detail: string, live_view_url: string | null = null, replay_url: string | null = null): CancelResult {
  return { outcome: "failed", detail: cleanDetail(detail), live_view_url, replay_url };
}

export function createCanceller(options: CancellerOptions): Canceller {
  const { kernel } = options;
  const log = options.hooks?.log ?? (() => {});
  const executeTimeoutSec = options.executeTimeoutSec ?? 120;
  const sessionTimeoutSec = options.sessionTimeoutSec ?? 300;
  const maxParallel = Math.max(1, options.maxParallel ?? 3);

  async function cancel(position: Position): Promise<CancelResult> {
    if (position.status !== "cancelling") {
      return failed(`refused: position is ${position.status}; a cancel needs an approved, claimed (cancelling) position`);
    }
    const url = position.cancel_url;
    if (!url || !url.startsWith("https://")) {
      return failed("refused: the position has no https cancel_url");
    }

    const recipe = pickRecipe(position.service_domain, options.recipes);
    let session;
    try {
      session = await kernel.createBrowser({
        timeout_seconds: sessionTimeoutSec,
        ...(options.profileName ? { profile_name: options.profileName } : {}),
        ...(options.stealth !== undefined ? { stealth: options.stealth } : {}),
      });
    } catch (error) {
      log({ level: "error", msg: "cancel.session_failed", position_id: position.id });
      return failed(`no browser started, nothing was attempted: ${errorText(error)}`);
    }

    const { session_id, live_view_url } = session;
    let replay_id: string | null = null;
    let replay_url: string | null = null;
    let result: CancelResult;
    try {
      if (live_view_url) {
        try {
          await options.hooks?.onLiveView?.(position.id, live_view_url);
        } catch {
          // a broken UI hook must not stop or fail the cancel
        }
      }
      try {
        replay_id = (await kernel.startReplay(session_id)).replay_id;
      } catch {
        log({ level: "warn", msg: "cancel.replay_start_failed", position_id: position.id });
      }

      result = await run(position, recipe, url, session_id, live_view_url);
    } finally {
      if (replay_id) {
        try {
          await kernel.stopReplay(session_id, replay_id);
          replay_url = await kernel.replayViewUrl(session_id, replay_id);
        } catch {
          log({ level: "warn", msg: "cancel.replay_finish_failed", position_id: position.id });
        }
      }
      try {
        await kernel.deleteBrowser(session_id);
      } catch {
        log({ level: "warn", msg: "cancel.delete_failed", position_id: position.id });
      }
    }
    return { ...result, replay_url };
  }

  async function run(
    position: Position,
    recipe: CancelRecipe,
    url: string,
    session_id: string,
    live_view_url: string | null,
  ): Promise<CancelResult> {
    let execution;
    try {
      execution = await kernel.execute(
        session_id,
        recipe.buildCode({ cancel_url: url, service_name: position.service_name }),
        executeTimeoutSec,
      );
    } catch (error) {
      return failed(`uncertain: the flow may have partly run (${errorText(error)}).${RETRY_WARNING}`, live_view_url);
    }
    if (!execution.success) {
      return failed(
        `uncertain: the flow did not finish (${execution.error ?? execution.stderr ?? "unknown error"}).${RETRY_WARNING}`,
        live_view_url,
      );
    }
    const parsed = PageResult.safeParse(execution.result);
    if (!parsed.success) {
      return failed(`uncertain: the flow returned an unreadable result.${RETRY_WARNING}`, live_view_url);
    }
    const { outcome, detail } = parsed.data;
    log({ level: "info", msg: "cancel.finished", position_id: position.id, recipe: recipe.id, outcome });
    return {
      outcome,
      detail: cleanDetail(outcome === "failed" ? `${detail}.${RETRY_WARNING}` : detail),
      live_view_url,
      replay_url: null,
    };
  }

  async function cancelMany(positions: readonly Position[]): Promise<CancelResult[]> {
    const results = new Array<CancelResult>(positions.length);
    let next = 0;
    const worker = async () => {
      while (next < positions.length) {
        const index = next++;
        const position = positions[index]!;
        try {
          results[index] = await cancel(position);
        } catch (error) {
          results[index] = failed(`unexpected error: ${errorText(error)}.${RETRY_WARNING}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxParallel, positions.length) }, worker));
    return results;
  }

  return { cancel, cancelMany };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
