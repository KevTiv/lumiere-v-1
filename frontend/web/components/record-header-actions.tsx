'use client';

import { useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { Button, FormModal, type FormConfig, useUnsavedChangesGuard } from '@lumiere/ui';
import { useConfirmDialog } from '@lumiere/ui/hooks/use-confirm-dialog';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { variantTag } from '@lumiere/erp-workflows';
import { recordField, useUnreservePicking, useUpdatePickingHeader, useUpdateManufacturingHeader, useUpdateFleetDetails } from '@lumiere/query-hooks/hooks/pass9-record-actions';
import { useRBAC } from '@/lib/rbac-context';

type Model = 'transfer' | 'manufacturing' | 'vehicle';

/** Pass 9 header commands share a real save dialog with pending/error protection. */
export function RecordHeaderActions({ model, record, organizationId, companyId }: {
  model: Model; record: object; organizationId: bigint; companyId?: bigint;
}) {
  const { t } = useTranslation();
  const { checkPermission } = useRBAC();
  const [open, setOpen] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const unreserve = useUnreservePicking(organizationId, companyId);
  const picking = useUpdatePickingHeader(organizationId, companyId);
  const manufacturing = useUpdateManufacturingHeader(organizationId, companyId);
  const vehicle = useUpdateFleetDetails(organizationId, companyId);
  const mutation = model === 'transfer' ? picking : model === 'manufacturing' ? manufacturing : vehicle;
  const pendingGuard = useUnsavedChangesGuard(false, unreserve.isPending);
  const state = variantTag(recordField(record, 'state')).toLowerCase();
  const resource = model === 'transfer' ? 'stock_picking' : model === 'manufacturing' ? 'mrp_production' : 'fleet_vehicle';
  if (!checkPermission(resource, 'write').allowed || companyId == null || companyId <= 0n) return null;
  const id = BigInt(String(recordField(record, 'id')));
  const text = (key: string) => String(recordField(record, key) ?? '');
  const label = t(`recordHeader.edit.${model}`);
  const config: FormConfig = {
    id: `edit-${model}-header`, title: label, submitLabel: t('common.save'),
    sections: [{ id: 'header', fields: model === 'transfer' ? [
      { id: 'origin', name: 'origin', label: t('recordHeader.origin'), type: 'text', defaultValue: text('origin') },
      { id: 'note', name: 'note', label: t('recordHeader.note'), type: 'textarea', defaultValue: text('note') },
    ] : model === 'manufacturing' ? [
      { id: 'productQty', name: 'productQty', label: t('recordHeader.quantity'), type: 'number', required: true, defaultValue: Number(recordField(record, 'productQty')), validation: { custom: (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? null : t('recordHeader.positiveQuantity') } },
    ] : [
      { id: 'name', name: 'name', label: t('recordHeader.name'), type: 'text', required: true, defaultValue: text('name') },
      { id: 'vehicleType', name: 'vehicleType', label: t('recordHeader.vehicleType'), type: 'text', required: true, defaultValue: text('vehicleType') },
      { id: 'licensePlate', name: 'licensePlate', label: t('recordHeader.licensePlate'), type: 'text', defaultValue: text('licensePlate') },
      { id: 'driverName', name: 'driverName', label: t('recordHeader.driverName'), type: 'text', defaultValue: text('driverName') },
      { id: 'odometerKm', name: 'odometerKm', label: t('recordHeader.odometerKm'), type: 'number', defaultValue: recordField(record, 'odometerKm') == null ? undefined : Number(recordField(record, 'odometerKm')), validation: { min: 0 } },
      { id: 'fuelLevel', name: 'fuelLevel', label: t('recordHeader.fuelLevel'), type: 'number', defaultValue: recordField(record, 'fuelLevel') == null ? undefined : Number(recordField(record, 'fuelLevel')), validation: { min: 0, max: 1 } },
    ] }],
  };
  const runUnreserve = async () => {
    if (!await confirm({ title: t('recordHeader.unreserve'), description: t('recordHeader.unreserveDescription') })) return;
    try {
      await unreserve.mutateAsync(id);
      showWorkflowToast({ kind: 'success', title: t('recordHeader.unreserve') });
    } catch (error) {
      showWorkflowToast({ kind: 'error', title: t('recordHeader.unreserve'), description: error instanceof Error ? error.message : String(error) });
    }
  };
  return <>
    {(model === 'vehicle' || state === 'draft') ? <Button variant="outline" size="sm" data-testid={`${model}-action-edit-header`} disabled={mutation.isPending} onClick={() => setOpen(true)}>{label}</Button> : null}
    {model === 'transfer' && state === 'assigned' ? <Button variant="outline" size="sm" data-testid="transfer-action-unreserve" disabled={unreserve.isPending} onClick={() => void runUnreserve()}>{t('recordHeader.unreserve')}</Button> : null}
    {open ? <FormModal open config={config} isPending={mutation.isPending} onOpenChange={setOpen} onSubmit={async (values) => {
      if (model === 'transfer') await picking.mutateAsync({ pickingId: id, origin: String(values.origin ?? ''), note: String(values.note ?? '') });
      else if (model === 'manufacturing') await manufacturing.mutateAsync({ moId: id, productQty: Number(values.productQty) });
      else await vehicle.mutateAsync({ vehicleId: id, name: String(values.name).trim(), vehicleType: String(values.vehicleType).trim(), licensePlate: String(values.licensePlate ?? '').trim() || null, driverName: String(values.driverName ?? '').trim() || null, odometerKm: values.odometerKm == null || values.odometerKm === '' ? null : Number(values.odometerKm), fuelLevel: values.fuelLevel == null || values.fuelLevel === '' ? null : Number(values.fuelLevel) });
    }} /> : null}
    {dialog}
    {pendingGuard}
  </>;
}
