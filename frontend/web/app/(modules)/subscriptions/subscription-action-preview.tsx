'use client';

import type { FormValues } from '@lumiere/ui/lib/form-types';
import { useTranslation } from '@lumiere/i18n';
import { kpiDate } from '@lumiere/ui/lib/kpi-tiles';
import { invoiceOutstanding, type WorkflowRow } from './subscription-workflow';
import type { SubscriptionActionId } from './subscription-actions';

export function SubscriptionActionPreview({ action, subscription, values, invoices, lines, currencies }: {
  action: SubscriptionActionId; subscription: WorkflowRow; values: FormValues;
  invoices: readonly WorkflowRow[]; lines: readonly WorkflowRow[]; currencies: readonly WorkflowRow[];
}) {
  const { t } = useTranslation();
  const currency = currencies.find((row) => String(row.id) === String(subscription.currencyId ?? subscription.currency_id));
  const money = (value: unknown) => {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return t('subscriptions.workflow.unavailableAmount');
    return currency?.code ? new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency.code) }).format(Number(value))
      : t('subscriptions.workflow.amountCurrencyUnknown', { amount: Number(value) });
  };
  const invoice = invoices.find((row) => String(row.id) === String(values.invoiceMoveId));
  const line = lines.find((row) => String(row.id) === String(values.lineId));
  const nextDate = kpiDate(subscription.recurringNextDate ?? subscription.recurring_next_date);
  const item = (label: string, value: string) => <div><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>;
  return <section className="space-y-4 rounded-lg border p-4" aria-label={t('subscriptions.workflow.actionReview')} data-testid="subscription-action-preview">
    <h3 className="font-medium">{t('subscriptions.workflow.actionReview')}</h3>
    <p className="text-sm">{t(`subscriptions.workflow.effects.${action}`)}</p>
    <dl className="space-y-3 text-sm">
      {item(t('subscriptions.workflow.contract'), String(subscription.code ?? subscription.id))}
      {item(t('subscriptions.workflow.effective'), action === 'generate-invoice' ? String(values.invoiceDate ?? '—') : t('subscriptions.workflow.onConfirmation'))}
      {nextDate && item(t('subscriptions.workflow.currentNextInvoice'), new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(nextDate))}
      {action === 'generate-invoice' && item(t('subscriptions.workflow.recurringAmount'), money(subscription.recurringTotal ?? subscription.recurring_total))}
      {action === 'pay-invoice' && <>
        {item(t('subscriptions.workflow.invoice'), String(invoice?.name ?? t('subscriptions.workflow.notSelected')))}
        {item(t('subscriptions.workflow.outstanding'), money(invoice ? invoiceOutstanding(invoice) : null))}
        {item(t('subscriptions.workflow.paymentAmount'), money(values.amount === '' || values.amount == null ? (invoice ? invoiceOutstanding(invoice) : null) : values.amount))}
      </>}
      {action === 'cancel' && item(t('subscriptions.workflow.credit'), values.createCreditNote === true
        ? (invoice ? `${String(invoice.name ?? invoice.id)} · ${money(invoice.amountTotal ?? invoice.amount_total)}` : t('subscriptions.workflow.chooseCreditInvoice'))
        : t('subscriptions.workflow.noCredit'))}
      {action === 'amend' && <>
        {item(t('subscriptions.workflow.currentPrice'), money(line?.priceUnit ?? line?.price_unit))}
        {item(t('subscriptions.workflow.newPrice'), values.newPriceUnit === '' || values.newPriceUnit == null ? t('subscriptions.workflow.unchanged') : money(values.newPriceUnit))}
        {item(t('subscriptions.workflow.newQuantity'), values.newQuantity === '' || values.newQuantity == null ? t('subscriptions.workflow.unchanged') : String(values.newQuantity))}
      </>}
      {action === 'renew' && item(t('subscriptions.workflow.renewalPeriods'), String(values.intervals || 1))}
    </dl>
    {action === 'renew' && <p className="text-sm text-muted-foreground">{t('subscriptions.lifecycle.renewalEffect')}</p>}
    {(action === 'cancel' || action === 'close') && <p className="text-sm text-muted-foreground">{t('subscriptions.workflow.closeVsCancel')}</p>}
    {action === 'amend' && values.prorate === true && <p className="text-sm text-muted-foreground">{t('subscriptions.workflow.prorationCalculated')}</p>}
  </section>;
}
