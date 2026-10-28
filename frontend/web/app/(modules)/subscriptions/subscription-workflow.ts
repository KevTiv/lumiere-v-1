import { kpiDate } from '@lumiere/ui/lib/kpi-tiles';
import { subscriptionStateOf } from './subscription-status';
import type { SubscriptionActionId } from './subscription-actions';

/** Only the projected subscription fields used by the workflow. Missing values stay unknown. */
export interface WorkflowRow {
  id?: unknown; organizationId?: unknown; organization_id?: unknown; companyId?: unknown; company_id?: unknown;
  code?: unknown; name?: unknown; state?: unknown; active?: unknown; reference?: unknown;
  partnerId?: unknown; partner_id?: unknown; partnerName?: unknown; currencyId?: unknown; currency_id?: unknown;
  subscriptionId?: unknown; subscription_id?: unknown; invoiceMoveId?: unknown; invoice_move_id?: unknown;
  moveType?: unknown; move_type?: unknown; amountTotal?: unknown; amount_total?: unknown;
  amountResidual?: unknown; amount_residual?: unknown; recurringNextDate?: unknown; recurring_next_date?: unknown;
  recurringTotal?: unknown; recurring_total?: unknown; planId?: unknown; plan_id?: unknown;
  billingPeriod?: unknown; billingPeriodUnit?: unknown; recurringInvoiceDay?: unknown; paymentMode?: unknown;
  trialPeriod?: unknown; journalId?: unknown; priceUnit?: unknown; price_unit?: unknown;
}
export interface SubscriptionScope { organizationId: bigint; companyId: bigint }

export function inSubscriptionScope(row: WorkflowRow, scope: SubscriptionScope): boolean {
  return scope.companyId > 0n && scope.organizationId > 0n
    && String(row.organizationId ?? row.organization_id) === String(scope.organizationId)
    && String(row.companyId ?? row.company_id) === String(scope.companyId);
}

export function workflowTag(value: unknown): string {
  return subscriptionStateOf({ state: value });
}

export function eligibleSubscriptionOrders<Row extends WorkflowRow>(rows: readonly Row[], scope: SubscriptionScope): Row[] {
  return rows.filter((row) => inSubscriptionScope(row, scope) && ['sale', 'done'].includes(workflowTag(row.state)));
}

export function eligibleSubscriptionPlans<Row extends WorkflowRow>(rows: readonly Row[], scope: SubscriptionScope): Row[] {
  return rows.filter((row) => inSubscriptionScope(row, scope) && row.active === true);
}

/** Billing-run links, rather than unprojected invoiceIds, establish invoice ownership. */
export function subscriptionInvoices<Row extends WorkflowRow>(subscription: WorkflowRow, runs: readonly WorkflowRow[], moves: readonly Row[], scope: SubscriptionScope): Row[] {
  if (!inSubscriptionScope(subscription, scope)) return [];
  const ids = new Set(runs.filter((run) => inSubscriptionScope(run, scope)
    && String(run.subscriptionId ?? run.subscription_id) === String(subscription.id))
    .map((run) => String(run.invoiceMoveId ?? run.invoice_move_id)));
  return moves.filter((move) => inSubscriptionScope(move, scope) && ids.has(String(move.id))
    && workflowTag(move.moveType ?? move.move_type) === 'outinvoice'
    && ['draft', 'posted'].includes(workflowTag(move.state))
    && String(move.partnerId ?? move.partner_id) === String(subscription.partnerId ?? subscription.partner_id)
    && String(move.currencyId ?? move.currency_id) === String(subscription.currencyId ?? subscription.currency_id));
}

export function invoiceOutstanding(invoice: WorkflowRow): number | null {
  const value = workflowTag(invoice.state) === 'draft'
    ? invoice.amountTotal ?? invoice.amount_total : invoice.amountResidual ?? invoice.amount_residual;
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function nextSubscriptionAction(subscription: WorkflowRow, input: {
  linesReady: boolean; lines: readonly WorkflowRow[]; billingReady: boolean;
  invoices: readonly WorkflowRow[]; now?: Date;
}): SubscriptionActionId | null {
  const state = subscriptionStateOf(subscription);
  if (state === 'draft') return input.linesReady && input.lines.some((line) =>
    String(line.subscriptionId ?? line.subscription_id) === String(subscription.id)) ? 'activate' : null;
  if (state === 'paused') return 'resume';
  if (state !== 'active' || !input.billingReady) return null;
  if (input.invoices.some((invoice) => (invoiceOutstanding(invoice) ?? 0) > 0)) return 'pay-invoice';
  // Unknown residuals must not be interpreted as settled invoices.
  if (input.invoices.some((invoice) => invoiceOutstanding(invoice) == null)) return null;
  const due = kpiDate(subscription.recurringNextDate ?? subscription.recurring_next_date);
  return due != null && due.getTime() <= (input.now ?? new Date()).getTime() ? 'generate-invoice' : null;
}

export const ADVANCED_SUBSCRIPTION_ACTIONS: readonly SubscriptionActionId[] = [
  'ingest-usage', 'rate-usage', 'set-commitment', 'record-failure', 'advance-dunning', 'refresh-flags',
];

export function subscriptionActionPermissions(action: SubscriptionActionId): Array<[string, 'create' | 'write' | 'delete']> {
  if (action === 'cancel') return [['subscription', 'delete'], ['account_move', 'create']];
  if (action === 'pay-invoice') return [['subscription', 'write'], ['payment', 'create'], ['account_move', 'write']];
  if (action === 'close') return [['subscription', 'delete']];
  if (action === 'generate-invoice' || action === 'amend') return [['subscription', 'write'], ['account_move', 'create']];
  return [['subscription', 'write']];
}
