'use client';

import { useCallback, useMemo } from 'react';
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
  useFormDialog,
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
import { isSubscriptionDialogAction, useSubscriptionActions } from '../use-subscription-actions';
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

  const { data: subscriptions = [], isLoading } = useSubscriptions(orgId, initialSubscriptions);
  const { data: lines = [] } = useSubscriptionLines(orgId);
  const { data: amendments = [] } = useSubscriptionAmendments(orgId);
  const { data: billingRuns = [], isLoading: runsLoading, isError: runsError } = useSubscriptionBillingRuns(orgId);
  const { data: accountMoves = [], isLoading: movesLoading, isError: movesError } = useAccountMoves(orgId);
  const { data: accountPayments = [], isLoading: paymentsLoading, isError: paymentsError } = useAccountPayments(orgId);

  const subscriptionActions = useSubscriptionActions(orgId, operatingCompanyId);
  const { checkPermission } = useRBAC();
  const { askForm, formDialog } = useFormDialog();
  const createPaymentIntent = useCreateSubscriptionPaymentIntent(orgId, operatingCompanyId);
  const { data: currencies = [] } = useCurrencies();
  const currencyOptions = useMemo(
    () => currencyOptionsFromRows(currencies as unknown as Row[]),
    [currencies],
  );

  const subscription = useMemo(
    () => (subscriptions as unknown as Row[]).find((row) => String(row.id) === subscriptionId),
    [subscriptions, subscriptionId],
  );
  const ownRows = useCallback(
    (rows: unknown) =>
      (rows as Row[]).filter((row) => String(row.subscriptionId ?? row.subscription_id ?? '') === subscriptionId),
    [subscriptionId],
  );
  const ownLines = useMemo(() => ownRows(lines), [lines, ownRows]);
  const ownAmendments = useMemo(() => ownRows(amendments), [amendments, ownRows]);

  const navigation = useRecordNavigation<Row>({
    rows: subscriptions as unknown as Row[],
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

  const run = useCallback(async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
      showWorkflowToast({ kind: 'success', title, description: '' });
    } catch (error) {
      showWorkflowToast({
        kind: 'error',
        title,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

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
  const runAction = (action: SubscriptionActionId) => {
    if (isSubscriptionDialogAction(action)) {
      subscriptionActions.openDialog(action, id);
      return;
    }
    void run(actionLabels[action], () => subscriptionActions.runDirect(action, id));
  };
  /** Opens a payment intent for this subscription. One idempotency key per dialog, so a retried submit cannot double-create. */
  const promptPaymentIntent = async () => {
    const title = t('subscriptions.paymentIntent.create', { defaultValue: 'Create payment intent' });
    const idempotencyKey = newIdempotencyKey();
    const subscriptionCurrency = String(subscription.currencyId ?? subscription.currency_id ?? '');
    const recurringTotal = Number(subscription.recurringTotal ?? subscription.recurring_total ?? 0);
    const values = await askForm({
      title,
      fields: [
        {
          id: 'intentType',
          name: 'intentType',
          label: t('subscriptions.paymentIntent.intentType', { defaultValue: 'Intent type' }),
          type: 'select',
          required: true,
          defaultValue: 'card_charge',
          width: '1/2',
          options: PAYMENT_INTENT_TYPES.map((value) => ({
            value,
            label: t(`subscriptions.paymentIntent.types.${value}`, { defaultValue: value }),
          })),
        },
        {
          id: 'amount',
          name: 'amount',
          label: t('subscriptions.paymentIntent.amount', { defaultValue: 'Amount' }),
          type: 'number',
          required: true,
          min: 0,
          step: 0.01,
          defaultValue: Number.isFinite(recurringTotal) && recurringTotal > 0 ? recurringTotal : undefined,
          width: '1/2',
        },
        {
          id: 'currencyId',
          name: 'currencyId',
          label: t('subscriptions.paymentIntent.currency', { defaultValue: 'Currency' }),
          type: 'select',
          required: true,
          defaultValue: subscriptionCurrency,
          options: currencyOptions,
          width: '1/2',
        },
        {
          id: 'invoiceMoveId',
          name: 'invoiceMoveId',
          label: t('subscriptions.paymentIntent.invoiceMoveId', { defaultValue: 'Invoice move ID (optional)' }),
          type: 'text',
          inputMode: 'numeric',
          width: '1/2',
        },
      ],
    });
    if (values == null) return;
    const params = toPaymentIntentParams(values, idempotencyKey);
    if (params == null) {
      showWorkflowToast({
        kind: 'error',
        title: t('subscriptions.paymentIntent.failed', { defaultValue: 'Create payment intent failed' }),
        description: t('subscriptions.paymentIntent.invalid', {
          defaultValue: 'Choose an intent type and a currency, and enter an amount above zero (and a valid invoice move ID, if any).',
        }),
      });
      return;
    }
    await run(title, () => createPaymentIntent.mutateAsync({ subscriptionId: BigInt(subscriptionId), params }));
  };
  const headerActions = subscriptionPageActions(state);
  const primaryActions = headerActions.filter((a) => a.primary);
  const moreActions = headerActions.filter((a) => !a.primary);
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
          {formDialog}
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
          {checkPermission('subscription', 'write').allowed ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || createPaymentIntent.isPending}
              data-testid="subscription-create-payment-intent"
              onClick={() => void promptPaymentIntent()}
            >
              {t('subscriptions.paymentIntent.create', { defaultValue: 'Create payment intent' })}
            </Button>
          ) : null}
          {moreActions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy} data-testid="subscription-more-actions">
                  <MoreHorizontal className="mr-1 h-4 w-4" />
                  {t('subscriptions.page.moreActions', { defaultValue: 'More' })}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {moreActions.map((action, index) => (
                  <div key={action.id}>
                    {action.id === 'cancel' && index > 0 ? <DropdownMenuSeparator /> : null}
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
          content: <EntityDetail config={detailConfig} data={subscription} />,
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
