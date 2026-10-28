'use client';
import { useTranslation } from '@lumiere/i18n';
import {
  newReplenishmentRuleForm,
  mergeSelectOptionsForFields,
} from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useReplenishmentExecutionWorkflow } from '@lumiere/query-hooks/hooks/replenishment-execution-workflow';
import { useReplenishmentScheduleWorkflow } from '@lumiere/query-hooks/hooks/replenishment-schedule-workflow';
import { replenishmentScheduleState } from '@lumiere/erp-workflows';
import { productRowsToSelectOptions } from '@/lib/form-lookup';
import { ListChecks, XCircle, Play } from 'lucide-react';
import type { Product, Warehouse } from '@lumiere/stdb/types';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface ReplenishmentTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  workflowSurface: ReturnType<typeof useWorkflowSurface>;
  products: Product[];
  warehouses: Warehouse[];
  locationParentOptions: SelectField['options'];
  uomFieldOptions: SelectField['options'];
}

export function useReplenishmentTabActions({
  orgId,
  operatingCompanyId,
  workflowSurface,
  products,
  warehouses,
  locationParentOptions,
  uomFieldOptions,
}: ReplenishmentTabActionsOptions) {
  const { t } = useTranslation();
  const executeReplenishmentRule = useReplenishmentExecutionWorkflow(
    orgId,
    operatingCompanyId,
    workflowSurface,
  );
  const replenishmentSchedule = useReplenishmentScheduleWorkflow(
    orgId,
    operatingCompanyId,
    workflowSurface,
  );
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'replenishment') {
      return {
        ...tab,
        createAction: 'createReplenishmentRule',
        createForm: mergeSelectOptionsForFields(newReplenishmentRuleForm(t), {
          productId: productRowsToSelectOptions(products),
          locationId: [...locationParentOptions],
          uomId: [...uomFieldOptions],
          warehouseId: warehouses.map((w) => ({
            value: String(w.id),
            label: String(w.name ?? w.id),
          })),
        }),
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'execute-replenishment-rule',
                label: t('inventory.replenishmentActions.executeRule'),
                icon: ListChecks,
                requiresSelection: true,
                confirm: {
                  title: t('inventory.replenishmentActions.executeRule'),
                  description: `${t('inventory.replenishmentActions.executeRule')}\n${t('inventory.replenishmentActions.executeRuleHint')}`,
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  if (
                    typeof globalThis.crypto === 'undefined' ||
                    typeof globalThis.crypto.randomUUID !== 'function'
                  ) {
                    return;
                  }
                  await executeReplenishmentRule.execute(
                    {
                      ruleId: String(id),
                      idempotencyKey: globalThis.crypto.randomUUID(),
                    },
                    { navigateToNext: true },
                  );
                },
              },
              {
                id: 'schedule-replenishment-run',
                label: t('inventory.replenishmentActions.scheduleRun'),
                icon: Play,
                requiresSelection: true,
                isApplicable: (rows) => {
                  if (rows.length !== 1) return false;
                  const state = replenishmentScheduleState(rows[0] ?? {});
                  return state.readable && state.jobId === null;
                },
                onClick: (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) {
                    void replenishmentSchedule.schedule(String(id), {
                      navigateToNext: true,
                    });
                  }
                },
              },
              {
                id: 'cancel-replenishment-run',
                label: t('inventory.replenishmentActions.cancelRun'),
                icon: XCircle,
                variant: 'destructive',
                requiresSelection: true,
                isApplicable: (rows) => {
                  if (rows.length !== 1) return false;
                  const state = replenishmentScheduleState(rows[0] ?? {});
                  return state.readable && state.jobId !== null;
                },
                onClick: (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) {
                    void replenishmentSchedule.cancel(String(id), {
                      navigateToNext: true,
                    });
                  }
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
    isPending: [executeReplenishmentRule, replenishmentSchedule].some(
      (mutation) => mutation.isPending,
    ),
  };
}
