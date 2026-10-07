'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { RecordHeaderActions } from '../../../../../components/record-header-actions';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, ListOrdered, ShoppingCart } from 'lucide-react';
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
  stockMovesTableConfig,
  transferDetailConfig,
  transfersTableConfig,
  transferStatusBadges,
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
import { variantTag, type AnyWorkflowAction, type RowValueMap } from '@lumiere/erp-workflows';
import type { StockLocation, StockMove, StockPicking } from '@lumiere/stdb/types';
import { useStockLocations, useStockMoves, useStockPickings } from '@lumiere/query-hooks/hooks/inventory';
import { usePickingWorkflow } from '@lumiere/query-hooks/hooks/picking-workflow';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useInventoryModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { RecordDocumentAttachments } from '../../../../../components/record-document-attachments';
import { transferBackorders } from '../../transfer-record';
import { transferStatusBar } from '../../transfer-status';

interface TransferPageClientProps {
  transferId: string;
  initialPickings?: StockPicking[];
  initialMoves?: StockMove[];
  initialLocations?: StockLocation[];
  organizationId?: number;
}

type Row = Record<string, unknown>;
type WorkflowAction = AnyWorkflowAction<RowValueMap>;

const PRIMARY_ACTION_IDS: ReadonlySet<string> = new Set([
  'inventory.picking.validate',
  'inventory.picking.assign',
  'inventory.picking.confirm',
]);

