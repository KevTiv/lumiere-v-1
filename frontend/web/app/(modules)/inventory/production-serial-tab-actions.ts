'use client';
import { useTranslation } from '@lumiere/i18n';
import { formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useSerialReserveWorkflow } from '@lumiere/query-hooks/hooks/serial-reserve-workflow';
import { useSerialUseWorkflow } from '@lumiere/query-hooks/hooks/serial-use-workflow';
import {
  useCreateStockProductionSerial,
  useUpdateStockProductionSerial,
  useDeleteStockProductionSerial,
} from '@lumiere/query-hooks/hooks/inventory';
import { CheckCircle, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';
import { rowState } from './inventory-tab-actions';

interface ProductionSerialTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  productSelectOptions: SelectField['options'];
  workflowSurface: ReturnType<typeof useWorkflowSurface>;
}

export function useProductionSerialTabActions({
  orgId,
  operatingCompanyId,
  askForm,
  productSelectOptions,
  workflowSurface,
}: ProductionSerialTabActionsOptions) {
  const { t } = useTranslation();
  const createStockProductionSerial = useCreateStockProductionSerial(
    orgId,
    operatingCompanyId,
  );
  const updateStockProductionSerial = useUpdateStockProductionSerial(orgId);
  const deleteStockProductionSerial = useDeleteStockProductionSerial(orgId);
  const reserveSerial = useSerialReserveWorkflow(orgId, workflowSurface);
  const useSerial = useSerialUseWorkflow(orgId, workflowSurface);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'serials') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'create-serial',
                label: t('inventory.serialActions.create'),
                icon: Plus,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.serialActions.create'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.serialActions.namePrompt'),
                        type: 'text',
                        required: true,
                      },
                      {
                        id: 'productId',
                        name: 'productId',
                        label: t('inventory.byRecord.product', {
                          defaultValue: 'Product',
                        }),
                        type: 'select',
                        required: true,
                        options: productSelectOptions,
                      },
                    ],
                  });
                  if (!values) return;
                  const name = formText(values.name);
                  const productId = formText(values.productId);
                  if (
                    name == null ||
                    productId == null ||
                    operatingCompanyId == null
                  )
                    return;
                  await createStockProductionSerial.mutateAsync({
                    companyId: BigInt(operatingCompanyId),
                    name,
                    productId: BigInt(Number(productId)),
                    productVariantId: undefined,
                    lotId: undefined,
                    ref: undefined,
                    note: undefined,
                    expirationDate: undefined,
                    useDate: undefined,
                    removalDate: undefined,
                    alertDate: undefined,
                    productQty: 1,
                    locationId: undefined,
                    packageId: undefined,
                    ownerId: undefined,
                    // The serial lifecycle only recognizes "free" as the
                    // initial state (reserve_serial/use_serial/etc. all
                    // check for it verbatim) — "available" left every
                    // UI-created serial permanently unreservable.
                    state: 'free',
                    isScrap: false,
                    isLocked: false,
                    warrantyExpiration: undefined,
                    warrantyStart: undefined,
                    lastMaintenance: undefined,
                    nextMaintenance: undefined,
                    maintenanceCount: 0,
                    metadata: undefined,
                  });
                },
              },
              {
                id: 'reserve-serial',
                label: t('inventory.productionSerials.actions.reserve'),
                icon: ListChecks,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['free'].includes(rowState(row, 'state')),
                  ),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null)
                    await reserveSerial.reserve(
                      { serialId: String(id) },
                      { navigateToNext: true },
                    );
                },
              },
              {
                id: 'use-serial',
                label: t('inventory.productionSerials.actions.markInUse'),
                icon: CheckCircle,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['reserved'].includes(rowState(row, 'state')),
                  ),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null)
                    await useSerial.markInUse(
                      { serialId: String(id) },
                      { navigateToNext: true },
                    );
                },
              },
              {
                id: 'edit-serial-note',
                label: t('inventory.serialActions.editNote'),
                icon: Pencil,
                requiresSelection: true,
                onClick: async (rows) => {
                  const row = rows[0];
                  const id = row?.id as ScalarId | undefined;
                  if (id == null) return;
                  const values = await askForm({
                    title: t('inventory.serialActions.editNote'),
                    fields: [
                      {
                        id: 'note',
                        name: 'note',
                        label: t('inventory.serialActions.notePrompt'),
                        type: 'textarea',
                        rows: 3,
                        defaultValue: String(row?.note ?? ''),
                      },
                    ],
                  });
                  if (!values) return;
                  await updateStockProductionSerial.mutateAsync({
                    serialId: id,
                    params: {
                      companyId: undefined,
                      note: formText(values.note),
                    },
                  });
                },
              },
              {
                id: 'delete-serial',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t('inventory.serialActions.confirmDelete'),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  await deleteStockProductionSerial.mutateAsync(id);
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
      createStockProductionSerial,
      updateStockProductionSerial,
      deleteStockProductionSerial,
      useSerial,
    ].some((mutation) => mutation.isPending),
  };
}
