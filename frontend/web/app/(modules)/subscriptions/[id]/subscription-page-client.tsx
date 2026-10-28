'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListOrdered, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  EntityDetail,
  EntityView,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  SmartButtons,
  StatusBar,
  buildModuleTabHref,
  FormModal,
  useRBAC,
  subscriptionAmendmentsTableConfig,
  subscriptionLinesTableConfig,
  subscriptionsTableConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { useAccountMoves, useAccountPayments } from '@lumiere/query-hooks/hooks/accounting';
import { subscriptionRecordLinks } from '@lumiere/query-hooks/hooks/cross-record-links';
import {
  useSubscriptionAmendments,
  useSubscriptionBillingRuns,
  useCreateSubscriptionPaymentIntent,
  useSubscriptionLines,
  useSubscriptions,
  type Subscription,
} from '@lumiere/query-hooks/hooks/subscriptions';
import { useCurrencies } from '@lumiere/query-hooks/hooks/settings';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useSubscriptionsModuleSubscription } from '@/lib/module-subscription-hooks';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { currencyOptionsFromRows } from '@/lib/form-lookup';
import { RecordDocumentAttachments } from '../../../../components/record-document-attachments';
import { CrossRecordLinks } from '../../../../components/order-handoff-links';
import { subscriptionStateOf, subscriptionStatusBar } from '../subscription-status';
import { subscriptionPageActions, type SubscriptionActionId } from '../subscription-actions';
import { useSubscriptionActions } from '../use-subscription-actions';
import { inSubscriptionScope, subscriptionInvoices, invoiceOutstanding, nextSubscriptionAction, ADVANCED_SUBSCRIPTION_ACTIONS, subscriptionActionPermissions } from '../subscription-workflow';
import { moduleCollection } from '@lumiere/ui/lib/module-data-state';
import { SubscriptionSourceNotice } from '../subscription-overview';
import { PAYMENT_INTENT_TYPES, newIdempotencyKey, toPaymentIntentParams } from '../subscription-payment-intent';

