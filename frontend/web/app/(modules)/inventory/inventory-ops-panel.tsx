'use client';

import { useTranslation } from '@lumiere/i18n';
import {
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
  useInventoryExceptionsShortAtp,
} from '@lumiere/query-hooks/hooks/inventory';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumiere/ui/components/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@lumiere/ui/components/tabs';
import {
  canUseModuleData,
  moduleCollection,
} from '@lumiere/ui/lib/module-data-state';
import { useRBAC } from '@lumiere/ui/lib/rbac-context';
import { ModuleDataNotice } from '@lumiere/ui/pages/module-data-notice';

interface InventoryOpsPanelProps {
  organizationId: bigint;
  companyId: bigint | undefined;
  productNames: ReadonlyMap<string, string>;
}

export function InventoryOpsPanel({
  organizationId,
  companyId,
  productNames,
}: InventoryOpsPanelProps) {
  const { t } = useTranslation();
  const { checkPermission, permissionsReady } = useRBAC();
  const canRead =
    permissionsReady !== false &&
    checkPermission('stock_quant', 'read').allowed;
  const enabled = companyId !== undefined && companyId > 0n && canRead;
  const shortAtp = moduleCollection(
    useInventoryExceptionsShortAtp(organizationId, undefined, enabled),
  );
  const expiredLots = moduleCollection(
    useInventoryExceptionsExpiredLots(organizationId, undefined, enabled),
  );
  const openQc = moduleCollection(
    useInventoryExceptionsOpenQc(organizationId, undefined, enabled),
  );

  if (companyId === undefined || permissionsReady === false) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (!canRead) return <ModuleDataNotice state={{ status: 'denied' }} />;

  if (companyId === 0n) {
    return (
      <ModuleDataNotice
        state={{
          status: 'error',
          message: t('financeReview.selectCompany', {
            defaultValue: 'Select a company',
          }),
        }}
      />
    );
  }

  const queues = [
    {
      id: 'short_atp',
      label: t('inventory.ops.shortAtp'),
      ...shortAtp,
    },
    {
      id: 'expired_lots',
      label: t('inventory.ops.expiredLots'),
      ...expiredLots,
    },
    {
      id: 'open_qc',
      label: t('inventory.ops.openQc'),
      ...openQc,
    },
  ];
  const companyKey = String(companyId);
  const unknown = t('inventory.warehouseWorkspace.referenceUnavailable', {
    defaultValue: 'Unavailable',
  });

  return (
    <Tabs
      defaultValue="short_atp"
      className="min-w-0"
      data-testid="inventory-ops-panel"
    >
      <TabsList
        variant="line"
        className="h-auto max-w-full flex-wrap justify-start"
      >
        {queues.map(({ id, label }) => (
          <TabsTrigger
            key={id}
            value={id}
            data-testid={`inventory-ops-queue-${id}`}
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {queues.map(({ id, label, state, rows }) => {
        const companyRows = rows.filter(
          (row) => String(row.companyId) === companyKey,
        );

        return (
          <TabsContent
            key={id}
            value={id}
            className="min-w-0 space-y-3"
            aria-busy={state.status === 'loading'}
          >
            <ModuleDataNotice state={state} />
            {state.status === 'loading' ? (
              <Skeleton className="h-28 w-full" />
            ) : canUseModuleData(state) ? (
              <Table bounded viewportLabel={label}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('inventory.ops.summary')}</TableHead>
                    <TableHead>
                      {t('inventory.byRecord.product', {
                        defaultValue: 'Product',
                      })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companyRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="py-4 text-muted-foreground"
                      >
                        {t('inventory.ops.empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    companyRows.map((row) => (
                      <TableRow key={String(row.id)}>
                        <TableCell className="whitespace-normal wrap-anywhere">
                          {row.summary || unknown}
                        </TableCell>
                        <TableCell className="whitespace-normal wrap-anywhere">
                          {row.productId == null
                            ? '—'
                            : (productNames.get(String(row.productId)) ??
                              unknown)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            ) : null}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
