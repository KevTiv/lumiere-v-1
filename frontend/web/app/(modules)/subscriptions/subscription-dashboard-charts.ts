/**
 * Pure data behind the Subscriptions dashboard charts: MRR with new business and churn rate per
 * month, and the plan mix of active MRR. Built from the subscription rows the module loads.
 *
 * History is reconstructed from each subscription's start and close dates with its current MRR,
 * so a past month reflects who was subscribed then, priced at today's contract value.
 */
import { variantTag } from "@lumiere/erp-workflows"
import type { Subscription, SubscriptionPlan } from "@lumiere/stdb/types"
import { chartColor, monthBuckets, type ChartDatum, type ChartSeriesSpec } from "@lumiere/ui/lib/chart-format"
import type { ShareBarRow } from "@lumiere/ui"
import { timestampMs } from "../accounting/accounting-dashboard-charts"

/** Contract-currency MRR; converted local values cannot be labelled with the contract currency. */
export function subscriptionMrr(row: Subscription): number {
  for (const value of [row.recurringMrr, row.recurringMonthly]) {
    const n = Number(value ?? 0)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function isTrial(row: Subscription): boolean {
  return row.isTrial === true
}

function closeMs(row: Subscription): number | null {
  if (row.closeDate != null) return timestampMs(row.closeDate)
  const state = variantTag(row.state).toLowerCase()
  // Closed without a recorded date: treat as closed at its last update.
  return state === "closed" ? timestampMs(row.updatedAt) : null
}

/** Was the (paying) subscription running at `ms`? */
function activeAt(row: Subscription, ms: number): boolean {
  if (isTrial(row) || !["active", "closed"].includes(variantTag(row.state).toLowerCase())) return false
  const start = timestampMs(row.dateStart) ?? timestampMs(row.createdAt)
  if (start == null || start > ms) return false
  const closed = closeMs(row)
  return closed == null || closed > ms
}

/** MRR at each month end, the MRR that started in the month, and churn as a share of opening MRR. */
export function mrrAndChurnByMonth(subscriptions: readonly Subscription[], now: Date, months = 12, locale?: string): ChartDatum[] {
  return monthBuckets(months, now, locale).map((bucket) => {
    const monthEnd = Math.min(bucket.endMs, now.getTime())
    let mrr = 0
    let opening = 0
    let added = 0
    let churned = 0
    for (const row of subscriptions) {
      const value = subscriptionMrr(row)
      if (value <= 0 || !["active", "closed"].includes(variantTag(row.state).toLowerCase())) continue
      if (activeAt(row, monthEnd)) mrr += value
      if (activeAt(row, bucket.startMs - 1)) opening += value
      const start = timestampMs(row.dateStart) ?? timestampMs(row.createdAt)
      if (!isTrial(row) && start != null && start >= bucket.startMs && start <= monthEnd) added += value
      const closed = closeMs(row)
      if (!isTrial(row) && closed != null && closed >= bucket.startMs && closed <= monthEnd) churned += value
    }
    const churnRate = opening > 0 ? Math.round((churned / opening) * 1000) / 10 : 0
    return { month: bucket.label, mrr: Math.round(mrr), newMrr: Math.round(added), churnRate }
  })
}

/** Active MRR by plan: the largest `maxPlans` plans, the rest folded into "Other plans". */
export function planMix(
  subscriptions: readonly Subscription[],
  plans: readonly SubscriptionPlan[],
  now: Date,
  maxPlans = 5,
): { segments: ChartSeriesSpec[]; rows: ShareBarRow[] } {
  const planNames = new Map(plans.map((plan) => [String(plan.id), plan.name?.trim() || `Plan #${String(plan.id)}`]))
  const byPlan = new Map<string, number>()
  for (const row of subscriptions) {
    if (!activeAt(row, now.getTime())) continue
    const value = subscriptionMrr(row)
    if (value <= 0) continue
    const key = String(row.planId)
    byPlan.set(key, (byPlan.get(key) ?? 0) + value)
  }
  const ranked = [...byPlan.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, maxPlans)
  const otherTotal = ranked.slice(maxPlans).reduce((sum, [, value]) => sum + value, 0)
  const segments: ChartSeriesSpec[] = top.map(([key], index) => ({
    key: `plan-${key}`,
    label: planNames.get(key) ?? `Plan #${key}`,
    color: chartColor(index),
  }))
  const values: { [segmentKey: string]: number } = {}
  for (const [key, value] of top) values[`plan-${key}`] = Math.round(value)
  if (otherTotal > 0) {
    segments.push({ key: "other", label: "Other plans", color: "hsl(var(--muted-foreground))" })
    values.other = Math.round(otherTotal)
  }
  return { segments, rows: segments.length > 0 ? [{ label: "MRR", values }] : [] }
}
