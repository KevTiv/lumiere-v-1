'use client';
import { useTranslation } from '@lumiere/i18n';
import { newQualityCheckForm, mergeSelectOptionsForFields } from '@lumiere/ui';
import { formNumber, formText, useFormDialog } from '@lumiere/ui';
import type { EntityTableConfig, SelectField } from '@lumiere/ui';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { useQualityCheckFailWorkflow } from '@lumiere/query-hooks/hooks/quality-check-fail-workflow';
import {
  usePassQualityCheck,
  useUpdateQualityPoint,
  useUpdateQualityTeam,
  useStartQualityCheck,
  useCreateQualityAlertReason,
  useUpdateQualityAlertReason,
  useDeleteQualityAlertReason,
  useAddMemberToQualityTeam,
  useRemoveMemberFromQualityTeam,
  useLinkDeviceToQualityCheck,
} from '@lumiere/query-hooks/hooks/inventory';
import { productRowsToSelectOptions } from '@/lib/form-lookup';
import {
  ListChecks,
  Pencil,
  Plus,
  ShieldCheck,
  AlertTriangle,
  ScanLine,
} from 'lucide-react';
import type { Product, Warehouse } from '@lumiere/stdb/types';
import type { InventoryTab, ScalarId } from './inventory-tab-actions';
import { rowState } from './inventory-tab-actions';

interface QualityCheckTabActionsOptions {
  orgId: bigint;
  operatingCompanyId: bigint;
  selectedOperatingCompanyId: bigint | undefined;
  askForm: ReturnType<typeof useFormDialog>['askForm'];
  workflowSurface: ReturnType<typeof useWorkflowSurface>;
  products: Product[];
  warehouses: Warehouse[];
  qualityTeamOptions: SelectField['options'];
  stockOnHandLocationOptions: SelectField['options'];
  iotDeviceOptions: SelectField['options'];
  setActiveTab: (tab: string) => void;
  setCreateQualityAlertOpen: (open: boolean) => void;
}

