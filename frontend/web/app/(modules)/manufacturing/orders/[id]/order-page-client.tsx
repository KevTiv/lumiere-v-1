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
  manufacturingOrdersTableConfig,
  workordersTableConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import {
  useManufacturingMutations,
  useMrpProductions,
  useMrpWorkcenters,
  useMrpWorkorders,
  useQualityChecks,
  type MrpProduction,
  type MrpWorkcenter,
  type MrpWorkorder,
} from '@lumiere/query-hooks/hooks/manufacturing';
import { useProducts } from '@lumiere/query-hooks/hooks/inventory';
import { useIotDevices } from '@lumiere/query-hooks/hooks/iot';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import type { Product } from '@lumiere/stdb/types';
import { productRowsToSelectOptions } from '@/lib/form-lookup';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useManufacturingModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { ManufacturingRowDialog } from '../../manufacturing-row-dialog';
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
              <EntityView config={{ ...workordersTableConfig(t), title: '', description: undefined }} data={ownWorkorders} useCard={false} />
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
