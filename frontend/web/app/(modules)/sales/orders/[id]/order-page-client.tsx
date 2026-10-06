'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  EntityDetail,
  EmptyContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  EntityView,
  MissingOrganization,
  RecordAuditTab,
  RecordPage,
  RecordWorkflowActions,
  StatusBar,
  buildModuleTabHref,
  saleOrderLinesTableConfig,
  useFormDialog,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import {
  isSaleOrderConfirmed,
  saleOrderState,
  type AnyWorkflowAction,
  type RowValueMap,
  type TransitionNotice,
} from '@lumiere/erp-workflows';
import { saleOrderPrimaryLabel } from '@lumiere/stdb/read-models';
import type { StockPicking } from '@lumiere/stdb/types';
import { useAccountMoves } from '@lumiere/query-hooks/hooks/accounting';
import { useContacts, type Contact } from '@lumiere/query-hooks/hooks/crm';
import { useCreateDocument } from '@lumiere/query-hooks/hooks/documents';
import { useStockPickings } from '@lumiere/query-hooks/hooks/inventory';
import { orderHandoffs } from '@lumiere/query-hooks/hooks/order-to-cash';
import {
  useAccrueSaleCommission,
  useApplyOmnichannelAllocation,
  useApplySaleOrderOptions,
  useApplySalePromotion,
  useSaleOrderLines,
  useSaleOrders,
  type SaleOrder,
  type SaleOrderLine,
} from '@lumiere/query-hooks/hooks/sales';
import { useSaleOrderWorkflow } from '@lumiere/query-hooks/hooks/sales-order-workflow';
import { downloadDocumentPdf } from '@lumiere/query-hooks/hooks/templates';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { archiveRenderedPdfAsDocument } from '@/lib/archive-document-pdf';
import { useSalesModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { phCapture } from '@/lib/posthog-browser';
import { OrderHandoffLinks } from '../../../../../components/order-handoff-links';
import { CreateInvoiceFromOrderDialog, EditSaleOrderDialog } from '../../sale-order-dialogs';
import {
  downloadCommercialPacket,
  linesOfOrder,
  saleOrderDetailWithPartners,
} from '../../sale-order-record';
import { saleOrderStatusBar } from '../../sale-order-status';
import { parseCommissionRatePercent } from '../../sales-ops-panel';

interface SaleOrderPageClientProps {
  orderId: string;
  initialOrders?: SaleOrder[];
  initialOrderLines?: SaleOrderLine[];
  initialStockPickings?: StockPicking[];
  initialContacts?: Contact[];
  organizationId?: number;
}

type OrderRow = Record<string, unknown>;
type WorkflowAction = AnyWorkflowAction<RowValueMap>;

/** These render their own failure inline in their dialog, so the toast stays quiet. */
const INLINE_ERROR_TRANSITIONS: ReadonlySet<string> = new Set([
  'sales.order.create-invoice',
  'sales.order.update',
]);

const PRIMARY_ACTION_IDS: ReadonlySet<string> = new Set([
  'sales.order.confirm',
  'sales.order.send-quotation',
  'sales.order.create-invoice',
]);

const TAB_IDS = ['overview', 'lines', 'handoffs', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function SaleOrderPageClient(props: SaleOrderPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <SaleOrderPageLoaded {...props} organizationId={props.organizationId} />;
}

function SaleOrderPageLoaded({
  orderId,
  initialOrders,
  initialOrderLines,
  initialStockPickings,
  initialContacts,
  organizationId,
}: SaleOrderPageClientProps & { organizationId: number }) {
  useSalesModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { askForm, formDialog } = useFormDialog();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: orders = [], isLoading: ordersLoading } = useSaleOrders(orgId, initialOrders);
  const { data: orderLines = [] } = useSaleOrderLines(orgId, initialOrderLines);
  const { data: stockPickings = [] } = useStockPickings(orgId, initialStockPickings);
  const { data: accountMoves = [] } = useAccountMoves(orgId);
  const { data: contacts = [] } = useContacts(orgId, initialContacts);

  const applySalePromotion = useApplySalePromotion(orgId);
  const applySaleOrderOptions = useApplySaleOrderOptions(orgId);
  const accrueSaleCommission = useAccrueSaleCommission(orgId);
  const applyOmnichannelAllocation = useApplyOmnichannelAllocation(orgId, operatingCompanyId);
  const createDocument = useCreateDocument(orgId, operatingCompanyId);

  const workflowSurface = useWorkflowSurface({ organizationId });
  const saleOrderWorkflow = useSaleOrderWorkflow(
    orgId,
    operatingCompanyId,
    {
      confirm: t('sales.actions.confirmSelected'),
      createInvoice: t('sales.actions.createInvoice'),
      sendQuotation: t('sales.actions.sendQuotation'),
      acceptQuotation: t('sales.actions.acceptQuotation', { defaultValue: 'Accept quotation' }),
      cancel: t('sales.actions.cancelOrders'),
      recalculateTotals: t('sales.actions.recalculateTotals'),
      lock: t('sales.actions.lockOrders'),
      unlock: t('sales.actions.unlockOrders'),
      edit: t('sales.actions.editOrder'),
    },
    {
      navigate: workflowSurface.navigate,
      record: workflowSurface.record,
      notify: (notice: TransitionNotice) => {
        if (notice.kind === 'error' && INLINE_ERROR_TRANSITIONS.has(notice.transitionId)) return;
        workflowSurface.notify(notice);
        if (notice.kind === 'success' && notice.transitionId === 'sales.order.confirm') {
          phCapture('sale_order_confirmed', { organization_id: organizationId });
        }
        if (notice.kind === 'success' && notice.transitionId === 'sales.order.cancel') {
          phCapture('sale_order_cancelled', { organization_id: organizationId });
        }
      },
    },
  );

  const [dialog, setDialog] = useState<'invoice' | 'edit' | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<WorkflowAction | null>(null);

  const order = useMemo(
    () => (orders as unknown as OrderRow[]).find((row) => String(row.id) === orderId),
    [orders, orderId],
  );
  const lines = useMemo(
    () => linesOfOrder(orderLines as unknown as OrderRow[], orderId),
    [orderLines, orderId],
  );
  const partnerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts as unknown as OrderRow[]) {
      map.set(String(contact.id), String(contact.name ?? contact.displayName ?? contact.id));
    }
    return map;
  }, [contacts]);

  // Previous / next follow the list's default order: newest first.
  const navigation = useMemo(() => {
    const ids = [...(orders as unknown as OrderRow[])].sort((a, b) =>
      Number(BigInt(String(b.id)) - BigInt(String(a.id))),
    );
    const index = ids.findIndex((row) => String(row.id) === orderId);
    if (index === -1) return undefined;
    const link = (row: OrderRow | undefined) =>
      row
        ? { href: `/sales/orders/${String(row.id)}`, label: saleOrderPrimaryLabel(row as never) || String(row.id) }
        : undefined;
    return {
      position: index + 1,
      total: ids.length,
      previous: link(ids[index - 1]),
      next: link(ids[index + 1]),
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

  const report = useCallback((error: unknown, title: string) => {
    showWorkflowToast({
      kind: 'error',
      title,
      description: error instanceof Error ? error.message : String(error),
    });
  }, []);

  const headerActions = useMemo(
    (): WorkflowAction[] => [
      ...saleOrderWorkflow.actions.filter((action) => action.id !== 'sales.order.create-invoice'),
      saleOrderWorkflow.acceptQuotation,
      saleOrderWorkflow.createInvoice,
      saleOrderWorkflow.update,
      saleOrderWorkflow.lock,
      saleOrderWorkflow.unlock,
      saleOrderWorkflow.totals,
      saleOrderWorkflow.cancel,
    ],
    [saleOrderWorkflow],
  );

  const runWorkflowAction = useCallback(
    async (action: WorkflowAction, record: RowValueMap) => {
      switch (action.id) {
        case 'sales.order.create-invoice':
          setDialog('invoice');
          return;
        case 'sales.order.update':
          setDialog('edit');
          return;
        case 'sales.order.accept-quotation': {
          const values = await askForm({
            title: action.label,
            fields: [
              {
                id: 'signedBy',
                name: 'signedBy',
                label: t('sales.actions.acceptQuotationPrompt', { defaultValue: 'Accepted by (name)' }),
                type: 'text',
                required: true,
              },
            ],
          });
          const signedBy = typeof values?.signedBy === 'string' ? values.signedBy.trim() : '';
          if (!signedBy) return;
          // The workflow surface reports a typed failure.
          await saleOrderWorkflow.acceptQuotation.execute({ orderId, signedBy }).catch(() => undefined);
          return;
        }
      }
      if (action.kind === 'destructive' || action.kind === 'confirm') {
        setPendingConfirm(action);
        return;
      }
      await action.execute(action.prepare?.(record)).catch(() => undefined);
    },
    [askForm, orderId, saleOrderWorkflow, t],
  );

  if (!order) {
    if (ordersLoading) {
      return (
        <div className="space-y-4" data-testid="sale-order-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="sale-order-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('sales.order.notFound', { defaultValue: 'Order not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('sales.order.notFoundHint', {
              defaultValue: 'It may have been deleted, or belong to another organization.',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('sales', 'orders')} />} nativeButton={false}>
            {t('sales.order.backToOrders', { defaultValue: 'Back to orders' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const record = order as RowValueMap;
  const state = saleOrderState(record);
  const label = saleOrderPrimaryLabel(order as never) || String(order.reference ?? `#${orderId}`);
  const partnerId = order.partnerId ?? order.partner_id;
  const customer =
    String(order.partnerName ?? order.partner_name ?? '').trim() ||
    (partnerId != null ? (partnerLabelById.get(String(partnerId)) ?? '') : '');
  const status = saleOrderStatusBar(order, t);
  const editable = state === 'Draft' || state === 'Sent';
  const rate = parseCommissionRatePercent(order);

  const moreActions: Array<{ id: string; label: string; show: boolean; run: () => Promise<void> | void }> = [
    {
      id: 'view-deliveries',
      label: t('sales.actions.viewDeliveries'),
      show: isSaleOrderConfirmed(record),
      run: () => router.push(buildModuleTabHref('sales', 'fulfillment', { saleId: orderId })),
    },
    {
      id: 'apply-promotion',
      label: t('sales.actions.applyPromotion', { defaultValue: 'Apply promotion' }),
      show: editable,
      run: async () => {
        const values = await askForm({
          title: t('sales.actions.applyPromotion', { defaultValue: 'Apply promotion' }),
          fields: [
            {
              id: 'code',
              name: 'code',
              label: t('sales.actions.applyPromotionPrompt', { defaultValue: 'Promotion code' }),
              type: 'text',
              required: true,
            },
          ],
        });
        const code = typeof values?.code === 'string' ? values.code.trim() : '';
        if (!code) return;
        await applySalePromotion.mutateAsync({ orderId: order.id as string | number | bigint, promotionCode: code });
      },
    },
    {
      id: 'apply-options',
      label: t('sales.actions.applyOptions', { defaultValue: 'Apply CPQ options' }),
      show: editable,
      run: async () => {
        await applySaleOrderOptions.mutateAsync(order.id as string | number | bigint);
      },
    },
    {
      id: 'apply-omnichannel',
      label: t('sales.actions.applyOmnichannel', { defaultValue: 'Apply omnichannel allocation' }),
      show: true,
      run: async () => {
        const values = await askForm({
          title: t('sales.actions.applyOmnichannel', { defaultValue: 'Apply omnichannel allocation' }),
          fields: [
            {
              id: 'channel',
              name: 'channel',
              label: t('sales.actions.omnichannelChannelPrompt', {
                defaultValue: 'Channel (optional, e.g. web, store)',
              }),
              type: 'text',
            },
            {
              id: 'route',
              name: 'route',
              label: t('sales.actions.omnichannelRoutePrompt', { defaultValue: 'Preferred route id (optional)' }),
              type: 'number',
              min: 1,
            },
          ],
        });
        if (!values) return;
        const channel = typeof values.channel === 'string' && values.channel.trim() ? values.channel.trim() : undefined;
        const route = values.route === '' || values.route == null ? undefined : BigInt(String(values.route));
        await applyOmnichannelAllocation.mutateAsync({
          orderId: order.id as string | number | bigint,
          params: { preferredRouteId: route, channel, metadata: undefined },
        });
      },
    },
    {
      id: 'accrue-commission',
      label: t('sales.actions.accrueCommission', { defaultValue: 'Accrue commission' }),
      show: (state === 'Sale' || state === 'Done') && rate > 0,
      run: async () => {
        await accrueSaleCommission.mutateAsync({
          orderId: order.id as string | number | bigint,
          ratePercent: rate,
        });
      },
    },
    {
      id: 'download-pdf',
      label: t('sales.actions.downloadPdf', { defaultValue: 'Download PDF' }),
      show: true,
      run: async () => {
        await downloadDocumentPdf('sale-order', Number(orderId));
      },
    },
    {
      id: 'archive-pdf-dms',
      label: t('sales.actions.archivePdfToDocuments', { defaultValue: 'Archive PDF to Documents' }),
      show: true,
      run: async () => {
        const params = await archiveRenderedPdfAsDocument({
          kind: 'sale-order',
          recordId: Number(orderId),
          companyId: operatingCompanyId,
          name: String(order.name ?? `Sale order ${orderId}`),
        });
        await createDocument.mutateAsync(params);
      },
    },
    {
      id: 'export-commercial-packet',
      label: t('sales.actions.exportCommercialPacket', { defaultValue: 'Export commercial packet' }),
      show: true,
      run: () => downloadCommercialPacket(order, lines),
    },
  ].filter((action) => action.show);

  const linesConfig = saleOrderLinesTableConfig(t);

  return (
    <>
      <RecordPage
        testIdPrefix="sale-order"
        breadcrumbs={[
          { label: t('nav.sales'), href: '/sales' },
          { label: t('sales.salesOrders.title'), href: buildModuleTabHref('sales', 'orders') },
          { label },
        ]}
        title={label}
        subtitle={customer || undefined}
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        actions={
          <>
            <RecordWorkflowActions
              actions={headerActions}
              record={record}
              onRun={(action, row) => void runWorkflowAction(action, row)}
              primaryActionIds={PRIMARY_ACTION_IDS}
              pendingActionIds={
                saleOrderWorkflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined
              }
            />
            {moreActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="sale-order-more-actions">
                    <MoreHorizontal className="mr-1 h-4 w-4" />
                    {t('sales.order.moreActions', { defaultValue: 'More' })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moreActions.map((action, index) => (
                    <div key={action.id}>
                      {index === moreActions.length - 3 && index > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem
                        data-testid={`sale-order-action-${action.id}`}
                        onSelect={() => {
                          void Promise.resolve(action.run()).catch((error: unknown) => report(error, action.label));
                        }}
                      >
                        {action.label}
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
            content: (
              <EntityDetail config={saleOrderDetailWithPartners(t, partnerLabelById)} data={order} />
            ),
          },
          {
            id: 'lines',
            label: t('sales.orderLines.title'),
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
            label: t('sales.order.handoffs', { defaultValue: 'Deliveries & invoices' }),
            content: (
              <div data-testid="sale-order-handoffs">
                <OrderHandoffLinks
                  testIdPrefix="sale-order-handoff"
                  handoffs={orderHandoffs(
                    BigInt(orderId),
                    { organizationId: orgId, companyId: operatingCompanyId },
                    stockPickings as never,
                    accountMoves as never,
                  )}
                />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="sale_order" recordId={orderId} />,
          },
        ]}
      />

      {dialog === 'invoice' ? (
        <CreateInvoiceFromOrderDialog
          order={order}
          organizationId={organizationId}
          workflow={saleOrderWorkflow}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'edit' ? (
        <EditSaleOrderDialog
          order={order}
          organizationId={organizationId}
          operatingCompanyId={operatingCompanyId}
          workflow={saleOrderWorkflow}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {formDialog}

      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent data-testid="sale-order-action-confirm">
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