export function useQualityCheckTabActions({
  orgId,
  operatingCompanyId,
  selectedOperatingCompanyId,
  askForm,
  workflowSurface,
  products,
  warehouses,
  qualityTeamOptions,
  stockOnHandLocationOptions,
  iotDeviceOptions,
  setActiveTab,
  setCreateQualityAlertOpen,
}: QualityCheckTabActionsOptions) {
  const { t } = useTranslation();
  const passQualityCheck = usePassQualityCheck(orgId, operatingCompanyId);
  const failQualityCheck = useQualityCheckFailWorkflow(
    orgId,
    operatingCompanyId ?? 0n,
    workflowSurface,
  );
  const startQualityCheck = useStartQualityCheck(
    orgId,
    selectedOperatingCompanyId,
  );
  const linkDeviceToQualityCheck = useLinkDeviceToQualityCheck(orgId);
  const createQualityAlertReason = useCreateQualityAlertReason(orgId);
  const updateQualityAlertReason = useUpdateQualityAlertReason(orgId);
  const deleteQualityAlertReason = useDeleteQualityAlertReason(orgId);
  const addMemberToQualityTeam = useAddMemberToQualityTeam(orgId);
  const removeMemberFromQualityTeam = useRemoveMemberFromQualityTeam(orgId);
  const updateQualityPoint = useUpdateQualityPoint(orgId, operatingCompanyId);
  const updateQualityTeam = useUpdateQualityTeam(orgId, operatingCompanyId);
  function configureTab(tab: InventoryTab): InventoryTab {
    if (
      tab.type !== 'entity' ||
      !tab.entityConfig ||
      tab.entityConfig.view.mode !== 'table'
    )
      return tab;
    const v = tab.entityConfig.view as EntityTableConfig;
    if (tab.id === 'quality') {
      return {
        ...tab,
        createAction: 'createQualityCheck',
        createForm: mergeSelectOptionsForFields(newQualityCheckForm(t), {
          productId: productRowsToSelectOptions(products),
          teamId: [...qualityTeamOptions],
        }),
        entityConfig: {
          ...tab.entityConfig,
          view: {
            ...v,
            actions: [
              {
                id: 'quality-alerts-tab',
                label: t('inventory.qualityAlerts.tabLabel'),
                icon: AlertTriangle,
                requiresSelection: false,
                onClick: () => setActiveTab('quality-alerts'),
              },
              {
                id: 'create-quality-alert',
                label: t('inventory.forms.newQualityAlert.title'),
                icon: Plus,
                requiresSelection: false,
                onClick: () => setCreateQualityAlertOpen(true),
              },
              {
                id: 'pass-check',
                label: t('inventory.qualityActions.pass'),
                icon: ShieldCheck,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every(
                    (row) => !['completed'].includes(rowState(row, 'status')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.qualityActions.pass'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null)
                    await passQualityCheck.mutateAsync({ checkId: id });
                },
              },
              {
                id: 'fail-check',
                label: t('inventory.qualityActions.fail'),
                icon: AlertTriangle,
                variant: 'destructive',
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every(
                    (row) => !['completed'].includes(rowState(row, 'status')),
                  ),
                onClick: async (rows) => {
                  const row = rows[0];
                  const id = row?.id;
                  const productId = row?.productId;
                  const companyId = row?.companyId;
                  const lotId = row?.lotId;
                  if (id == null || productId == null || companyId == null)
                    return;
                  const quarantineWarehouse = warehouses.find(
                    (w) => w.whQcStockLocId != null,
                  );
                  const configuredQuarantineLocationId =
                    quarantineWarehouse?.whQcStockLocId;
                  // No warehouse in this org has a configured QC location yet
                  // (wh_qc_stock_loc_id is create-only, never set by seed data
                  // or update_warehouse) — ask the operator which location the
                  // failed stock quarantines to.
                  const values = await askForm({
                    title: t('inventory.qualityActions.fail'),
                    submitLabel: t('inventory.qualityActions.fail'),
                    fields: [
                      ...(configuredQuarantineLocationId == null
                        ? [
                            {
                              id: 'quarantineLocationId',
                              name: 'quarantineLocationId',
                              label: t(
                                'inventory.byRecord.quarantineLocation',
                                { defaultValue: 'Quarantine location' },
                              ),
                              type: 'select' as const,
                              required: true,
                              options: stockOnHandLocationOptions,
                            },
                          ]
                        : []),
                      {
                        id: 'reason',
                        name: 'reason',
                        label: t('inventory.byRecord.failReason', {
                          defaultValue: 'Reason for failure',
                        }),
                        type: 'textarea' as const,
                        rows: 3,
                      },
                    ],
                  });
                  if (!values) return;
                  const quarantineLocationId =
                    configuredQuarantineLocationId ??
                    formText(values.quarantineLocationId);
                  if (quarantineLocationId == null) return;
                  await failQualityCheck.fail(
                    {
                      checkId: String(id),
                      productId: String(productId),
                      lotId: lotId != null ? String(lotId) : undefined,
                      companyId: String(companyId),
                      quarantineLocationId: String(quarantineLocationId),
                      qtyFailed: 1,
                      note: formText(values.reason),
                    },
                    { navigateToNext: true },
                  );
                },
              },
              {
                id: 'start-check',
                label: t('inventory.qualityActions.startCheck'),
                icon: ListChecks,
                requiresSelection: true,
                isApplicable: (rows) =>
                  rows.every((row) =>
                    ['draft'].includes(rowState(row, 'status')),
                  ),
                successMessage: t('common.actionCompleted', {
                  action: t('inventory.qualityActions.startCheck'),
                }),
                onClick: async (rows) => {
                  const id = rows[0]?.id as ScalarId | undefined;
                  if (id != null) await startQualityCheck.mutateAsync(id);
                },
              },
              {
                id: 'link-device-check',
                label: t('inventory.qualityActions.linkDevice'),
                icon: ScanLine,
                requiresSelection: true,
                onClick: async (rows) => {
                  const checkId = rows[0]?.id as ScalarId | undefined;
                  if (checkId == null) return;
                  const values = await askForm({
                    title: t('inventory.qualityActions.linkDevice'),
                    fields: [
                      {
                        id: 'deviceId',
                        name: 'deviceId',
                        label: t('inventory.byRecord.device', {
                          defaultValue: 'IoT device',
                        }),
                        type: 'select',
                        required: true,
                        options: iotDeviceOptions,
                      },
                    ],
                  });
                  const deviceId = formNumber(values?.deviceId);
                  if (deviceId == null) return;
                  await linkDeviceToQualityCheck.mutateAsync({
                    deviceId,
                    checkId,
                  });
                },
              },
              {
                id: 'add-alert-reason',
                label: t('inventory.qualityActions.addAlertReason'),
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.addAlertReason'),
                    fields: [
                      {
                        id: 'name',
                        name: 'name',
                        label: t(
                          'inventory.qualityActions.alertReasonNamePrompt',
                        ),
                        type: 'text',
                        required: true,
                      },
                      {
                        id: 'description',
                        name: 'description',
                        label: t(
                          'inventory.qualityActions.alertReasonDescPrompt',
                        ),
                        type: 'textarea',
                        rows: 3,
                      },
                    ],
                  });
                  const name = formText(values?.name);
                  if (name == null) return;
                  await createQualityAlertReason.mutateAsync({
                    name,
                    description: formText(values?.description) ?? null,
                  });
                },
              },
              {
                id: 'update-alert-reason',
                label: t('inventory.qualityActions.updateAlertReason'),
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.updateAlertReason'),
                    fields: [
                      {
                        id: 'recordId',
                        name: 'recordId',
                        label: t('inventory.byRecord.reasonId', {
                          defaultValue: 'Alert reason ID',
                        }),
                        type: 'number',
                        required: true,
                        min: 1,
                      },
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.byRecord.name', {
                          defaultValue: 'Name',
                        }),
                        type: 'text',
                        required: true,
                      },
                    ],
                  });
                  if (!values) return;
                  await updateQualityAlertReason.mutateAsync({
                    reasonId: Number(values.recordId),
                    params: { name: formText(values.name) ?? null },
                  });
                },
              },
              {
                id: 'delete-alert-reason',
                label: t('inventory.qualityActions.deleteAlertReason'),
                variant: 'destructive',
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.deleteAlertReason'),
                    submitLabel: t('common.delete'),
                    fields: [
                      {
                        id: 'recordId',
                        name: 'recordId',
                        label: t('inventory.byRecord.reasonId', {
                          defaultValue: 'Alert reason ID',
                        }),
                        type: 'number',
                        required: true,
                        min: 1,
                      },
                    ],
                  });
                  if (!values) return;
                  await deleteQualityAlertReason.mutateAsync(
                    Number(values.recordId),
                  );
                },
              },
              {
                id: 'add-team-member',
                label: t('inventory.qualityActions.addTeamMember'),
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.addTeamMember'),
                    fields: [
                      {
                        id: 'teamId',
                        name: 'teamId',
                        label: t('inventory.byRecord.team', {
                          defaultValue: 'Quality team',
                        }),
                        type: 'select',
                        required: true,
                        options: qualityTeamOptions.filter(
                          (option) => option.value !== '',
                        ),
                      },
                      {
                        id: 'member',
                        name: 'member',
                        label: t('inventory.byRecord.member', {
                          defaultValue: 'Member identity',
                        }),
                        type: 'text',
                        required: true,
                      },
                    ],
                  });
                  if (!values) return;
                  await addMemberToQualityTeam.mutateAsync({
                    teamId: Number(values.teamId),
                    memberIdentityHex: String(values.member).trim(),
                  });
                },
              },
              {
                id: 'update-quality-point',
                label: t('inventory.qualityActions.updatePoint'),
                icon: Pencil,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.updatePoint'),
                    fields: [
                      {
                        id: 'recordId',
                        name: 'recordId',
                        label: t('inventory.byRecord.pointId', {
                          defaultValue: 'Quality point ID',
                        }),
                        type: 'number',
                        required: true,
                        min: 1,
                      },
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.byRecord.name', {
                          defaultValue: 'Name',
                        }),
                        type: 'text',
                      },
                      {
                        id: 'testType',
                        name: 'testType',
                        label: t('inventory.byRecord.testType', {
                          defaultValue: 'Test type',
                        }),
                        type: 'text',
                      },
                    ],
                  });
                  if (!values) return;
                  const name = formText(values.name);
                  const testType = formText(values.testType);
                  if (name == null && testType == null) return;
                  await updateQualityPoint.mutateAsync({
                    pointId: Number(values.recordId),
                    params: { name, testType },
                  });
                },
              },
              {
                id: 'update-quality-team',
                label: t('inventory.qualityActions.updateTeam'),
                icon: Pencil,
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.updateTeam'),
                    fields: [
                      {
                        id: 'teamId',
                        name: 'teamId',
                        label: t('inventory.byRecord.team', {
                          defaultValue: 'Quality team',
                        }),
                        type: 'select',
                        required: true,
                        options: qualityTeamOptions.filter(
                          (option) => option.value !== '',
                        ),
                      },
                      {
                        id: 'name',
                        name: 'name',
                        label: t('inventory.byRecord.name', {
                          defaultValue: 'Name',
                        }),
                        type: 'text',
                      },
                      {
                        id: 'email',
                        name: 'email',
                        label: t('inventory.byRecord.email', {
                          defaultValue: 'Email',
                        }),
                        type: 'email',
                      },
                    ],
                  });
                  if (!values) return;
                  const name = formText(values.name);
                  const email = formText(values.email);
                  if (name == null && email == null) return;
                  await updateQualityTeam.mutateAsync({
                    teamId: Number(values.teamId),
                    params: { name, email },
                  });
                },
              },
              {
                id: 'remove-team-member',
                label: t('inventory.qualityActions.removeTeamMember'),
                variant: 'destructive',
                requiresSelection: false,
                onClick: async () => {
                  const values = await askForm({
                    title: t('inventory.qualityActions.removeTeamMember'),
                    submitLabel: t('common.remove', { defaultValue: 'Remove' }),
                    fields: [
                      {
                        id: 'teamId',
                        name: 'teamId',
                        label: t('inventory.byRecord.team', {
                          defaultValue: 'Quality team',
                        }),
                        type: 'select',
                        required: true,
                        options: qualityTeamOptions.filter(
                          (option) => option.value !== '',
                        ),
                      },
                      {
                        id: 'member',
                        name: 'member',
                        label: t('inventory.byRecord.member', {
                          defaultValue: 'Member identity',
                        }),
                        type: 'text',
                        required: true,
                      },
                    ],
                  });
                  if (!values) return;
                  await removeMemberFromQualityTeam.mutateAsync({
                    teamId: Number(values.teamId),
                    memberIdentityHex: String(values.member).trim(),
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
      passQualityCheck,
      failQualityCheck,
      startQualityCheck,
      linkDeviceToQualityCheck,
      createQualityAlertReason,
      updateQualityAlertReason,
      deleteQualityAlertReason,
      addMemberToQualityTeam,
      removeMemberFromQualityTeam,
      updateQualityPoint,
      updateQualityTeam,
    ].some((mutation) => mutation.isPending),
  };
}
