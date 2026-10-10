'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, ListOrdered, MoreHorizontal, PackageCheck } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import type { EntityAction, EntityTableConfig } from '@lumiere/ui';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
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
  useComputePurchaseOrderTotals,
  useLockPurchaseOrder,
  usePurchaseOrderLines,
  usePurchaseOrders,
  useRemovePurchaseOrderLine,
  useUnlockPurchaseOrder,
  useUpdatePoInvoiceStatus,
  useUpdatePoReceiptStatus,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@lumiere/query-hooks/hooks/purchasing';
import { usePurchasingWorkflow } from '@lumiere/query-hooks/hooks/purchasing-workflow';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { usePurchasingModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { RecordDocumentAttachments } from '../../../../../components/record-document-attachments';
import { CrossRecordLinks } from '../../../../../components/order-handoff-links';
import {
  CreateBillFromPurchaseOrderDialog,
  PurchaseOrderFormDialog,
  type PurchaseOrderDialogKind,
} from '../../purchase-order-dialogs';
import {
  canAddPurchaseOrderLine,
  canInvoicePurchaseOrderLine,
  canEditPurchaseOrder,
  canLockPurchaseOrder,
  canRemovePurchaseOrderLine,
  canUnlockPurchaseOrder,
  enumTag,
  linesOfOrder,
} from '../../purchase-order-forms';
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
  const [formDialog, setFormDialog] = useState<{ kind: PurchaseOrderDialogKind; line?: Row } | null>(null);
  const lockOrder = useLockPurchaseOrder(orgId);
  const unlockOrder = useUnlockPurchaseOrder(orgId);
  const computeTotals = useComputePurchaseOrderTotals(orgId);
  const refreshReceiptStatus = useUpdatePoReceiptStatus(orgId);
  const refreshInvoiceStatus = useUpdatePoInvoiceStatus(orgId);
  const removeLine = useRemovePurchaseOrderLine(orgId);
  const [pendingConfirm, setPendingConfirm] = useState<WorkflowAction | null>(null);

  const order = useMemo(
    () => (orders as unknown as Row[]).find((row) => String(row.id) === orderId),
    [orders, orderId],
  );
  const lines = useMemo(() => linesOfOrder(orderLines as unknown as Row[], orderId), [orderLines, orderId]);
  const vendorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts as unknown as Row[]) {
      map.set(String(contact.id), String(contact.name ?? contact.displayName ?? contact.id));
    }
    return map;
  }, [contacts]);

  // Previous / next follow the list the record was opened from, else newest first.
  const navigation = useRecordNavigation<Row>({
    rows: orders as unknown as Row[],
    currentId: orderId,
    basePath: '/purchasing/orders',
    labelOf: (row) => String(row.name ?? row.id),
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
  const linesBase = purchaseOrderLinesTableConfig(t);
  const editable = canEditPurchaseOrder(order);
  const report = (error: unknown, title: string) =>
    showWorkflowToast({
      kind: 'error',
      title,
      description: error instanceof Error ? error.message : String(error),
    });
  const receivable = lines.filter((line) => workflow.receiveLine.canPresent(line as RowValueMap));
  const invoiceable = lines.filter(canInvoicePurchaseOrderLine);
  const asRow = (row: unknown) => row as Row;

  const lineActions: EntityAction[] = [
    ...(canAddPurchaseOrderLine(order)
      ? [
          {
            id: 'pol-add-form',
            label: t('purchasing.actions.addLineForm'),
            onClick: () => setFormDialog({ kind: 'addLine' }),
          },
        ]
      : []),
    ...(editable
      ? [
          {
            id: 'pol-edit-form',
            label: t('purchasing.actions.editLineForm'),
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && enumTag(rows[0]?.state) === 'Draft',
            onClick: (rows) => setFormDialog({ kind: 'editLine', line: asRow(rows[0]) }),
          } satisfies EntityAction,
        ]
      : []),
    ...(receivable.length > 0
      ? [
          {
            id: 'pol-receive-form',
            label: t('purchasing.actions.receiveGoodsForm'),
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && workflow.receiveLine.canPresent(rows[0] as RowValueMap),
            onClick: (rows) => setFormDialog({ kind: 'receive', line: asRow(rows[0]) }),
          } satisfies EntityAction,
          {
            id: 'pol-receive-qty',
            label: t('purchasing.actions.receiveFullOpenQty'),
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && workflow.receiveLine.canPresent(rows[0] as RowValueMap),
            onClick: async (rows) => {
              const line = rows[0] as RowValueMap | undefined;
              if (!line || !workflow.receiveLine.prepare) return;
              // The workflow surface reports a typed failure.
              await workflow.receiveLine.execute(workflow.receiveLine.prepare(line), { navigateToNext: true }).catch(() => undefined);
            },
          } satisfies EntityAction,
        ]
      : []),
    ...(invoiceable.length > 0
      ? [
          {
            id: 'pol-invoice-form',
            label: t('purchasing.actions.invoiceQtyForm'),
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && canInvoicePurchaseOrderLine(rows[0] as Row),
            onClick: (rows) => setFormDialog({ kind: 'invoiceLine', line: asRow(rows[0]) }),
          } satisfies EntityAction,
        ]
      : []),
    ...(canRemovePurchaseOrderLine(order)
      ? [
          {
            id: 'pol-remove',
            label: t('common.delete'),
            requiresSelection: true,
            selection: 'multiple',
            variant: 'destructive',
            confirm: {
              title: t('purchasing.order.removeLinesTitle', { defaultValue: 'Remove the selected lines?' }),
              description: t('purchasing.order.removeLinesDescription', {
                defaultValue: 'The lines are deleted from this order and its totals are recomputed.',
              }),
              confirmLabel: t('common.delete'),
              cancelLabel: t('erpWorkflow.confirm.dismiss'),
            },
            successMessage: t('common.actionCompleted', { action: t('common.delete') }),
            onClick: async (rows) => {
              for (const row of rows) await removeLine.mutateAsync(row.id as string | number | bigint);
            },
          } satisfies EntityAction,
        ]
      : []),
  ];
  const linesView = linesBase.view as EntityTableConfig;
  const linesConfig = { ...linesBase, view: { ...linesView, actions: [...(linesView.actions ?? []), ...lineActions] } };

  const moreActions: Array<{ id: string; label: string; show: boolean; run: () => Promise<unknown> }> = [
    {
      id: 'recalc',
      label: t('purchasing.actions.recalculateTotals'),
      show: true,
      run: () => computeTotals.mutateAsync(orderId),
    },
    {
      id: 'refresh-receipt-status',
      label: t('purchasing.actions.refreshReceiptStatus'),
      show: true,
      run: () => refreshReceiptStatus.mutateAsync(orderId),
    },
    {
      id: 'refresh-invoice-status',
      label: t('purchasing.actions.refreshInvoiceStatus'),
      show: true,
      run: () => refreshInvoiceStatus.mutateAsync(orderId),
    },
    {
      id: 'lock',
      label: t('purchasing.actions.lockSelected'),
      show: canLockPurchaseOrder(order),
      run: () => lockOrder.mutateAsync(orderId),
    },
    {
      id: 'unlock',
      label: t('purchasing.actions.unlockSelected'),
      show: canUnlockPurchaseOrder(order),
      run: () => unlockOrder.mutateAsync(orderId),
    },
  ].filter((action) => action.show);

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
          <div className="flex flex-wrap items-center gap-2">
            <RecordWorkflowActions
              actions={headerActions}
              record={record}
              onRun={(action, row) => void runWorkflowAction(action, row)}
              primaryActionIds={PRIMARY_ACTION_IDS}
              pendingActionIds={workflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined}
            />
            {receivable.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="purchase-order-receive-goods"
                onClick={() => setFormDialog({ kind: 'receive' })}
              >
                <PackageCheck className="mr-1 h-4 w-4" />
                {t('purchasing.actions.receiveGoodsForm')}
              </Button>
            ) : null}
            {editable ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="purchase-order-edit-header"
                onClick={() => setFormDialog({ kind: 'header' })}
              >
                {t('purchasing.actions.editHeader', { defaultValue: 'Edit header' })}
              </Button>
            ) : null}
            {moreActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="purchase-order-more-actions">
                    <MoreHorizontal className="mr-1 h-4 w-4" />
                    {t('purchasing.order.moreActions', { defaultValue: 'More' })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moreActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      data-testid={`purchase-order-action-${action.id}`}
                      onSelect={() => {
                        void Promise.resolve(action.run()).catch((error: unknown) => report(error, action.label));
                      }}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
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

      {formDialog ? (
        <PurchaseOrderFormDialog
          kind={formDialog.kind}
          order={order}
          lines={lines}
          line={formDialog.line}
          organizationId={organizationId}
          operatingCompanyId={operatingCompanyId}
          workflow={workflow}
          onClose={() => setFormDialog(null)}
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