interface SubscriptionPageClientProps {
  subscriptionId: string;
  initialSubscriptions?: Subscription[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'lines', 'amendments', 'billing', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function SubscriptionPageClient(props: SubscriptionPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <SubscriptionPageLoaded {...props} organizationId={props.organizationId} />;
}

function SubscriptionPageLoaded({
  subscriptionId,
  initialSubscriptions,
  organizationId,
}: SubscriptionPageClientProps & { organizationId: number }) {
  useSubscriptionsModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const subscriptionsQuery = useSubscriptions(orgId, initialSubscriptions);
  const { rows: subscriptions, state: subscriptionsState } = moduleCollection(subscriptionsQuery);
  const isLoading = subscriptionsQuery.isLoading;
  const linesQuery = useSubscriptionLines(orgId);
  const { rows: lines, state: linesState } = moduleCollection(linesQuery);
  const { data: amendments = [] } = useSubscriptionAmendments(orgId);
  const { data: billingRuns = [], isLoading: runsLoading, isError: runsError } = useSubscriptionBillingRuns(orgId);
  const { data: accountMoves = [], isLoading: movesLoading, isError: movesError } = useAccountMoves(orgId);
  const { data: accountPayments = [], isLoading: paymentsLoading, isError: paymentsError } = useAccountPayments(orgId);

  const subscriptionActions = useSubscriptionActions(orgId, operatingCompanyId, subscriptionsState.status === 'ready');
  const { checkPermission, permissionsReady } = useRBAC();
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const createPaymentIntent = useCreateSubscriptionPaymentIntent(orgId, operatingCompanyId);
  const { data: currencies = [] } = useCurrencies();
  const currencyOptions = useMemo(
    () => currencyOptionsFromRows(currencies as unknown as Row[]),
    [currencies],
  );

  const subscription = useMemo(
    () => (subscriptions as unknown as Row[]).find((row) => String(row.id) === subscriptionId && inSubscriptionScope(row, { organizationId: orgId, companyId: operatingCompanyId })),
    [subscriptions, subscriptionId, orgId, operatingCompanyId],
  );
  const ownRows = useCallback(
    (rows: unknown) =>
      (rows as Row[]).filter((row) => inSubscriptionScope(row, { organizationId: orgId, companyId: operatingCompanyId }) && String(row.subscriptionId ?? row.subscription_id ?? '') === subscriptionId),
    [subscriptionId, orgId, operatingCompanyId],
  );
  const ownLines = useMemo(() => ownRows(lines), [lines, ownRows]);
  const ownAmendments = useMemo(() => ownRows(amendments), [amendments, ownRows]);

  const navigation = useRecordNavigation<Row>({
    rows: (subscriptions as unknown as Row[]).filter((row) => inSubscriptionScope(row, { organizationId: orgId, companyId: operatingCompanyId })),
    currentId: subscriptionId,
    basePath: '/subscriptions',
    labelOf: (row) => String(row.code || row.id),
  });

  const requestedTab = searchParams.get('tab');
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(requestedTab ?? '')
    ? (requestedTab as TabId)
    : 'overview';
  const setActiveTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (subscriptionsState.status === 'denied' || subscriptionsState.status === 'error') return <SubscriptionSourceNotice state={subscriptionsState} />;

  if (!subscription) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="subscription-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="subscription-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('subscriptions.notFound', { defaultValue: 'Subscription not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('subscriptions.notFoundHint', {
              defaultValue: 'It may have been deleted, or belong to another organization.',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('subscriptions', 'subscriptions')} />} nativeButton={false}>
            {t('subscriptions.backToSubscriptions', { defaultValue: 'Back to subscriptions' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const state = subscriptionStateOf(subscription);
  const label = String(subscription.code || '').trim() || `#${subscriptionId}`;
  const status = subscriptionStatusBar(subscription, t);
  const tableConfig = subscriptionsTableConfig(t);
  const columns = tableConfig.view.mode === 'table' ? tableConfig.view.columns : [];
  const stateColumn = columns.find((column) => column.key === 'state');
  const stateBadge = stateColumn
    ? {
        variant: (stateColumn.badgeVariants?.[state] ?? 'secondary') as 'default' | 'secondary' | 'outline' | 'destructive',
        label: stateColumn.badgeLabels?.[state] ?? state,
      }
    : { variant: 'secondary' as const, label: state };
  const detailConfig = {
    mode: 'detail' as const,
    sections: [{ id: 'subscription', fields: columns.map(({ width: _width, ...field }) => field) }],
  };
  const billingLinks = subscriptionRecordLinks(
    subscription as never,
    { organizationId: orgId, companyId: operatingCompanyId },
    billingRuns as never,
    accountMoves as never,
    paymentsError || paymentsLoading ? undefined : (accountPayments as never),
  );

  const busy = subscriptionActions.pending;
  const actionLabels: Record<SubscriptionActionId, string> = {
    activate: t('subscriptions.actions.activate'),
    pause: t('subscriptions.actions.pause', { defaultValue: 'Pause' }),
    resume: t('subscriptions.actions.resume', { defaultValue: 'Resume' }),
    close: t('subscriptions.actions.close'),
    'generate-invoice': t('subscriptions.actions.generateInvoice'),
    'pay-invoice': t('subscriptions.actions.payInvoice', { defaultValue: 'Apply payment' }),
    amend: t('subscriptions.actions.amend', { defaultValue: 'Amend' }),
    renew: t('subscriptions.actions.renew', { defaultValue: 'Renew' }),
    cancel: t('subscriptions.actions.cancel', { defaultValue: 'Cancel + credit' }),
    'ingest-usage': t('subscriptions.actions.ingestUsage', { defaultValue: 'Ingest usage' }),
    'rate-usage': t('subscriptions.actions.rateUsage', { defaultValue: 'Rate usage' }),
    'set-commitment': t('subscriptions.actions.setCommitment', { defaultValue: 'Set commitment' }),
    'record-failure': t('subscriptions.actions.recordFailure', { defaultValue: 'Record payment fail' }),
    'advance-dunning': t('subscriptions.actions.advanceDunning', { defaultValue: 'Advance dunning' }),
    'refresh-flags': t('subscriptions.actions.refreshFlags', { defaultValue: 'Refresh exception flags' }),
  };
  const runAction = (action: SubscriptionActionId) => subscriptionActions.openDialog(action, BigInt(subscriptionId));
  const billingReady = !runsLoading && !runsError && !movesLoading && !movesError;
  const invoices = billingReady ? subscriptionInvoices(subscription, billingRuns, accountMoves, { organizationId: orgId, companyId: operatingCompanyId }) : [];
  const unpaidInvoices = invoices.filter((invoice) => (invoiceOutstanding(invoice) ?? 0) > 0);
  const canAct = (action: SubscriptionActionId) => permissionsReady !== false && subscriptionsState.status === 'ready'
    && subscriptionActionPermissions(action).every(([resource, verb]) => checkPermission(resource, verb).allowed);
  const canRequestPayment = permissionsReady !== false && subscriptionsState.status === 'ready' && checkPermission('subscription', 'write').allowed;
  const nextAction = nextSubscriptionAction(subscription, { linesReady: linesState.status === 'ready', lines: ownLines, billingReady, invoices });
  const headerActions = subscriptionPageActions(state).filter((action) => canAct(action.id)
    && (action.id !== 'activate' || (linesState.status === 'ready' && ownLines.length > 0))
    && (action.id !== 'pay-invoice' || (billingReady && unpaidInvoices.length > 0)));
  const primaryActions = headerActions.filter((action) => action.id === nextAction);
  const moreActions = headerActions.filter((action) => action.id !== nextAction);
  const paymentRequestForm = {
    id: 'subscription-payment-request', title: t('subscriptions.workflow.requestPayment'),
    description: t('subscriptions.workflow.requestExplanation'), submitLabel: t('subscriptions.workflow.requestPayment'),
    sections: [{ id: 'request', fields: [
      { id: 'intentType', name: 'intentType', type: 'select' as const, label: t('subscriptions.paymentIntent.intentType'), required: true, defaultValue: 'card_charge', options: PAYMENT_INTENT_TYPES.map((value) => ({ value, label: t(`subscriptions.paymentIntent.types.${value}`, { defaultValue: value }) })) },
      { id: 'invoiceMoveId', name: 'invoiceMoveId', type: 'select' as const, label: t('subscriptions.workflow.invoice'), defaultValue: unpaidInvoices.length === 1 ? String(unpaidInvoices[0]!.id) : '', required: true,
        options: unpaidInvoices.map((invoice) => ({ value: String(invoice.id), label: String(invoice.name ?? invoice.id) })) },
      { id: 'amount', name: 'amount', type: 'money' as const, label: t('subscriptions.paymentIntent.amount'), required: true, validation: { min: 0.01 }, defaultValue: unpaidInvoices.length === 1 ? invoiceOutstanding(unpaidInvoices[0]!) ?? undefined : undefined },
      { id: 'currencyId', name: 'currencyId', type: 'select' as const, label: t('subscriptions.paymentIntent.currency'), required: true, disabled: true, defaultValue: String(subscription.currencyId ?? subscription.currency_id ?? ''),
        options: currencyOptions.filter((option) => option.value === String(subscription.currencyId ?? subscription.currency_id)) },
    ] }],
  };
  const id = BigInt(subscriptionId);

  return (
    <RecordPage
      testIdPrefix="subscription"
      breadcrumbs={[
        { label: t('nav.subscriptions', { defaultValue: 'Subscriptions' }), href: '/subscriptions' },
        { label: t('subscriptions.subscriptions.title'), href: buildModuleTabHref('subscriptions', 'subscriptions') },
        { label },
      ]}
      title={label}
      subtitle={String(subscription.description ?? '').trim() || undefined}
      badge={<Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>}
      statusBar={<StatusBar steps={status.steps} current={status.current} />}
      navigation={navigation}
      smartButtons={
        <SmartButtons
          testIdPrefix="subscription"
          buttons={[
            {
              id: 'lines',
              label: t('subscriptions.lines.title', { defaultValue: 'Lines' }),
              count: ownLines.length,
              icon: <ListOrdered className="h-4 w-4" />,
              onClick: () => setActiveTab('lines'),
            },
            {
              id: 'amendments',
              label: t('subscriptions.amendments.title', { defaultValue: 'Amendments' }),
              count: ownAmendments.length,
              onClick: () => setActiveTab('amendments'),
              hideWhenZero: true,
            },
          ]}
        />
      }
      actions={
        <>
          {subscriptionActions.dialogs}
          <FormModal key={`${orgId}:${operatingCompanyId}:${subscriptionId}:${requestKey}`} open={requestOpen} onOpenChange={setRequestOpen} config={paymentRequestForm} draft={false}
            isPending={createPaymentIntent.isPending} submissionDisabled={!billingReady || !canRequestPayment || unpaidInvoices.length === 0}
            showSubmitSuccessToast={false}
            onSubmit={async (values) => {
              const invoice = unpaidInvoices.find((row) => String(row.id) === String(values.invoiceMoveId));
              const amount = Number(values.amount);
              if (!billingReady || !canRequestPayment || !invoice || !Number.isFinite(amount) || amount <= 0 || amount > (invoiceOutstanding(invoice) ?? 0)
                || String(values.currencyId) !== String(subscription.currencyId ?? subscription.currency_id)) throw new Error(t('subscriptions.workflow.invalidPayment'));
              const params = toPaymentIntentParams(values, requestKey);
              if (!params) throw new Error(t('subscriptions.workflow.invalidPayment'));
              await createPaymentIntent.mutateAsync({ subscriptionId: BigInt(subscriptionId), params });
              showWorkflowToast({ kind: 'success', title: t('subscriptions.workflow.requestCreated'), description: t('subscriptions.workflow.requestExplanation') });
            }} />
          {primaryActions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              disabled={busy}
              data-testid={`subscription-action-${action.id}`}
              onClick={() => runAction(action.id)}
            >
              {actionLabels[action.id]}
            </Button>
          ))}
          {state === 'active' && canRequestPayment && billingReady && unpaidInvoices.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || createPaymentIntent.isPending}
              data-testid="subscription-create-payment-intent"
              onClick={() => { setRequestKey(newIdempotencyKey()); setRequestOpen(true); }}
            >
              {t('subscriptions.workflow.requestPayment')}
            </Button>
          ) : null}
          {moreActions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy} data-testid="subscription-more-actions">
                  <MoreHorizontal className="mr-1 h-4 w-4" />
                  {t('subscriptions.workflow.manageSubscription')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[...moreActions.filter((action) => !ADVANCED_SUBSCRIPTION_ACTIONS.includes(action.id)), ...moreActions.filter((action) => ADVANCED_SUBSCRIPTION_ACTIONS.includes(action.id))].map((action, index, ordered) => (
                  <div key={action.id}>
                    {index > 0 && (action.id === 'cancel' || (ADVANCED_SUBSCRIPTION_ACTIONS.includes(action.id) && !ADVANCED_SUBSCRIPTION_ACTIONS.includes(ordered[index - 1]!.id))) ? <DropdownMenuSeparator /> : null}
                    {ADVANCED_SUBSCRIPTION_ACTIONS.includes(action.id) && (index === 0 || !ADVANCED_SUBSCRIPTION_ACTIONS.includes(ordered[index - 1]!.id)) && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('subscriptions.workflow.advanced')}</p>}
                    <DropdownMenuItem
                      data-testid={`subscription-action-${action.id}`}
                      onSelect={() => runAction(action.id)}
                    >
                      {actionLabels[action.id]}
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabs={[
        {
          id: 'overview',
          label: t('common.overview', { defaultValue: 'Overview' }),
          content: <div className="space-y-5">
            <section className="space-y-2 rounded-lg border p-4" data-testid="subscription-next-step">
              <h2 className="font-medium">{t('subscriptions.workflow.nextStep')}</h2>
              <p className="text-sm text-muted-foreground">{t(nextAction && !canAct(nextAction) ? 'subscriptions.workflow.operatorNeeded' : nextAction ? `subscriptions.workflow.next.${nextAction}` : state === 'closed' ? 'subscriptions.workflow.next.closed' : state === 'draft' && linesState.status === 'ready' && ownLines.length === 0 ? 'subscriptions.workflow.noLines' : !billingReady || linesState.status !== 'ready' ? 'subscriptions.workflow.next.verify' : 'subscriptions.workflow.next.scheduled')}</p>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('billing')}>{t('subscriptions.workflow.reviewBilling')}</Button>
            </section>
            <EntityDetail config={detailConfig} data={subscription} />
          </div>,
        },
        {
          id: 'lines',
          label: t('subscriptions.lines.title', { defaultValue: 'Lines' }),
          content: (
            <EntityView
              config={{ ...subscriptionLinesTableConfig(t), title: '', description: undefined }}
              data={ownLines}
              useCard={false}
            />
          ),
        },
        {
          id: 'amendments',
          label: t('subscriptions.amendments.title', { defaultValue: 'Amendments' }),
          content: (
            <EntityView
              config={{ ...subscriptionAmendmentsTableConfig(t), title: '', description: undefined }}
              data={ownAmendments}
              useCard={false}
            />
          ),
        },
        {
          id: 'billing',
          label: t('subscriptions.page.billing', { defaultValue: 'Invoices & payments' }),
          content:
            runsLoading || movesLoading ? (
              <p>{t('common.loading', { defaultValue: 'Loading…' })}</p>
            ) : (
              <CrossRecordLinks
                testIdPrefix="subscription-handoff"
                result={
                  runsError || movesError
                    ? { status: 'unavailable', links: [], reason: 'Linked billing records are unavailable' }
                    : billingLinks
                }
              />
            ),
        },
        {
          id: 'discussion',
          label: t('subscriptions.page.discussion', { defaultValue: 'Discussion' }),
          content: (
            <div className="grid gap-6 lg:grid-cols-2" data-testid="subscription-discussion">
              <RecordChatter
                organizationId={organizationId}
                resModel="subscription"
                resId={id}
                recordTitle={label}
              />
              <RecordDocumentAttachments
                organizationId={orgId}
                resModel="subscription"
                resId={id}
                title={t('subscriptions.page.attachments', { defaultValue: 'Attachments' })}
              />
            </div>
          ),
        },
        {
          id: 'audit',
          label: t('common.audit', { defaultValue: 'Audit' }),
          content: <RecordAuditTab tableName="subscription" recordId={subscriptionId} />,
        },
      ]}
    />
  );
}
