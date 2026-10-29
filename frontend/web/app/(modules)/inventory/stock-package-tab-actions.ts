'use client';
import { useTranslation } from '@lumiere/i18n';
import type { EntityTableConfig } from '@lumiere/ui';
import { canConfirmPackage, canDonePackage } from './stock-package-actions';
import {
  useConfirmStockPackage,
  useDoneStockPackage,
} from '@lumiere/query-hooks/hooks/inventory';
import { CheckCircle, ListChecks } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface StockPackageTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
}

export function useStockPackageTabActions({
  orgId,
  operatingCompanyId,
}: StockPackageTabActionsOptions) {
  const { t } = useTranslation();
  const confirmStockPackage = useConfirmStockPackage(orgId, operatingCompanyId);
  const doneStockPackage = useDoneStockPackage(orgId, operatingCompanyId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'stock-packages') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'confirm-package',
                label: t('inventory.stockPackageActions.confirm', {
                  defaultValue: 'Confirm package',
                }),
                icon: CheckCircle,
                requiresSelection: true,
                permission: { resource: 'stock_picking', action: 'update' },
                isApplicable: (rows) =>
                  rows.length === 1 && canConfirmPackage(rows[0]),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.stockPackageActions.confirm', {
                    defaultValue: 'Confirm package',
                  }),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await confirmStockPackage.mutateAsync(id);
                },
              },
              {
                id: 'done-package',
                label: t('inventory.stockPackageActions.done', {
                  defaultValue: 'Mark package done',
                }),
                icon: ListChecks,
                requiresSelection: true,
                permission: { resource: 'stock_picking', action: 'update' },
                isApplicable: (rows) =>
                  rows.length === 1 && canDonePackage(rows[0]),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.stockPackageActions.done', {
                    defaultValue: 'Mark package done',
                  }),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await doneStockPackage.mutateAsync(id);
                },
              },
            ],
          },
        },
      };
    }
    return tab;
  }
  return {
    configureTab,
    isPending: [confirmStockPackage, doneStockPackage].some(
      (mutation) => mutation.isPending,
    ),
  };
}