const TAB_IDS = ['overview', 'moves', 'backorders', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function TransferPageClient(props: TransferPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <TransferPageLoaded {...props} organizationId={props.organizationId} />;
}

function TransferPageLoaded({
  transferId,
  initialPickings,
  initialMoves,
  initialLocations,
  organizationId,
}: TransferPageClientProps & { organizationId: number }) {
  useInventoryModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: pickings = [], isLoading: pickingsLoading } = useStockPickings(orgId, initialPickings);
  const { data: moves = [] } = useStockMoves(orgId, initialMoves);
  const { data: locations = [] } = useStockLocations(orgId, initialLocations);

  const workflowSurface = useWorkflowSurface({ organizationId });
  const workflow = usePickingWorkflow(
    orgId,
    operatingCompanyId,
    {
      confirm: t('inventory.transferActions.confirm'),
      assign: t('inventory.transferActions.assign'),
      validate: t('inventory.transferActions.validate'),
      // Partial delivery is a Sales fulfillment form; the page validates in full, packs or cancels.
      partialValidate: t('sales.fulfillment.actions.partialValidate'),
      pack: t('sales.fulfillment.actions.pack'),
      cancel: t('inventory.transferActions.cancel'),
    },
    { navigate: workflowSurface.navigate, record: workflowSurface.record, notify: workflowSurface.notify },
  );

  const [pendingConfirm, setPendingConfirm] = useState<WorkflowAction | null>(null);

  const transfer = useMemo(
    () => (pickings as unknown as Row[]).find((row) => String(row.id) === transferId),
    [pickings, transferId],
  );
  const transferMoves = useMemo(
    () => (moves as unknown as Row[]).filter((move) => String(move.pickingId ?? move.picking_id) === transferId),
    [moves, transferId],
  );
  const backorders = useMemo(
    () => transferBackorders(transfer ?? {}, pickings as unknown as Row[]),
    [transfer, pickings],
  );
  const locationLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of locations as unknown as Row[]) {
      map.set(String(location.id), String(location.completeName ?? location.name ?? location.id));
    }
    return map;
  }, [locations]);

  // Previous / next follow the list the record was opened from, else newest first.
  const navigation = useRecordNavigation<Row>({
    rows: pickings as unknown as Row[],
    currentId: transferId,
    basePath: '/inventory/transfers',
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

  const headerActions = useMemo(
    (): WorkflowAction[] => [workflow.confirm, workflow.assign, workflow.validate, workflow.pack, workflow.cancel],
    [workflow.confirm, workflow.assign, workflow.validate, workflow.pack, workflow.cancel],
  );

  const runWorkflowAction = useCallback(async (action: WorkflowAction, record: RowValueMap) => {
    if (action.kind === 'destructive' || action.kind === 'confirm') {
      setPendingConfirm(action);
      return;
    }
    // The workflow surface reports a typed failure.
    await action.execute(action.prepare?.(record)).catch(() => undefined);
  }, []);

  if (!transfer) {
    if (pickingsLoading) {
      return (
        <div className="space-y-4" data-testid="transfer-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="transfer-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('inventory.transfers.notFound', { defaultValue: 'Transfer not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('inventory.transfers.notFoundHint', {
              defaultValue: 'It may have been deleted, or belong to another organization.',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('inventory', 'transfers')} />} nativeButton={false}>
            {t('inventory.transfers.backToTransfers', { defaultValue: 'Back to transfers' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const record = transfer as RowValueMap;
  const label = String(transfer.name || '').trim() || `#${transferId}`;
  const status = transferStatusBar(transfer, t);
  const stateTag = variantTag(transfer.state).toLowerCase();
  const badges = transferStatusBadges(t);
  const saleId = transfer.saleId ?? transfer.sale_id;
  const purchaseId = transfer.purchaseId ?? transfer.purchase_id;
  const backorderId = transfer.backorderId ?? transfer.backorder_id;

  const locationCell = (keys: string[]) => (_value: unknown, row: Row) => {
    const id = keys.map((key) => row[key]).find((value) => value != null);
    if (id == null) return '—';
    return locationLabelById.get(String(id)) ?? '(deleted)';
  };
  const baseDetail = transferDetailConfig(t);
  const detailConfig = {
    ...baseDetail,
    sections: baseDetail.sections.map((section) =>
      section.id === 'locations'
        ? {
            ...section,
            fields: section.fields.map((field) =>
              field.key === 'locationId'
                ? { ...field, render: locationCell(['locationId', 'location_id']) }
                : field.key === 'locationDestId'
                  ? { ...field, render: locationCell(['locationDestId', 'location_dest_id']) }
                  : field,
            ),
          }
        : section,
    ),
  };
  const movesConfig = stockMovesTableConfig(t);
  const backordersConfig = transfersTableConfig(t);

  return (
    <>
      <RecordPage
        testIdPrefix="transfer"
        breadcrumbs={[
          { label: t('nav.inventory', { defaultValue: 'Inventory' }), href: '/inventory' },
          { label: t('inventory.transfers.title'), href: buildModuleTabHref('inventory', 'transfers') },
          { label },
        ]}
        title={label}
        subtitle={String(transfer.origin ?? '').trim() || undefined}
        badge={
          <Badge variant={(badges.badgeVariants as Record<string, 'default' | 'secondary' | 'outline' | 'destructive'>)[stateTag] ?? 'secondary'}>
            {(badges.badgeLabels as Record<string, string>)[stateTag] ?? stateTag}
          </Badge>
        }
        statusBar={<StatusBar steps={status.steps} current={status.current} terminal={status.terminal} />}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="transfer"
            buttons={[
              {
                id: 'moves',
                label: t('inventory.stockMoves.title'),
                count: transferMoves.length,
                icon: <ListOrdered className="h-4 w-4" />,
                onClick: () => setActiveTab('moves'),
              },
              ...(saleId != null
                ? [
                    {
                      id: 'sale-order',
                      label: t('inventory.transfers.saleOrder', { defaultValue: 'Sales order' }),
                      count: 1,
                      icon: <ShoppingCart className="h-4 w-4" />,
                      href: `/sales/orders/${String(saleId)}`,
                    },
                  ]
                : []),
              ...(purchaseId != null
                ? [
                    {
                      id: 'purchase-order',
                      label: t('inventory.transfers.purchaseOrder', { defaultValue: 'Purchase order' }),
                      count: 1,
                      icon: <ShoppingCart className="h-4 w-4" />,
                      href: `/purchasing/orders/${String(purchaseId)}`,
                    },
                  ]
                : []),
              ...(backorders.length > 0
                ? [
                    {
                      id: 'backorders',
                      label: t('inventory.transfers.backorders', { defaultValue: 'Backorders' }),
                      count: backorders.length,
                      icon: <ArrowLeftRight className="h-4 w-4" />,
                      onClick: () => setActiveTab('backorders'),
                    },
                  ]
                : []),
              ...(backorderId != null
                ? [
                    {
                      id: 'backorder-of',
                      label: t('inventory.transfers.backorderOf', { defaultValue: 'Backorder of' }),
                      count: 1,
                      icon: <ArrowLeftRight className="h-4 w-4" />,
                      href: `/inventory/transfers/${String(backorderId)}`,
                    },
                  ]
                : []),
            ]}
          />
        }
        actions={
          <>
          <RecordHeaderActions model="transfer" record={transfer} organizationId={orgId} companyId={operatingCompanyId ?? undefined} />
          <RecordWorkflowActions
            actions={headerActions}
            record={record}
            onRun={(action, row) => void runWorkflowAction(action, row)}
            primaryActionIds={PRIMARY_ACTION_IDS}
            pendingActionIds={workflow.isPending ? new Set(headerActions.map((action) => action.id)) : undefined}
          />
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={detailConfig} data={transfer} />,
          },
          {
            id: 'moves',
            label: t('inventory.stockMoves.title'),
            content: (
              <EntityView config={{ ...movesConfig, title: '', description: undefined }} data={transferMoves} useCard={false} />
            ),
          },
          {
            id: 'backorders',
            label: t('inventory.transfers.backorders', { defaultValue: 'Backorders' }),
            content: (
              <EntityView
                config={{ ...backordersConfig, title: '', description: undefined }}
                data={backorders}
                useCard={false}
                onRowClick={(row) => router.push(`/inventory/transfers/${String((row as Row).id)}`)}
              />
            ),
          },
          {
            id: 'discussion',
            label: t('inventory.transfers.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="grid gap-6 lg:grid-cols-2" data-testid="transfer-discussion">
                <RecordChatter
                  organizationId={organizationId}
                  resModel="stock_picking"
                  resId={BigInt(transferId)}
                  recordTitle={label}
                />
                <RecordDocumentAttachments
                  organizationId={orgId}
                  resModel="stock_picking"
                  resId={BigInt(transferId)}
                  title={t('inventory.transfers.attachments', { defaultValue: 'Attachments' })}
                />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="stock_picking" recordId={transferId} />,
          },
        ]}
      />

      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent data-testid="transfer-action-confirm">
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
