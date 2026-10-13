'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { RecordHeaderActions } from '../../../../../components/record-header-actions';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
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
  manufacturingOrdersTableConfig,
  workordersTableConfig,
} from '@lumiere/ui';
import type { EntityAction, EntityTableConfig } from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { useConfirmDialog } from '@lumiere/ui/hooks/use-confirm-dialog';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import {
  useCancelManufacturingOrder,
  useConfirmManufacturingOrder,
  useConsumeMoMaterials,
  useFinishManufacturingOrder,
  useManufacturingMutations,
  useMrpProductions,
  useMrpWorkcenters,
  useMrpWorkorders,
  useProduceManufacturingOrder,
  useQualityChecks,
  useStartManufacturingOrder,
  type MrpProduction,
  type MrpWorkcenter,
  type MrpWorkorder,
} from '@lumiere/query-hooks/hooks/manufacturing';
import { useFinishWorkorder, useStartWorkorder } from '@lumiere/query-hooks/hooks/manufacturing-workorder-execution';
import { useProducts } from '@lumiere/query-hooks/hooks/inventory';
import { useIotDevices } from '@lumiere/query-hooks/hooks/iot';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import type { Product } from '@lumiere/stdb/types';
import { productRowsToSelectOptions } from '@/lib/form-lookup';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useManufacturingModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { ManufacturingRowDialog } from '../../manufacturing-row-dialog';
import {
  canCancelOrder,
  canConfirmOrder,
  canConsumeMaterials,
  canFinishOrder,
  canFinishWorkorder,
  canProduceOrder,
  canStartOrder,
  canStartWorkorder,
  parseProduceQty,
  remainingQty,
} from '../../manufacturing-order-actions';
import { manufacturingOrderStatusBar, producedPercent, workordersOfOrder } from '../../manufacturing-order';

