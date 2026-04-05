import type SubscriptionRow from "../generated/subscription_table";
import type SubscriptionPlanRow from "../generated/subscription_plan_table";
import type SubscriptionLineRow from "../generated/subscription_line_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";
import { resolveHttpSqlColumns, sqlColumnListForGeneratedType } from "../field-policy";

// ── Row types ─────────────────────────────────────────────────────────────────
export type Subscription = Infer<typeof SubscriptionRow>;
export type SubscriptionPlan = Infer<typeof SubscriptionPlanRow>;
export type SubscriptionLine = Infer<typeof SubscriptionLineRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function subscriptionsSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  const sCols = resolveHttpSqlColumns("subscriptions", undefined).join(", ");
  const pCols = resolveHttpSqlColumns("subscription-plans", undefined).join(", ");
  const lineCols = sqlColumnListForGeneratedType("SubscriptionLine").join(", ");
  return [
    `SELECT ${sCols} FROM subscription WHERE organization_id = ${id}`,
    `SELECT ${pCols} FROM subscription_plan WHERE organization_id = ${id}`,
    `SELECT ${lineCols} FROM subscription_line WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function querySubscriptions(): Subscription[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.subscription.iter()].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );
}

export function querySubscriptionPlans(): SubscriptionPlan[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.subscription_plan.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function querySubscriptionLines(): SubscriptionLine[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.subscription_line.iter()].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );
}
