'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { FormValues } from '@lumiere/ui/lib/form-types';
import { useTranslation } from '@lumiere/i18n';
import { Button, ModularForm, newSubscriptionForm, mergeSelectOptionsForFields, type FormConfig, type FormField } from '@lumiere/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@lumiere/ui/components/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@lumiere/ui/components/alert-dialog';
import { useUnsavedChangesGuard } from '@lumiere/ui/forms/use-unsaved-changes-guard';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import { eligibleSubscriptionOrders, eligibleSubscriptionPlans, type SubscriptionScope, type WorkflowRow } from './subscription-workflow';
import { SubscriptionSourceNotice } from './subscription-overview';

const STEPS = ['order', 'plan', 'billing', 'review'] as const;

/** Domain-owned steps retain one payload while existing forms own validation and focus. */
export function SubscriptionCreateDialog({ open, onClose, scope, orders, plans, sourceState, onRetry, onCreatePlan, onSubmit, pending = false, currencies = [], customers = [] }: {
  open: boolean; onClose: () => void; scope: SubscriptionScope;
  orders: readonly WorkflowRow[]; plans: readonly WorkflowRow[]; currencies?: readonly WorkflowRow[]; customers?: readonly WorkflowRow[];
  sourceState: ModuleDataState; onRetry: () => void; onCreatePlan?: () => void;
  onSubmit: (values: FormValues) => Promise<void>; pending?: boolean;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>({});
  const currentValues = useRef<FormValues>({});
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const hasEntries = dirty || step > 0 || Boolean(currentValues.current.saleOrderId);
  const unsaved = useUnsavedChangesGuard(open && hasEntries, pending);
  const eligibleOrders = eligibleSubscriptionOrders(orders, scope);
  const eligiblePlans = eligibleSubscriptionPlans(plans, scope);
  const verified = sourceState.status === 'ready' && scope.companyId > 0n;
  const missingOrder = verified && eligibleOrders.length === 0;
  const missingPlan = verified && eligiblePlans.length === 0;
  const source = mergeSelectOptionsForFields(newSubscriptionForm(t), {
    saleOrderId: eligibleOrders.map((row) => ({ value: String(row.id), label: String(row.reference ?? row.id) })),
    planId: eligiblePlans.map((row) => ({ value: String(row.id), label: String(row.name ?? row.code ?? row.id) })),
  });
  const fieldNames = step === 0 ? ['saleOrderId'] : step === 1 ? ['planId']
    : step === 2 ? ['dateStart', 'paymentMode', 'recurringRuleType', 'recurringInterval', 'recurringInvoiceDay', 'isTrial']
    : ['code', 'description'];
  const defaults: FormValues = { dateStart: new Date().toISOString().slice(0, 10), paymentMode: 'manual', recurringRuleType: 'monthly', recurringInterval: 1, recurringInvoiceDay: 1 };
  const config: FormConfig = {
    ...source, id: `subscription-create-${STEPS[step]}`, title: '', description: '', showReset: false,
    submitLabel: step === 3 ? t('subscriptions.workflow.createDraft') : t('subscriptions.workflow.continue'),
    sections: [{ id: STEPS[step]!, title: t(`subscriptions.workflow.steps.${STEPS[step]}`), fields: source.sections.flatMap((section) => section.fields)
      .filter((field) => fieldNames.includes(field.name))
      .map((field) => ({ ...field, defaultValue: currentValues.current[field.name] ?? values[field.name] ?? defaults[field.name] ?? field.defaultValue,
        ...(['recurringInterval', 'recurringInvoiceDay'].includes(field.name) ? { required: true, validation: { min: 1, ...(field.name === 'recurringInvoiceDay' ? { max: 31 } : {}), custom: (value: unknown) => Number.isInteger(Number(value)) ? null : t('subscriptions.workflow.wholeNumber') } } : {}) }) as FormField) }],
  };
  const requestClose = () => { if (pending) return; if (hasEntries) setDiscarding(true); else onClose(); };
  const preview = (edited: FormValues) => {
    const draft = { ...values, ...edited };
    const order = eligibleOrders.find((row) => String(row.id) === String(draft.saleOrderId));
    const plan = eligiblePlans.find((row) => String(row.id) === String(draft.planId));
    const customer = customers.find((row) => String(row.id) === String(order?.partnerId) && String(row.organizationId ?? row.organization_id) === String(scope.organizationId));
    const currency = currencies.find((row) => String(row.id) === String(order?.currencyId));
    const orderLabel = order ? String(order.reference ?? order.id) : t('subscriptions.workflow.notSelected');
    return <section className="space-y-4 rounded-lg border p-4" aria-label={t('subscriptions.workflow.review')}>
      <h3 className="font-medium">{t('subscriptions.workflow.review')}</h3>
      <dl className="space-y-3 text-sm [&_dd]:break-words [&_dt]:text-muted-foreground">
        <div><dt>{t('subscriptions.workflow.steps.order')}</dt><dd>{orderLabel}</dd></div>
        <div><dt>{t('subscriptions.workflow.steps.plan')}</dt><dd>{String(plan?.name ?? t('subscriptions.workflow.notSelected'))}</dd></div>
        <div><dt>{t('subscriptions.workflow.customer')}</dt><dd>{String(customer?.name ?? order?.partnerName ?? t('subscriptions.workflow.inheritedCustomer'))}</dd></div>
        <div><dt>{t('subscriptions.workflow.orderTotal')}</dt><dd>{order?.amountTotal != null && currency?.code ? `${new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency.code) }).format(Number(order.amountTotal))}` : t('subscriptions.workflow.checkOrder')}</dd></div>
        <div><dt>{t('subscriptions.workflow.starts')}</dt><dd>{String(draft.dateStart ?? '—')}</dd></div>
        <div><dt>{t('subscriptions.workflow.steps.billing')}</dt><dd>{t('subscriptions.workflow.schedule', { interval: draft.recurringInterval ?? 1, period: t(`subscriptions.forms.newSubscription.fields.options.recurring.${String(draft.recurringRuleType ?? 'monthly')}`) })}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">{t('subscriptions.workflow.draftExplanation')}</p>
      {order && <Link href={`/sales/orders/${String(order.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t('subscriptions.workflow.inspectOrder')}</Link>}
    </section>;
  };
  return <>
    {unsaved}
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent className="flex max-h-[86dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]" data-testid="subscription-create-dialog">
        <DialogHeader className="shrink-0 space-y-3 border-b px-6 py-5 pr-12">
          <DialogTitle>{t('subscriptions.workflow.newSubscription')}</DialogTitle>
          <DialogDescription>{t('subscriptions.workflow.stepProgress', { current: step + 1, total: STEPS.length, step: t(`subscriptions.workflow.steps.${STEPS[step]}`) })}</DialogDescription>
          <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t('subscriptions.workflow.stepsLabel')}>
            {STEPS.map((name, index) => <li key={name} aria-current={index === step ? 'step' : undefined} className={index === step ? 'font-semibold' : 'text-muted-foreground'}>{index + 1}. {t(`subscriptions.workflow.steps.${name}`)}</li>)}
          </ol>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!verified || missingOrder || missingPlan ? <div className="space-y-4 overflow-y-auto p-6">
            {!verified ? <><SubscriptionSourceNotice state={sourceState} /><Button variant="outline" onClick={onRetry}>{t('common.retry')}</Button></> : <>
              <h3 className="font-medium">{t('subscriptions.workflow.setupNeeded')}</h3>
              {missingOrder && <p className="text-sm">{t('subscriptions.workflow.missingOrder')}</p>}
              {missingPlan && <p className="text-sm">{t('subscriptions.workflow.missingPlan')}</p>}
              <div className="flex flex-wrap gap-3">
                {missingPlan && onCreatePlan && <Button onClick={onCreatePlan}>{t('subscriptions.workflow.createPlan')}</Button>}
                {missingOrder && <Button variant="outline" render={<Link href="/sales?tab=orders" target="_blank" rel="noopener noreferrer" />} nativeButton={false}>{t('subscriptions.workflow.openSales')}</Button>}
                <Button variant="outline" onClick={onRetry}>{t('subscriptions.workflow.refreshSetup')}</Button>
              </div>
            </>}
            <Button variant="outline" onClick={requestClose}>{t('common.cancel')}</Button>
          </div> : <ModularForm key={`${scope.organizationId}:${scope.companyId}:${step}`} config={config} scrollable draft={false} isPending={pending}
            onDirtyChange={setDirty} onValuesChange={(next) => { currentValues.current = { ...currentValues.current, ...next }; }}
            onCancel={requestClose} renderPreview={preview}
            leadingActions={step > 0 ? <Button type="button" variant="outline" disabled={pending} onClick={() => {
              setValues((previous) => ({ ...previous, ...currentValues.current })); setStep((previous) => previous - 1);
            }}>{t('subscriptions.workflow.back')}</Button> : undefined}
            onSubmit={async (next) => {
              const payload = { ...values, ...currentValues.current, ...next };
              if (step === 1 && payload.planId !== values.planId) {
                const plan = eligiblePlans.find((row) => String(row.id) === String(payload.planId));
                const periods: Record<string, string> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };
                payload.recurringRuleType = periods[String(plan?.billingPeriod)] ?? 'monthly';
                payload.recurringInterval = plan?.billingPeriodUnit ?? 1;
                payload.recurringInvoiceDay = plan?.recurringInvoiceDay ?? 1;
                payload.paymentMode = plan?.paymentMode === 'automated_payment' ? 'automatic' : 'manual';
                payload.isTrial = plan?.trialPeriod === true;
              }
              currentValues.current = payload;
              setValues(payload);
              if (step < 3) { setStep(step + 1); return; }
              if (!eligibleOrders.some((row) => String(row.id) === String(payload.saleOrderId)) || !eligiblePlans.some((row) => String(row.id) === String(payload.planId))) {
                throw new Error(t('subscriptions.workflow.selectionChanged'));
              }
              await onSubmit(payload);
              onClose();
            }} />}
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discarding} onOpenChange={setDiscarding}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('common.discardChanges.title')}</AlertDialogTitle><AlertDialogDescription>{t('common.discardChanges.navigate')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('common.discardChanges.keep')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('common.discardChanges.discard')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
