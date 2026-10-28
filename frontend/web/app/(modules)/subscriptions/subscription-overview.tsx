'use client';

import Link from 'next/link';
import { useTranslation } from '@lumiere/i18n';
import { Button } from '@lumiere/ui/components/button';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import { inSubscriptionScope, type SubscriptionScope, type WorkflowRow } from './subscription-workflow';
import { subscriptionStateOf } from './subscription-status';

export function SubscriptionSourceNotice({ state }: { state: ModuleDataState }) {
  const { t } = useTranslation();
  return <div role={state.status === 'error' ? 'alert' : 'status'} className="space-y-2 text-sm text-muted-foreground">
    <p>{t(`subscriptions.workflow.source.${state.status}`)}</p>
    {'onRetry' in state && state.onRetry && <Button variant="outline" onClick={state.onRetry}>{t('common.retry')}</Button>}
  </div>;
}

interface Source { rows: readonly WorkflowRow[]; state: ModuleDataState }
export function SubscriptionOverview({ scope, subscriptions, dueToBill, pastDue, onCreate, canCreate }: {
  scope: SubscriptionScope; subscriptions: Source; dueToBill: Source; pastDue: Source;
  onCreate: () => void; canCreate: boolean;
}) {
  const { t } = useTranslation();
  const rows = subscriptions.rows.filter((row) => inSubscriptionScope(row, scope));
  const countCollections = (source: Source) => new Set(source.rows.filter((row) => inSubscriptionScope(row, scope))
    .map((row) => String(row.subscriptionId ?? row.subscription_id))).size;
  const queues = [
    { key: 'drafts', count: rows.filter((row) => subscriptionStateOf(row) === 'draft').length, state: subscriptions.state, href: '/subscriptions?tab=subscriptions&filter=state:draft' },
    { key: 'due', count: countCollections(dueToBill), state: dueToBill.state, href: '/subscriptions?tab=due-to-bill' },
    { key: 'overdue', count: countCollections(pastDue), state: pastDue.state, href: '/subscriptions?tab=past-due' },
    { key: 'paused', count: rows.filter((row) => subscriptionStateOf(row) === 'paused').length, state: subscriptions.state, href: '/subscriptions?tab=subscriptions&filter=state:paused' },
  ];
  return <section className="space-y-4" aria-labelledby="subscription-work-heading" data-testid="subscription-overview">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="subscription-work-heading" className="text-lg font-semibold">{t('subscriptions.workflow.needsAttention')}</h2>
      {canCreate && <Button onClick={onCreate}>{t('subscriptions.workflow.newSubscription')}</Button>}
    </div>
    {scope.companyId <= 0n ? <p role="status">{t('subscriptions.workflow.selectCompany')}</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {queues.map((queue) => <div key={queue.key} className="min-w-0 space-y-3 rounded-lg border p-4" data-testid={`subscription-queue-${queue.key}`}>
          <h3 className="font-medium">{t(`subscriptions.workflow.queues.${queue.key}.title`)}</h3>
          {queue.state.status === 'ready' ? <>
            <p className="text-2xl font-semibold tabular-nums">{queue.count}</p>
            <p className="text-sm text-muted-foreground">{t(`subscriptions.workflow.queues.${queue.key}.hint`)}</p>
            <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={queue.href}>{t('subscriptions.workflow.reviewQueue')}</Link>
          </> : <SubscriptionSourceNotice state={queue.state} />}
        </div>)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/subscriptions?tab=plans">{t('subscriptions.workflow.managePlans')}</Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/subscriptions?tab=subscriptions&filter=state:active">{t('subscriptions.workflow.reviewRenewals')}</Link>
      </div>
    </>}
  </section>;
}
