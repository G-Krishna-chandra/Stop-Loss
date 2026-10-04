import type { EmitEvent, InboxEvent } from "./types.js";

// In-memory emitter for development and tests. The real one lives in src/db, which is the only
// module allowed to touch SQL, and enforces dedupe_key with a UNIQUE constraint.
// The contract is the same: return { duplicate: true } instead of throwing on a repeat.

export function createMemoryEmitter(): { emit: EmitEvent; events: InboxEvent[] } {
  const seen = new Set<string>();
  const events: InboxEvent[] = [];
  const emit: EmitEvent = async (event) => {
    if (seen.has(event.dedupe_key)) return { duplicate: true };
    seen.add(event.dedupe_key);
    events.push(event);
    return { duplicate: false };
  };
  return { emit, events };
}
