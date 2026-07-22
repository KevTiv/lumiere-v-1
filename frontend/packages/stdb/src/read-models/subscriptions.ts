/** Loose row shape from `/api/query/subscriptions` (and similar subscription lists). */
export type SubscriptionQueryRow = Record<string, unknown>;

/** Primary label for subscription rows (name, plan, partner). */
export function subscriptionPrimaryLabel(row: SubscriptionQueryRow): string {
  return primaryLabel([row.name, row.planName, row.partnerName, row.reference], row.id);
}
import { primaryLabel } from "./primary-label";
