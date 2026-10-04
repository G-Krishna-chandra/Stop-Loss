import type { ApprovalRequest, Position } from "@/types";
import type { CancelTarget } from "./CancelDialog";
import { day, price, relativeDays } from "./format";

export function cancelTargetFor(position: Position, pending: ApprovalRequest | null | undefined): CancelTarget {
  const rel = relativeDays(position.renewal_date);
  return {
    positionId: position.id,
    approvalId: pending ? pending.id : null,
    kind: pending?.kind ?? "cancel",
    offer: pending?.kind === "retention_offer" ? pending.detail : null,
    serviceName: position.service_name,
    plan: position.plan_name,
    renewsLabel: rel === "tomorrow" ? "Renews tomorrow" : rel === "today" ? "Renews today" : "Renews on",
    renewsDate: day(position.renewal_date),
    priceLabel: price(position.renewal_price_cents, position.currency, position.billing_period),
  };
}
