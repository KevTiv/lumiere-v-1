'use client';

import { useTranslation } from '@lumiere/i18n';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import { subscriptionLifecycle } from './subscription-lifecycle';
import { SubscriptionSourceNotice } from './subscription-overview';
import type { SubscriptionScope, WorkflowRow } from './subscription-workflow';

export function SubscriptionLifecycleSummary({ subscription, amendments, amendmentsState, scope }: {
  subscription: WorkflowRow; amendments: readonly WorkflowRow[];
  amendmentsState: ModuleDataState; scope: SubscriptionScope;
}) {
  const { t } = useTranslation();
  const lifecycle = subscriptionLifecycle(subscription, amendments, scope, amendmentsState.status === 'ready');
  const formatDate = (value: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
  return <section className="space-y-3 rounded-lg border p-4" aria-label={t('subscriptions.lifecycle.title')} data-testid="subscription-lifecycle">
    <h2 className="font-medium">{t('subscriptions.lifecycle.title')}</h2>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t('subscriptions.workflow.currentNextInvoice')}</dt><dd>{lifecycle.nextInvoiceDate ? formatDate(lifecycle.nextInvoiceDate) : t('subscriptions.lifecycle.dateUnavailable')}</dd></div>
      <div><dt className="text-muted-foreground">{t('subscriptions.lifecycle.contractEnd')}</dt><dd>{t('subscriptions.lifecycle.contractEndUnavailable')}</dd></div>
      <div><dt className="text-muted-foreground">{t('subscriptions.lifecycle.closedAt')}</dt><dd>{lifecycle.closedAt ? formatDate(lifecycle.closedAt) : t(`subscriptions.lifecycle.closure.${lifecycle.closure}`)}</dd></div>
      <div><dt className="text-muted-foreground">{t('subscriptions.lifecycle.renewal')}</dt><dd>{t(`subscriptions.lifecycle.renewalState.${lifecycle.renewal}`)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-muted-foreground">{t('subscriptions.lifecycle.lastRenewal')}</dt><dd>{lifecycle.lastRenewal
        ? t('subscriptions.lifecycle.renewalRecorded', { date: formatDate(lifecycle.lastRenewal.effectiveDate), version: lifecycle.lastRenewal.version })
        : t(`subscriptions.lifecycle.history.${lifecycle.renewalHistory}`)}</dd></div>
    </dl>
    <p className="text-sm text-muted-foreground">{t('subscriptions.lifecycle.dateMeaning')}</p>
    {amendmentsState.status !== 'ready' && <SubscriptionSourceNotice state={amendmentsState} />}
  </section>;
}
