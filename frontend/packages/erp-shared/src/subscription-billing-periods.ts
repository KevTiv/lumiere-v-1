/**
 * Plan catalogue billing periods the `create_subscription_plan` / `update_subscription_plan`
 * reducers store (`day|week|month|year`). Single source for the create form, the plan edit
 * validator and the create-params builder so they cannot drift from the reducer
 * (`normalize_plan_billing_period`). "quarterly" is NOT accepted by the reducer.
 */
export const PLAN_BILLING_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type PlanBillingPeriod = (typeof PLAN_BILLING_PERIODS)[number];

/** Billing period as the reducer normalises it (it also accepts daily/weekly/monthly/yearly); null if unknown. */
export function normalizeBillingPeriod(raw: unknown): PlanBillingPeriod | null {
  switch (String(raw ?? '').trim().toLowerCase()) {
    case 'day':
    case 'daily':
    case 'd':
      return 'day';
    case 'week':
    case 'weekly':
    case 'w':
      return 'week';
    case 'month':
    case 'monthly':
    case 'm':
      return 'month';
    case 'year':
    case 'yearly':
    case 'annual':
    case 'annually':
    case 'y':
      return 'year';
    default:
      return null;
  }
}
