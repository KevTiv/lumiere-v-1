'use client';
import { useTranslation } from '@lumiere/i18n';
import { formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import {
  useStartWarehouseTask,
  useCompleteWarehouseTask,
  useCancelWarehouseTask,
  useUpdateWarehouseTaskStatus,
} from '@lumiere/query-hooks/hooks/inventory';
import { CheckCircle, ListChecks, Pencil, XCircle } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface WarehouseTaskTabActionsOptions {
  orgId: bigint;
  selectedOperatingCompanyId: bigint | undefined;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  warehouseTaskStatusOptions: SelectField['options'];
}

export function useWarehouseTaskTabActions({
  orgId,
  selectedOperatingCompanyId,
  askForm,
  warehouseTaskStatusOptions,
}: WarehouseTaskTabActionsOptions) {
  const { t } = useTranslation();
  const startWarehouseTask = useStartWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );
  const completeWarehouseTask = useCompleteWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );
  const cancelWarehouseTask = useCancelWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );
  const updateWarehouseTaskStatus = useUpdateWarehouseTaskStatus(
    orgId,
    selectedOperatingCompanyId,
  );
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'warehouse-tasks') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'start-task',
                label: t('inventory.taskActions.start'),
                icon: CheckCircle,
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.taskActions.start'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await startWarehouseTask.mutateAsync(id);
                },
              },
              {
                id: 'complete-task',
                label: t('inventory.taskActions.complete'),
                icon: ListChecks,
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.taskActions.complete'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null)
                    await completeWarehouseTask.mutateAsync({
                      taskId: id,
                      result: {},
                    });
                },
              },
              {
                id: 'cancel-task',
                label: t('inventory.taskActions.cancel'),
                icon: XCircle,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.taskActions.cancel'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await cancelWarehouseTask.mutateAsync(id);
                },
              },
              {
                id: 'set-task-status',
                label: t('inventory.taskActions.setStatus'),
                icon: Pencil,
                requiresSelection: true,
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  const values = await askForm({
                    title: t('inventory.taskActions.setStatus'),
                    fields: [
                      {
                        id: 'status',
                        name: 'status',
                        label: t('inventory.byRecord.status', {
                          defaultValue: 'Status',
                        }),
                        type: 'select',
                        required: true,
                        options: warehouseTaskStatusOptions,
                      },
                    ],
                  });
                  const newStatus = formText(values?.status);
                  if (newStatus == null) return;
                  await updateWarehouseTaskStatus.mutateAsync({
                    taskId: id,
                    newStatus,
                  });
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
    isPending: [
      startWarehouseTask,
      completeWarehouseTask,
      cancelWarehouseTask,
      updateWarehouseTaskStatus,
    ].some((mutation) => mutation.isPending),
  };
}
