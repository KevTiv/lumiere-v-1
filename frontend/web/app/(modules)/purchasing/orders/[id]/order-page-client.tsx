'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, ListOrdered, PackageCheck } from 'lucide-react';
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
  RecordWorkflowActions,
  SmartButtons,
  StatusBar,
  buildModuleTabHref,
  purchaseOrderDetailConfig,
  purchaseOrderLinesTableConfig,
  purchaseOrderStatusBadges,
} from '@lumiere/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@lumiere/ui/components/alert-dialog';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import {
  variantTag,
  type AnyWorkflowAction,
  type RowValueMap,
  type TransitionNotice,
} from '@lumiere/erp-workflows';
import type { StockPicking } from '@lumiere/stdb/types';
import { useAccountMoves } from '@lumiere/query-hooks/hooks/accounting';
import { useContacts, type Contact } from '@lumiere/query-hooks/hooks/crm';
import { purchaseOrderLinks } from '@lumiere/query-hooks/hooks/cross-record-links';
import { useStockPickings } from '@lumiere/query-hooks/hooks/inventory';
import {
  usePurchaseOrderLines,
  usePurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@lumiere/query-hooks/hooks/purchasing';
import { usePurchasingWorkflow } from '@lumiere/query-hooks/hooks/purchasing-workflow';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { usePurchasingModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { RecordDocumentAttachments } from '../../../../../components/record-document-attachments';
import { CrossRecordLinks } from '../../../../../components/order-handoff-links';
import { CreateBillFromPurchaseOrderDialog } from '../../purchase-order-dialogs';
import { purchaseOrderStatusBar } from '../../purchase-order-status';

interface PurchaseOrderPageClientProps {
  orderId: string;
  initialOrders?: PurchaseOrder[];
  initialOrderLines?: PurchaseOrderLine[];
  initialStockPickings?: StockPicking[];
  initialContacts?: Contact[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type WorkflowAction = AnyWorkflowAction<RowValueMap>;

/** The bill form renders its own failure inline in its dialog, so the toast stays quiet. */
const INLINE_ERROR_TRANSITIONS: ReadonlySet<string> = new Set(['purchasing.order.create-bill']);

const PRIMARY_ACTION_IDS: ReadonlySet<string> = new Set([
  'purchasing.order.send',
  'purchasing.order.confirm',
  'purchasing.order.create-bill',
]);

const TAB_IDS = ['overview', 'lines', 'handoffs', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function PurchaseOrderPageClient(props: PurchaseOrderPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <PurchaseOrderPageLoaded {...props} organizationId={props.organizationId} />;
}

function PurchaseOrderPageLoaded({
  orderId,
  initialOrders,
  initialOrderLines,
  initialStockPickings,
  initialContacts,
  organizationId,
}: PurchaseOrderPageClientProps & { organizationId: number }) {
  usePurchasingModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: orders = [], isLoading: ordersLoading } = usePurchaseOrders(orgId, initialOrders);
  const { data: orderLines = [] } = usePurchaseOrderLines(orgId, initialOrderLines);
  const {
    data: stockPickings = [],
    isLoading: pickingsLoading,
    isError: pickingsError,
  } = useStockPickings(orgId, initialStockPickings);
  const {
    data: accountMoves = [],
    isLoading: movesLoading,
    isError: movesError,
  } = useAccountMoves(orgId);
  const { data: contacts = [] } = useContacts(orgId, initialContacts);

  const workflowSurface = useWorkflowSurface({ organizationId });
  const workflow = usePurchasingWorkflow(
    orgId,
    operatingCompanyId,
    {
      submitRequisition: t('purchasing.actions.submitSelected'),
      approveRequisition: t('purchasing.actions.approveSelected'),
      convertRequisition: t('purchasing.actions.convertToPo', { defaultValue: 'Convert to PO' }),
      closeRequisition: t('purchasing.actions.closeSelected'),
      cancelRequisition: t('purchasing.actions.cancelRequisitions'),
      sendOrder: t('purchasing.actions.sendSelected'),
      confirmOrder: t('purchasing.actions.confirmSelected'),
      cancelOrder: t('purchasing.actions.cancelSelected'),
      createBill: t('purchasing.order.createBill', { defaultValue: 'Create bill' }),
      receiveLine: t('purchasing.actions.receiveFullOpenQty'),
      awardBid: t('purchasing.ops.awardRfqBid', { defaultValue: 'Award RFQ bid' }),
      reviewIntake: t('purchasing.actions.reviewSelected', { defaultValue: 'Start review' }),
      approveIntake: t('purchasing.actions.approveSelected'),
      holdIntake: t('purchasing.actions.holdSelected'),
      rejectIntake: t('purchasing.actions.rejectSelected'),
      holdIntakeReason: '',
      rejectIntakeReason: '',
      computeLandedCost: t('purchasing.actions.recalculateTotals'),
      postLandedCost: t('purchasing.actions.postSelected'),
      applyLandedCost: t('purchasing.actions.applySelected'),
      cancelLandedCost: t('purchasing.actions.cancelSelected'),
      confirmReturn: t('purchasing.ops.confirmPurchaseReturn', { defaultValue: 'Confirm purchase return' }),
      createVendorCredit: t('purchasing.ops.createVendorCredit', { defaultValue: 'Create vendor credit' }),
      releaseBlanket: t('purchasing.blanketOrders.release', { defaultValue: 'Release to PO' }),
    },
    {
      navigate: workflowSurface.navigate,
      record: workflowSurface.record,
      notify: (notice: TransitionNotice) => {
        if (notice.kind === 'error' && INLINE_ERROR_TRANSITIONS.has(notice.transitionId)) return;
        workflowSurface.notify(notice);
      },
    },
  );

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<WorkflowAction | null>(null);

  const order = useMemo(
    () => (orders as unknown as Row[]).find((row) => String(row.id) === orderId),
    [orders, orderId],
  );
  const lines = useMemo(
    () =>
      (orderLines as unknown as Row[]).filter(
        (line) => String(line.orderId ?? line.order_id ?? '') === orderId,
      ),
    [orderLines, orderId],
  );
  const vendorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts as unknown as Row[]) {
      map.set(String(contact.id), String(contact.name ?? contact.displayName ?? contact.id));
    }
    return map;
  }, [contacts]);

  // Previous / next follow the list's default order: newest first.
  const navigation = useMemo(() => {
    const sorted = [...(orders as unknown as Row[])].sort((a, b) =>
      Number(BigInt(String(b.id)) - BigInt(String(a.id))),
    );
    const index = sorted.findIndex((row) => String(row.id) === orderId);
    if (index === -1) return undefined;
    const link = (row: Row | undefined) =>
      row ? { href: `/purchasing/orders/${String(row.id)}`, label: String(row.name ?? row.id) } : undefined;
    return {
      position: index + 1,
      total: sorted.length,
      previous: link(sorted[index - 1]),
      next: link(sorted[index + 1]),
    };
  }, [orders, orderId]);

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

  const headerActions = useMemo(
    (): WorkflowAction[] => [...workflow.orderActions, workflow.createBill],
    [workflow.orderActions, workflow.createBill],
  );

  const runWorkflowAction = useCallback(
    async (action: WorkflowAction, record: RowValueMap) => {
      if (action.id === 'purchasing.order.create-bill') {
        setBillDialogOpen(true);
        return;
      }
      if (action.kind === 'destructive' || action.kind === 'confirm') {
        setPendingConfirm(action);
        return;
      }
      // The workflow surface reports a typed failure.
      await action.execute(action.prepare?.(record)).catch(() => undefined);
    },
    [],
  );

  if (!order) {
    if (ordersLoading) {
      return (
        <div className="space-y-4" data-testid="purchase-order-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="purchase-order-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('purchasing.order.notFound', { defaultValue: 'Purchase order not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('purchasing.order.notFoundHint', {
              defaultValue: 'It may have been deleted, or belong to another organization.',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('purchasing', 'orders')} />} nativeButton={false}>
            {t('purchasing.order.backToOrders', { defaultValue: 'Back to purchase orders' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const record = order as RowValueMap;
  const label = String(order.name ?? `#${orderId}`);
  const partnerId = order.partnerId ?? order.partner_id;
  const vendor = partnerId != null ? (vendorLabelById.get(String(partnerId)) ?? '') : '';
  const status = purchaseOrderStatusBar(order, t);
  const stateTag = variantTag(order.state);
  const badges = purchaseOrderStatusBadges(t);

  const links = purchaseOrderLinks(
    order as never,
    { organizationId: orgId, companyId: operatingCompanyId },
    stockPickings as never,
    accountMoves as never,
  );
  const linksReady = links.status === 'ready';
  const receiptCount = linksReady ? links.links.filter((link) => link.kind === 'receipt').length : 0;
  const billCount = linksReady ? links.links.filter((link) => link.kind === 'bill').length : 0;

  const detail = purchaseOrderDetailConfig(t);
  const detailConfig = {
    ...detail,
    sections: detail.sections.map((section) =>
      section.id === 'vendor'
        ? {
            ...section,
            fields: section.fields.map((field) =>
              field.key === 'partnerId'
                ? {
                    ...field,
                    render: () =>
                      partnerId == null ? '—' : (vendorLabelById.get(String(partnerId)) ?? `Vendor ${String(partnerId)}`),
                  }
                : field,
            ),
          }
        : section,
    ),
  };
  const linesConfig = purchaseOrderLinesTableConfig(t);

  return (
    <>
      <RecordPage
        testIdPrefix="purchase-order"
        breadcrumbs={[
          { label: t('nav.purchasing', { defaultValue: 'Purchasing' }), href: '/purchasing' },
          {
            label: t('purchasing.purchaseOrders.title'),
            href: buildModuleTabHref('purchasing', 'orders'),
          },
          { label },
        ]}
        title={label}
        subtitle={vendor || undefined}
        badge={
          <Badge variant={(badges.badgeVariants as Record<string, 'default' | 'secondary' | 'outline' | 'destructive'>)[stateTag] ?? 'secondary'}>
            {(badges.badgeLabels as Record<string, string>)[stateTag] ?? stateTag}
          </Badge>
        }
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="purchase-order"
            buttons={[
              {
                id: 'lines',
                label: t('purchasing.orderLines.title'),
                count: lines.length,
                icon: <ListOrdered className="h-4 w-4" />,
                onClick: () => setActiveTab('lines'),
              },
              {
                id: 'receipts',
                label: t('purchasing.order.receipts', { defaultValue: 'Receipts' }),
                count: receiptCount,
                icon: <PackageCheck className="h-4 w-4" />,
                onClick: () => setActiveTab('handoffs'),
                hideWhenZero: true,
              },
              {
                id: 'bills',
                label: t('purchasing.order.bills', { defaultValue: 'Vendor bills' }),
                count: billCount,
                icon: <FileText className="h-4 w-4" />,
                onClick: () => setActiveTab('handoffs'),
                hideWhenZero: true,
              },
            ]}
          />
        }
        actions={
          <RecordWorkflowActions
            actions={headerActions}
            record={record}
            onRun={(action, row) => void runWorkflowAction(action, row)}
            primaryActionIds={PRIMARY_ACTION_IDS}
            pendingActionIds={workflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined}
          />
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={detailConfig} data={order} />,
          },
          {
            id: 'lines',
            label: t('purchasing.orderLines.title'),
            content: (
              <EntityView
                config={{ ...linesConfig, title: '', description: undefined }}
                data={lines}
                useCard={false}
              />
            ),
          },
          {
            id: 'handoffs',
            label: t('purchasing.order.handoffs', { defaultValue: 'Receipts & vendor bills' }),
            content:
              movesLoading || pickingsLoading ? (
                <p>{t('common.loading', { defaultValue: 'Loading…' })}</p>
              ) : (
                <CrossRecordLinks
                  testIdPrefix="purchase-order-handoff"
                  result={
                    movesError || pickingsError
                      ? { status: 'unavailable', links: [], reason: 'Linked records are unavailable' }
                      : links
                  }
                />
              ),
          },
          {
            id: 'discussion',
            label: t('purchasing.order.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="grid gap-6 lg:grid-cols-2" data-testid="purchase-order-discussion">
                <RecordChatter
                  organizationId={organizationId}
                  resModel="purchase_order"
                  resId={BigInt(orderId)}
                  recordTitle={label}
                />
                <RecordDocumentAttachments
                  organizationId={orgId}
                  resModel="purchase_order"
                  resId={BigInt(orderId)}
                  title={t('purchasing.order.attachments', { defaultValue: 'Attachments' })}
                />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="purchase_order" recordId={orderId} />,
          },
        ]}
      />

      {billDialogOpen ? (
        <CreateBillFromPurchaseOrderDialog
          order={order}
          organizationId={organizationId}
          workflow={workflow}
          onClose={() => setBillDialogOpen(false)}
        />
      ) : null}

      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent data-testid="purchase-order-action-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.label}</AlertDialogTitle>
            <AlertDialogDescription>{t('erpWorkflow.confirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingConfirm;
                setPendingConfirm(null);
                if (action) void action.execute(action.prepare?.(record)).catch(() => undefined);
              }}
            >
              {t('erpWorkflow.confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
