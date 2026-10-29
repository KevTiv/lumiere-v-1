'use client';
import { useTranslation } from '@lumiere/i18n';
import { formNumber, formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import {
  useDoneStockMove,
  useCancelStockMove,
  useCreateStockMove,
  useConfirmStockMove,
  useAssignStockMove,
} from '@lumiere/query-hooks/hooks/inventory';
import { CheckCircle, Plus, UserCircle2, XCircle } from 'lucide-react';
import { toCreateStockMoveParams } from '@/lib/inventory-ext-params';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';
import { rowState } from './inventory-tab-actions';

interface StockMoveTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  productSelectOptions: SelectField['options'];
  uomFieldOptions: SelectField['options'];
  stockOnHandLocationOptions: SelectField['options'];
}

export function useStockMoveTabActions({
  orgId,
  operatingCompanyId,
  askForm,
  productSelectOptions,
  uomFieldOptions,
  stockOnHandLocationOptions,
}: StockMoveTabActionsOptions) {
  const { t } = useTranslation();
  const createStockMove = useCreateStockMove(orgId, operatingCompanyId);
  const confirmStockMove = useConfirmStockMove(orgId, operatingCompanyId);
  const assignStockMove = useAssignStockMove(orgId, operatingCompanyId);
  const doneStockMove = useDoneStockMove(orgId, operatingCompanyId);
  const cancelStockMove = useCancelStockMove(orgId, operatingCompanyId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'stock-moves') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'create-stock-move',
                label: t('inventory.stockMoveActions.create'),
                icon: Plus,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.stockMoveActions.create'),
                    fields: [
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
                      {
                        id: 'productUom',
                        name: 'productUom',
                        label: t('inventory.byRecord.uom', {
                          defaultValue: 'Unit of measure',
                        }),
                        type: 'select',
                        required: true,
                        options: uomFieldOptions,
                      },
                      {
                        id: 'locationId',
                        name: 'locationId',
                        label: t('inventory.byRecord.sourceLocation', {
                          defaultValue: 'Source location',
                        }),
                        type: 'select',
                        required: true,
                        options: stockOnHandLocationOptions,
                        width: '1/2',
                      },
                      {
                        id: 'locationDestId',
                        name: 'locationDestId',
                        label: t('inventory.byRecord.destLocation', {
                          defaultValue: 'Destination location',
                        }),
                        type: 'select',
                        required: true,
                        options: stockOnHandLocationOptions,
                        width: '1/2',
                      },
                      {
                        id: 'quantity',
                        name: 'quantity',
                        label: t('inventory.stockMoveActions.quantityPrompt'),
                        type: 'number',
                        required: true,
                        defaultValue: 1,
                        min: 0,
                        width: '1/2',
                      },
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.stockMoveActions.namePrompt'),
                        type: 'text',
                        defaultValue: 'Manual Stock Move',
                        width: '1/2',
                      },
                    ],
                  });
                  if (!values) return;
                  const quantity = formNumber(values.quantity);
                  if (quantity == null) return;
                  await createStockMove.mutateAsync(
                    toCreateStockMoveParams({
                      companyId: operatingCompanyId,
                      name: formText(values.name) ?? 'Manual Stock Move',
                      productId: Number(values.productId),
                      productUom: Number(values.productUom),
                      quantity,
                      locationId: Number(values.locationId),
                      locationDestId: Number(values.locationDestId),
                    }),
                  );
                },
              },
              {
                id: 'confirm-move',
                label: t('inventory.stockMoveActions.confirm'),
                icon: CheckCircle,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['draft'].includes(rowState(row, 'state')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.stockMoveActions.confirm'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await confirmStockMove.mutateAsync(id);
                },
              },
              {
                id: 'assign-move',
                label: t('inventory.stockMoveActions.assign'),
                icon: UserCircle2,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['confirmed'].includes(rowState(row, 'state')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.stockMoveActions.assign'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await assignStockMove.mutateAsync(id);
                },
              },
              {
                id: 'done-move',
                label: t('inventory.stockMoveActions.done'),
                icon: CheckCircle,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['assigned'].includes(rowState(row, 'state')),
                  ),
                onClick: async (rows) => {
                  const row = rows[0];
                  const id = row?.id as ScalarId | undefined;
                  if (id == null) return;
                  const def = Number(
                    row?.productUomQty ?? row?.product_uom_qty ?? 1,
                  );
                  const values = await askForm({
                    title: t('inventory.stockMoveActions.done'),
                    fields: [
                      {
                        id: 'quantityDone',
                        name: 'quantityDone',
                        label: t(
                          'inventory.stockMoveActions.quantityDonePrompt',
                        ),
                        type: 'number',
                        required: true,
                        min: 0,
                        defaultValue: Number.isFinite(def) ? def : 1,
                      },
                    ],
                  });
                  if (!values) return;
                  const qty = formNumber(values.quantityDone);
                  if (qty == null) return;
                  await doneStockMove.mutateAsync({
                    moveId: id,
                    quantityDone: qty,
                  });
                },
              },
              {
                id: 'cancel-move',
                label: t('inventory.stockMoveActions.cancel'),
                icon: XCircle,
                variant: 'destructive',
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every(
                    (row) =>
                      !['done', 'cancel', 'cancelled'].includes(
                        rowState(row, 'state'),
                      ),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.stockMoveActions.cancel'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await cancelStockMove.mutateAsync(id);
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
      createStockMove,
      confirmStockMove,
      assignStockMove,
      doneStockMove,
      cancelStockMove,
    ].some((mutation) => mutation.isPending),
  };
}
