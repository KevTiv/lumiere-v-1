'use client';
import { useTranslation } from '@lumiere/i18n';
import { formNumber, formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, FormConfig, SelectField } from '@lumiere/ui';
import {
  useCreateStockInventory,
  useCreateStockInventoryLine,
  useUpdateStockInventoryState,
  useProcessInventoryAdjustment,
} from '@lumiere/query-hooks/hooks/inventory';
import { ListChecks, Pencil, Plus } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';
import { rowState } from './inventory-tab-actions';

interface InventoryCountTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  adjustmentFormConfig: FormConfig;
  stockInventoryOptions: SelectField['options'];
  productSelectOptions: SelectField['options'];
  uomFieldOptions: SelectField['options'];
  stockOnHandLocationOptions: SelectField['options'];
  stockInventoryStateOptions: SelectField['options'];
}

export function useInventoryCountTabActions({
  orgId,
  operatingCompanyId,
  askForm,
  adjustmentFormConfig,
  stockInventoryOptions,
  productSelectOptions,
  uomFieldOptions,
  stockOnHandLocationOptions,
  stockInventoryStateOptions,
}: InventoryCountTabActionsOptions) {
  const { t } = useTranslation();
  const createStockInventory = useCreateStockInventory(
    orgId,
    operatingCompanyId,
  );
  const createStockInventoryLine = useCreateStockInventoryLine(
    orgId,
    operatingCompanyId,
  );
  const updateStockInventoryState = useUpdateStockInventoryState(
    orgId,
    operatingCompanyId,
  );
  const processAdjustment = useProcessInventoryAdjustment(orgId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'adjustments') {
      return {
        ...tab,
        createForm: adjustmentFormConfig,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'create-stock-inventory',
                label: t('inventory.stockInventoryActions.create'),
                icon: Plus,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.stockInventoryActions.create'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.stockInventoryActions.namePrompt'),
                        type: 'text',
                        required: true,
                        defaultValue: 'Cycle Count',
                      },
                    ],
                  });
                  const name = formText(values?.name);
                  if (name == null || operatingCompanyId == null) return;
                  await createStockInventory.mutateAsync({
                    company_id: Number(operatingCompanyId),
                    name,
                    location_ids: [],
                    product_ids: [],
                    lot_ids: [],
                    owner_ids: [],
                    package_ids: [],
                    accounting_date: null,
                    category_id: null,
                    counted_mode: 'all',
                    is_stock_check: true,
                    metadata: null,
                  });
                },
              },
              {
                id: 'create-stock-inventory-line',
                label: t('inventory.stockInventoryActions.addLine'),
                icon: ListChecks,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.stockInventoryActions.addLine'),
                    fields: [
                      {
                        id: 'inventoryId',
                        name: 'inventoryId',
                        label: t('inventory.byRecord.inventoryCount', {
                          defaultValue: 'Inventory count',
                        }),
                        type: 'select',
                        required: true,
                        options: stockInventoryOptions,
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
                      {
                        id: 'uomId',
                        name: 'uomId',
                        label: t('inventory.byRecord.uom', {
                          defaultValue: 'Unit of measure',
                        }),
                        type: 'select',
                        required: true,
                        options: uomFieldOptions,
                        width: '1/2',
                      },
                      {
                        id: 'locationId',
                        name: 'locationId',
                        label: t('inventory.byRecord.location', {
                          defaultValue: 'Location',
                        }),
                        type: 'select',
                        required: true,
                        options: stockOnHandLocationOptions,
                        width: '1/2',
                      },
                      {
                        id: 'qty',
                        name: 'qty',
                        label: t(
                          'inventory.stockInventoryActions.productQtyPrompt',
                        ),
                        type: 'number',
                        required: true,
                        min: 0,
                        defaultValue: 0,
                      },
                    ],
                  });
                  if (!values) return;
                  const inventoryId = formText(values.inventoryId);
                  const productId = formText(values.productId);
                  const uomId = formText(values.uomId);
                  const locationId = formText(values.locationId);
                  const qty = formNumber(values.qty);
                  if (
                    inventoryId == null ||
                    productId == null ||
                    uomId == null ||
                    locationId == null ||
                    qty == null
                  )
                    return;
                  await createStockInventoryLine.mutateAsync({
                    inventoryId,
                    params: {
                      product_id: Number(productId),
                      product_variant_id: null,
                      product_uom_id: Number(uomId),
                      location_id: Number(locationId),
                      location_name: null,
                      prod_lot_id: null,
                      package_id: null,
                      partner_id: null,
                      theoretical_qty: 0,
                      product_qty: qty,
                      inventory_location_id: null,
                      inventory_product_id: null,
                      inventory_prod_lot_id: null,
                      inventory_package_id: null,
                      inventory_partner_id: null,
                      package_level_id: null,
                      package_level_id_visible: false,
                      state: 'draft',
                      product_tracking: 'none',
                      product_barcode: null,
                      product_type: 'product',
                      is_editable: true,
                      outdated: false,
                      inventory_location_id_name: null,
                      inventory_product_id_name: null,
                      theoretical_qty_text: null,
                      product_uom_category_id: null,
                      metadata: null,
                    },
                  });
                },
              },
              {
                id: 'set-stock-inventory-state',
                label: t('inventory.stockInventoryActions.setState'),
                icon: Pencil,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.stockInventoryActions.setState'),
                    fields: [
                      {
                        id: 'inventoryId',
                        name: 'inventoryId',
                        label: t('inventory.byRecord.inventoryCount', {
                          defaultValue: 'Inventory count',
                        }),
                        type: 'select',
                        required: true,
                        options: stockInventoryOptions,
                      },
                      {
                        id: 'newState',
                        name: 'newState',
                        label: t('inventory.stockInventoryActions.statePrompt'),
                        type: 'select',
                        required: true,
                        defaultValue: 'confirm',
                        options: stockInventoryStateOptions,
                      },
                    ],
                  });
                  if (!values) return;
                  const inventoryId = formText(values.inventoryId);
                  const newState = formText(values.newState);
                  if (inventoryId == null || newState == null) return;
                  await updateStockInventoryState.mutateAsync({
                    inventoryId,
                    newState,
                  });
                },
              },
              {
                id: 'process-adjustment',
                label: t('inventory.adjustmentActions.process'),
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['draft'].includes(rowState(row, 'state')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.adjustmentActions.process'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await processAdjustment.mutateAsync(id);
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
      createStockInventory,
      createStockInventoryLine,
      updateStockInventoryState,
      processAdjustment,
    ].some((mutation) => mutation.isPending),
  };
}
