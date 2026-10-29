'use client';
import { useTranslation } from '@lumiere/i18n';
import { formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import {
  useCreateStockProductionLot,
  useUpdateStockProductionLot,
  useDeleteStockProductionLot,
} from '@lumiere/query-hooks/hooks/inventory';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface ProductionLotTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  productSelectOptions: SelectField['options'];
  setCsvKind: (kind: 'lot') => void;
}

export function useProductionLotTabActions({
  orgId,
  operatingCompanyId,
  askForm,
  productSelectOptions,
  setCsvKind,
}: ProductionLotTabActionsOptions) {
  const { t } = useTranslation();
  const createStockProductionLot = useCreateStockProductionLot(
    orgId,
    operatingCompanyId,
  );
  const updateStockProductionLot = useUpdateStockProductionLot(orgId);
  const deleteStockProductionLot = useDeleteStockProductionLot(orgId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'lots') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'csv-lot',
                label: t('inventory.csvImport.toolbarLots'),
                onClick: () => setCsvKind('lot'),
              },
              {
                id: 'create-lot',
                label: t('inventory.lotActions.create'),
                icon: Plus,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.lotActions.create'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.lotActions.namePrompt'),
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
                  await createStockProductionLot.mutateAsync({
                    companyId: BigInt(operatingCompanyId),
                    name,
                    productId: BigInt(Number(productId)),
                    productVariantId: undefined,
                    ref: undefined,
                    note: undefined,
                    expirationDate: undefined,
                    useDate: undefined,
                    removalDate: undefined,
                    alertDate: undefined,
                    productQty: 0,
                    locationId: undefined,
                    packageId: undefined,
                    ownerId: undefined,
                    isScrap: false,
                    isLocked: false,
                    metadata: undefined,
                  });
                },
              },
              {
                id: 'edit-lot-note',
                label: t('inventory.lotActions.editNote'),
                icon: Pencil,
                requiresSelection: true,
                onClick: async (rows) => {
                  const row = rows[0];
                  const id = row?.id as ScalarId | undefined;
                  if (id == null) return;
                  const values = await askForm({
                    title: t('inventory.lotActions.editNote'),
                    fields: [
                      {
                        id: 'note',
                        name: 'note',
                        label: t('inventory.lotActions.notePrompt'),
                        type: 'textarea',
                        rows: 3,
                        defaultValue: String(row?.note ?? ''),
                      },
                    ],
                  });
                  if (!values) return;
                  await updateStockProductionLot.mutateAsync({
                    lotId: id,
                    params: {
                      companyId: undefined,
                      note: formText(values.note),
                    },
                  });
                },
              },
              {
                id: 'delete-lot',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t('inventory.lotActions.confirmDelete'),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  await deleteStockProductionLot.mutateAsync(id);
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
      createStockProductionLot,
      updateStockProductionLot,
      deleteStockProductionLot,
    ].some((mutation) => mutation.isPending),
  };
}
