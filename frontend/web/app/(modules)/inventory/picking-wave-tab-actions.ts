'use client';
import { useTranslation } from '@lumiere/i18n';
import { newPickingWaveForm, mergeSelectOptionsForFields } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import { canReleaseWave } from './picking-wave-actions';
import {
  useConfirmPickingWave,
  useCompletePickingWave,
} from '@lumiere/query-hooks/hooks/inventory';
import { CheckCircle, ListChecks } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';
import { rowState } from './inventory-tab-actions';

interface PickingWaveTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  assignUserFieldOptions: SelectField['options'];
}

export function usePickingWaveTabActions({
  orgId,
  operatingCompanyId,
  assignUserFieldOptions,
}: PickingWaveTabActionsOptions) {
  const { t } = useTranslation();
  const confirmPickingWave = useConfirmPickingWave(orgId, operatingCompanyId);
  const completePickingWave = useCompletePickingWave(orgId, operatingCompanyId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'picking-waves') {
      return {
        ...tab,
        createAction: 'createPickingWave',
        createForm: mergeSelectOptionsForFields(newPickingWaveForm(t), {
          userId: [...assignUserFieldOptions],
        }),
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'confirm-wave',
                label: t('inventory.pickingWaveActions.confirm'),
                icon: CheckCircle,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.length === 1 && canReleaseWave(rows[0]),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.pickingWaveActions.confirm'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await confirmPickingWave.mutateAsync(id);
                },
              },
              {
                id: 'complete-wave',
                label: t('inventory.pickingWaveActions.complete'),
                icon: ListChecks,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['in_progress'].includes(rowState(row, 'state')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.pickingWaveActions.complete'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await completePickingWave.mutateAsync(id);
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
    isPending: [confirmPickingWave, completePickingWave].some(
      (mutation) => mutation.isPending,
    ),
  };
}
