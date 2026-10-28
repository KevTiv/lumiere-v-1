'use client';
import { useTranslation } from '@lumiere/i18n';
import type { EntityTableConfig } from '@lumiere/ui';
import {
  useDeleteStockRoute,
  useDeleteStockRule,
} from '@lumiere/query-hooks/hooks/inventory';
import { Trash2 } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface StockRoutingTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
}

export function useStockRoutingTabActions({
  orgId,
  operatingCompanyId,
}: StockRoutingTabActionsOptions) {
  const { t } = useTranslation();
  const deleteStockRoute = useDeleteStockRoute(orgId, operatingCompanyId);
  const deleteStockRule = useDeleteStockRule(orgId, operatingCompanyId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'routes') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'delete-route',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t('inventory.routeActions.confirmDelete'),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  await deleteStockRoute.mutateAsync(id);
                },
              },
            ],
          },
        },
      };
    }
    if (tab.id === 'rules') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'delete-rule',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t('inventory.ruleActions.confirmDelete'),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  await deleteStockRule.mutateAsync(id);
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
    isPending: [deleteStockRoute, deleteStockRule].some(
      (mutation) => mutation.isPending,
    ),
  };
}