interface ManufacturingOrderPageClientProps {
  orderId: string;
  initialProductions?: MrpProduction[];
  initialWorkorders?: MrpWorkorder[];
  initialWorkcenters?: MrpWorkcenter[];
  initialProducts?: Product[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'workorders', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function ManufacturingOrderPageClient(props: ManufacturingOrderPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <ManufacturingOrderPageLoaded {...props} organizationId={props.organizationId} />;
}

function ManufacturingOrderPageLoaded({
  orderId,
  initialProductions,
  initialWorkorders,
  initialWorkcenters,
  initialProducts,
  organizationId,
}: ManufacturingOrderPageClientProps & { organizationId: number }) {
  useManufacturingModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: productions = [], isLoading } = useMrpProductions(orgId, initialProductions);
  const { data: workorders = [] } = useMrpWorkorders(orgId, initialWorkorders);
  const { data: workcenters = [] } = useMrpWorkcenters(orgId, initialWorkcenters);
  const iotDevicesQuery = useIotDevices(orgId);
  const { data: qualityChecks = [] } = useQualityChecks(orgId);
  const { data: products = [] } = useProducts(orgId, initialProducts);
  const mutations = useManufacturingMutations(orgId, operatingCompanyId);
  const confirmMo = useConfirmManufacturingOrder(orgId, operatingCompanyId);
  const startMo = useStartManufacturingOrder(orgId, operatingCompanyId);
  const consumeMaterials = useConsumeMoMaterials(orgId, operatingCompanyId);
  const produceMo = useProduceManufacturingOrder(orgId, operatingCompanyId);
  const finishMo = useFinishManufacturingOrder(orgId, operatingCompanyId);
  const cancelMo = useCancelManufacturingOrder(orgId, operatingCompanyId);
  const startWorkorder = useStartWorkorder(orgId, operatingCompanyId);
  const finishWorkorder = useFinishWorkorder(orgId, operatingCompanyId);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const { askForm, formDialog } = useFormDialog();

  const [actionsOpen, setActionsOpen] = useState(false);

  const order = useMemo((): Row | undefined => {
    const row = (productions as unknown as Row[]).find((candidate) => String(candidate.id) === orderId);
    if (!row) return undefined;
    const product = (products as unknown as Row[]).find((candidate) => String(candidate.id) === String(row.productId));
    return { ...row, productName: String(product?.name ?? row.productId ?? '—') };
  }, [productions, products, orderId]);
  const ownWorkorders = useMemo(() => workordersOfOrder(workorders as unknown as Row[], orderId), [workorders, orderId]);
  const productOptions = useMemo(() => productRowsToSelectOptions(products as unknown as Row[]), [products]);

  const navigation = useRecordNavigation<Row>({
    rows: productions as unknown as Row[],
    currentId: orderId,
    basePath: '/manufacturing/orders',
    labelOf: (row) => String(row.name || row.id),
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

  if (!order) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="manufacturing-order-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="manufacturing-order-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('manufacturing.page.notFound', { defaultValue: 'Manufacturing order not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('manufacturing.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('manufacturing', 'orders')} />} nativeButton={false}>
            {t('manufacturing.page.backToOrders', { defaultValue: 'Back to manufacturing orders' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(orderId);
  const label = String(order.name || '').trim() || `#${orderId}`;
  const status = manufacturingOrderStatusBar(order, t);
  const percent = producedPercent(order);
  const table = manufacturingOrdersTableConfig(t);
  const columns = table.view.mode === 'table' ? table.view.columns : [];
  const detailConfig = {
    mode: 'detail' as const,
    sections: [{ id: 'order', fields: columns.filter((column) => column.key !== 'name').map(({ width: _width, ...field }) => field) }],
  };
  const iotReferenceStatus = iotDevicesQuery.status === 'success' ? undefined : iotDevicesQuery.status === 'error' ? 'Unavailable' : 'Loading';

  const busy =
    confirmMo.isPending ||
    startMo.isPending ||
    consumeMaterials.isPending ||
    produceMo.isPending ||
    finishMo.isPending ||
    cancelMo.isPending;

  /** Run one lifecycle command; the reducer re-validates, so failures surface as an error toast. */
  const runAction = async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
      showWorkflowToast({ kind: 'success', title: t('manufacturing.page.actionDone', { defaultValue: '{{action}} completed', action: title }) });
    } catch (error) {
      showWorkflowToast({
        kind: 'error',
        title: t('manufacturing.page.actionFailed', { defaultValue: '{{action}} failed', action: title }),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const confirmThenRun = async (title: string, description: string, work: () => Promise<unknown>) => {
    if (!(await confirmAction({ title, description }))) return;
    await runAction(title, work);
  };

  const confirmLabel = t('manufacturing.page.actions.confirm', { defaultValue: 'Confirm' });
  const startLabel = t('manufacturing.page.actions.start', { defaultValue: 'Start' });
  const consumeLabel = t('manufacturing.page.actions.consume', { defaultValue: 'Consume materials' });
  const produceLabel = t('manufacturing.page.actions.produce', { defaultValue: 'Record output' });
  const finishLabel = t('manufacturing.page.actions.finish', { defaultValue: 'Finish' });
  const cancelLabel = t('manufacturing.page.actions.cancel', { defaultValue: 'Cancel order' });

  const produce = async () => {
    const remaining = remainingQty(order);
    const values = await askForm({
      title: produceLabel,
      description: t('manufacturing.page.actions.produceHint', {
        defaultValue: 'Quantity produced now. {{remaining}} remaining.',
        remaining,
      }),
      fields: [
        {
          id: 'qty',
          name: 'qty',
          label: t('manufacturing.page.actions.produceQty', { defaultValue: 'Quantity produced' }),
          type: 'number',
          required: true,
          defaultValue: remaining,
        },
      ],
    });
    if (!values) return;
    const qty = parseProduceQty(values.qty, order);
    if (qty == null) {
      showWorkflowToast({
        kind: 'error',
        title: t('manufacturing.page.actionFailed', { defaultValue: '{{action}} failed', action: produceLabel }),
        description: t('manufacturing.page.actions.produceInvalid', {
          defaultValue: 'Enter a quantity above 0 and no more than the {{remaining}} remaining.',
          remaining,
        }),
      });
      return;
    }
    await runAction(produceLabel, () => produceMo.mutateAsync({ moId: id, qty }));
  };

  const workorderActions: EntityAction[] = [
    {
      id: 'workorder-start',
      label: t('manufacturing.page.workorderActions.start', { defaultValue: 'Start work order' }),
      requiresSelection: true,
      isApplicable: (rows) => rows.length === 1 && canStartWorkorder(rows[0] as Row, order, ownWorkorders),
      onClick: (rows) =>
        runAction(t('manufacturing.page.workorderActions.start', { defaultValue: 'Start work order' }), () =>
          startWorkorder.mutateAsync(BigInt(String((rows[0] as Row).id))),
        ),
    },
    {
      id: 'workorder-finish',
      label: t('manufacturing.page.workorderActions.finish', { defaultValue: 'Finish work order' }),
      requiresSelection: true,
      isApplicable: (rows) => rows.length === 1 && canFinishWorkorder(rows[0] as Row, order),
      onClick: async (rows) => {
        const title = t('manufacturing.page.workorderActions.finish', { defaultValue: 'Finish work order' });
        await confirmThenRun(
          title,
          t('manufacturing.page.workorderActions.finishConfirm', {
            defaultValue: 'Stop the clock and mark this work order done. Open quality checks must already pass.',
          }),
          () => finishWorkorder.mutateAsync(BigInt(String((rows[0] as Row).id))),
        );
      },
    },
  ];
  const workordersBase = workordersTableConfig(t);
  const workordersView = workordersBase.view as EntityTableConfig;
  const workordersConfig = {
    ...workordersBase,
    title: '',
    description: undefined,
    view: { ...workordersView, actions: [...(workordersView.actions ?? []), ...workorderActions] },
  };

  return (
    <>
      <RecordPage
        testIdPrefix="manufacturing-order"
        breadcrumbs={[
          { label: t('nav.manufacturing', { defaultValue: 'Manufacturing' }), href: '/manufacturing' },
          { label: t('manufacturing.manufacturingOrders.title'), href: buildModuleTabHref('manufacturing', 'orders') },
          { label },
        ]}
        title={label}
        subtitle={[String(order.productName ?? ''), percent != null ? `${percent}% ${t('manufacturing.page.produced', { defaultValue: 'produced' })}` : '']
          .filter(Boolean)
          .join(' · ')}
        badge={
          <Badge variant={status.terminal ? 'destructive' : 'secondary'}>
            {status.terminal?.label ?? status.steps.find((step) => step.id === status.current)?.label ?? ''}
          </Badge>
        }
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="manufacturing-order"
            buttons={[
              {
                id: 'workorders',
                label: t('manufacturing.workOrders.title', { defaultValue: 'Work orders' }),
                count: ownWorkorders.length,
                icon: <ClipboardList className="h-4 w-4" />,
                onClick: () => setActiveTab('workorders'),
              },
            ]}
          />
        }
        actions={
          <>
          {canConfirmOrder(order) ? (
            <Button size="sm" disabled={busy} data-testid="manufacturing-order-confirm" onClick={() => void runAction(confirmLabel, () => confirmMo.mutateAsync(id))}>
              {confirmLabel}
            </Button>
          ) : null}
          {canStartOrder(order) ? (
            <Button size="sm" disabled={busy} data-testid="manufacturing-order-start" onClick={() => void runAction(startLabel, () => startMo.mutateAsync(id))}>
              {startLabel}
            </Button>
          ) : null}
          {canProduceOrder(order) ? (
            <Button size="sm" disabled={busy} data-testid="manufacturing-order-produce" onClick={() => void produce()}>
              {produceLabel}
            </Button>
          ) : null}
          {canFinishOrder(order) ? (
            <Button size="sm" disabled={busy} data-testid="manufacturing-order-finish" onClick={() => void runAction(finishLabel, () => finishMo.mutateAsync(id))}>
              {finishLabel}
            </Button>
          ) : null}
          {canConsumeMaterials(order) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              data-testid="manufacturing-order-consume"
              onClick={() =>
                void confirmThenRun(
                  consumeLabel,
                  t('manufacturing.page.actions.consumeConfirm', { defaultValue: 'Consume the bill-of-materials components for this order from stock.' }),
                  () => consumeMaterials.mutateAsync(id),
                )
              }
            >
              {consumeLabel}
            </Button>
          ) : null}
          {canCancelOrder(order) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              data-testid="manufacturing-order-cancel"
              onClick={() =>
                void confirmThenRun(
                  cancelLabel,
                  t('manufacturing.page.actions.cancelConfirm', { defaultValue: 'Cancel this manufacturing order? A done order cannot be cancelled.' }),
                  () => cancelMo.mutateAsync(id),
                )
              }
            >
              {cancelLabel}
            </Button>
          ) : null}
          <RecordHeaderActions model="manufacturing" record={order} organizationId={orgId} companyId={operatingCompanyId ?? undefined} />
          <Button size="sm" data-testid="manufacturing-order-actions" onClick={() => setActionsOpen(true)}>
            {t('manufacturing.rowActions.titleOrder')}
          </Button>
          </>
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
            id: 'workorders',
            label: t('manufacturing.workOrders.title', { defaultValue: 'Work orders' }),
            content: (
              <EntityView config={workordersConfig} data={ownWorkorders} useCard={false} />
            ),
          },
          {
            id: 'discussion',
            label: t('manufacturing.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="manufacturing-order-discussion">
                <RecordChatter organizationId={organizationId} resModel="mrp_production" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="mrp_production" recordId={orderId} />,
          },
        ]}
      />

      {confirmDialog}
      {formDialog}
      <ManufacturingRowDialog
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        tabId="orders"
        row={order}
        workcenters={workcenters as never}
        iotDevices={(iotDevicesQuery.data ?? []) as never}
        iotReferenceStatus={iotReferenceStatus}
        qualityChecks={qualityChecks}
        productOptions={productOptions}
        mutations={mutations}
        t={t}
      />
    </>
  );
}
