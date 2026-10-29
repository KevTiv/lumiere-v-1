'use client';
import { useTranslation } from '@lumiere/i18n';
import { formNumber, formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import {
  useDeleteBarcodeRule,
  useCreateBarcodeNomenclature,
  useUpdateBarcodeNomenclature,
  useDeleteBarcodeNomenclature,
  useAddRuleToNomenclature,
  useRemoveRuleFromNomenclature,
  useUpdateWhatsappQualityScore,
} from '@lumiere/query-hooks/hooks/inventory';
import { Pencil, Plus, Trash2, ScanLine } from 'lucide-react';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';

interface BarcodeTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  barcodeRuleOptions: SelectField['options'];
}

export function useBarcodeTabActions({
  orgId,
  operatingCompanyId,
  askForm,
  barcodeRuleOptions,
}: BarcodeTabActionsOptions) {
  const { t } = useTranslation();
  const deleteBarcodeRule = useDeleteBarcodeRule(orgId, operatingCompanyId);
  const updateWhatsappQualityScore = useUpdateWhatsappQualityScore(orgId);
  const createBarcodeNomenclature = useCreateBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  const updateBarcodeNomenclature = useUpdateBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  const addRuleToNomenclature = useAddRuleToNomenclature(
    orgId,
    operatingCompanyId,
  );
  const removeRuleFromNomenclature = useRemoveRuleFromNomenclature(
    orgId,
    operatingCompanyId,
  );
  const deleteBarcodeNomenclature = useDeleteBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'barcode-rules') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'set-whatsapp-quality-score',
                label: t('inventory.barcodeActions.setWhatsappQualityScore'),
                icon: ScanLine,
                requiresSelection: false,
                onClick: async () => {
                  // WhatsApp accounts have no list query yet, so the account is
                  // still identified by its id.
                  const values = await askForm({
                    title: t(
                      'inventory.barcodeActions.setWhatsappQualityScore',
                    ),
                    fields: [
                      {
                        id: 'accountId',
                        name: 'accountId',
                        label: t('inventory.byRecord.whatsappAccountId', {
                          defaultValue: 'WhatsApp account ID',
                        }),
                        type: 'number',
                        required: true,
                        min: 1,
                      },
                      {
                        id: 'qualityScore',
                        name: 'qualityScore',
                        label: t('inventory.byRecord.qualityRating', {
                          defaultValue: 'Quality rating',
                        }),
                        type: 'select',
                        required: true,
                        defaultValue: 'UNKNOWN',
                        options: [
                          { value: 'GREEN', label: 'GREEN' },
                          { value: 'YELLOW', label: 'YELLOW' },
                          { value: 'RED', label: 'RED' },
                          { value: 'UNKNOWN', label: 'UNKNOWN' },
                        ],
                      },
                    ],
                  });
                  if (!values) return;
                  const accountId = formText(values.accountId);
                  const qualityScore = formText(values.qualityScore);
                  if (accountId == null || qualityScore == null) return;
                  await updateWhatsappQualityScore.mutateAsync({
                    accountId,
                    qualityScore,
                  });
                },
              },
              {
                id: 'delete-barcode-rule',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t('inventory.barcodeActions.confirmDelete'),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id == null) return;
                  await deleteBarcodeRule.mutateAsync(id);
                },
              },
            ],
          },
        },
      };
    }
    if (tab.id === 'barcode-nomenclatures') {
      return {
        ...tab,
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'create-barcode-nomenclature',
                label: t('inventory.barcodeNomenclatures.actions.create'),
                icon: Plus,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.barcodeNomenclatures.actions.create'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t(
                          'inventory.barcodeNomenclatures.actions.namePrompt',
                        ),
                        type: 'text',
                        required: true,
                      },
                    ],
                  });
                  const name = formText(values?.name);
                  if (name == null) return;
                  await createBarcodeNomenclature.mutateAsync({
                    name,
                    description: null,
                    is_default: false,
                    upc_ean_conv: 'none',
                    is_active: true,
                    metadata: null,
                  });
                },
              },
              {
                id: 'update-barcode-nomenclature',
                label: t('common.edit'),
                icon: Pencil,
                requiresSelection: true,
                onClick: async (rows) => {
                  const row = rows[0];
                  const nomenclatureId = row?.id as ScalarId | undefined;
                  if (nomenclatureId == null) return;
                  const values = await askForm({
                    title: t('common.edit'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t(
                          'inventory.barcodeNomenclatures.actions.namePrompt',
                        ),
                        type: 'text',
                        required: true,
                        defaultValue: String(row?.name ?? ''),
                      },
                    ],
                  });
                  const name = formText(values?.name);
                  if (name == null) return;
                  await updateBarcodeNomenclature.mutateAsync({
                    nomenclatureId,
                    params: { name, isActive: true },
                  });
                },
              },
              {
                id: 'add-rule-to-nomenclature',
                label: t('inventory.barcodeNomenclatures.actions.addRule'),
                icon: Plus,
                requiresSelection: true,
                onClick: async (rows) => {
                  const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                  if (nomenclatureId == null) return;
                  const values = await askForm({
                    title: t('inventory.barcodeNomenclatures.actions.addRule'),
                    fields: [
                      {
                        id: 'ruleId',
                        name: 'ruleId',
                        label: t('inventory.byRecord.barcodeRule', {
                          defaultValue: 'Barcode rule',
                        }),
                        type: 'select',
                        required: true,
                        options: barcodeRuleOptions,
                      },
                    ],
                  });
                  const ruleId = formText(values?.ruleId);
                  if (ruleId == null) return;
                  await addRuleToNomenclature.mutateAsync({
                    nomenclatureId,
                    ruleId,
                  });
                },
              },
              {
                id: 'remove-rule-from-nomenclature',
                label: t('inventory.barcodeNomenclatures.actions.removeRule'),
                icon: Pencil,
                requiresSelection: true,
                onClick: async (rows) => {
                  const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                  if (nomenclatureId == null) return;
                  const values = await askForm({
                    title: t(
                      'inventory.barcodeNomenclatures.actions.removeRule',
                    ),
                    fields: [
                      {
                        id: 'ruleId',
                        name: 'ruleId',
                        label: t('inventory.byRecord.barcodeRule', {
                          defaultValue: 'Barcode rule',
                        }),
                        type: 'select',
                        required: true,
                        options: barcodeRuleOptions,
                      },
                    ],
                  });
                  const ruleId = formNumber(values?.ruleId);
                  if (ruleId == null) return;
                  await removeRuleFromNomenclature.mutateAsync({
                    nomenclatureId,
                    ruleId,
                  });
                },
              },
              {
                id: 'delete-barcode-nomenclature',
                label: t('common.delete'),
                icon: Trash2,
                variant: 'destructive',
                requiresSelection: true,
                successMessage: t('common.actionCompleted', {
                  action: t('common.delete'),
                }),
                confirm: {
                  title: t('common.delete'),
                  description: t(
                    'inventory.barcodeNomenclatures.actions.confirmDelete',
                  ),
                  confirmLabel: t('common.confirm'),
                  cancelLabel: t('common.cancel'),
                },
                onClick: async (rows) => {
                  const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                  if (nomenclatureId == null) return;
                  await deleteBarcodeNomenclature.mutateAsync(nomenclatureId);
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
      deleteBarcodeRule,
      updateWhatsappQualityScore,
      createBarcodeNomenclature,
      updateBarcodeNomenclature,
      addRuleToNomenclature,
      removeRuleFromNomenclature,
      deleteBarcodeNomenclature,
    ].some((mutation) => mutation.isPending),
  };
}
