import type { EmailAction, EmailCategory, InboxEmail } from "@/types";
import { iso, sql } from "./client";

type Row = Record<string, unknown>;

function toEmail(r: Row): InboxEmail {
  return {
    message_id: String(r.message_id),
    thread_id: (r.thread_id as string | null) ?? null,
    inbox_id: String(r.inbox_id),
    from_address: String(r.from_address),
    from_name: (r.from_name as string | null) ?? null,
    subject: String(r.subject ?? ""),
    preview: String(r.preview ?? ""),
    received_at: iso(r.received_at) ?? "",
    category: r.category as EmailCategory,
    action: r.action as EmailAction,
    position_id: (r.position_id as string | null) ?? null,
    extracted: (r.extracted as InboxEmail["extracted"]) ?? {},
  };
}

// Returns false when this message was already recorded, so webhook retries do nothing twice.
export async function recordEmail(e: InboxEmail): Promise<boolean> {
  const rows = await sql()`
    insert into emails (message_id, thread_id, inbox_id, from_address, from_name, subject, preview, received_at,
                        category, action, position_id, extracted)
    values (${e.message_id}, ${e.thread_id}, ${e.inbox_id}, ${e.from_address}, ${e.from_name}, ${e.subject}, ${e.preview},
            ${e.received_at}, ${e.category}, ${e.action}, ${e.position_id}, ${JSON.stringify(e.extracted)}::jsonb)
    on conflict (message_id) do nothing
    returning message_id`;
  return rows.length > 0;
}

export async function updateEmailOutcome(
  messageId: string,
  patch: { action: EmailAction; position_id: string | null; extracted?: InboxEmail["extracted"] },
): Promise<void> {
  await sql()`
    update emails set
      action = ${patch.action},
      position_id = ${patch.position_id},
      extracted = coalesce(${patch.extracted ? JSON.stringify(patch.extracted) : null}::jsonb, extracted)
    where message_id = ${messageId}`;
}

export async function listEmails(limit = 100): Promise<InboxEmail[]> {
  const rows = await sql()`select * from emails order by received_at desc limit ${limit}`;
  return rows.map(toEmail);
}

export async function getEmail(messageId: string): Promise<InboxEmail | null> {
  const rows = await sql()`select * from emails where message_id = ${messageId}`;
  return rows[0] ? toEmail(rows[0]) : null;
}

export async function emailsForPosition(positionId: string): Promise<InboxEmail[]> {
  const rows = await sql()`select * from emails where position_id = ${positionId} order by received_at asc`;
  return rows.map(toEmail);
}
