import type { EventType, PositionEvent } from "@/types";
import { iso, sql } from "./client";

type Row = Record<string, unknown>;

function toEvent(r: Row): PositionEvent {
  return {
    id: String(r.id),
    position_id: (r.position_id as string | null) ?? null,
    type: r.type as EventType,
    title: String(r.title),
    detail: (r.detail as string | null) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    created_at: iso(r.created_at) ?? "",
  };
}

export async function addEvent(
  positionId: string | null,
  type: EventType,
  title: string,
  detail: string | null = null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await sql()`
    insert into events (position_id, type, title, detail, payload)
    values (${positionId}, ${type}, ${title}, ${detail}, ${JSON.stringify(payload)}::jsonb)`;
}

export async function listEvents(positionId: string): Promise<PositionEvent[]> {
  const rows = await sql()`select * from events where position_id = ${positionId} order by created_at asc`;
  return rows.map(toEvent);
}

export type LedgerEvent = PositionEvent & { service_name: string | null; service_domain: string | null };

export async function listLedger(limit = 200): Promise<LedgerEvent[]> {
  const rows = await sql()`
    select e.*, p.service_name, p.service_domain
    from events e left join positions p on p.id = e.position_id
    order by e.created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    ...toEvent(r),
    service_name: (r.service_name as string | null) ?? null,
    service_domain: (r.service_domain as string | null) ?? null,
  }));
}
