import {
  useCreateFleetVehicle,
  useRecordFleetInspection,
  useRecordFleetService,
  useUpdateFleetVehicleDriver,
  type FleetInspectionOutcome,
} from '@lumiere/query-hooks/hooks/fleet';

type FormData = Record<string, unknown>;

export type FleetAction =
  | 'createFleetVehicle'
  | 'assignFleetDriver'
  | 'recordFleetService'
  | 'recordFleetInspection';

const optionalDate = (value: unknown) => {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const optionalNumber = (value: unknown) => {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optionalText = (value: unknown) =>
  value != null && String(value).trim() !== '' ? String(value).trim() : null;

/**
 * The fleet forms' submit handlers: turns a form's values into the vehicle, driver, service and
 * inspection commands. Shared by the Fleet list and the vehicle page.
 */
export function useFleetActions(orgId: bigint, companyId: bigint | undefined) {
  const createVehicle = useCreateFleetVehicle(orgId, companyId);
  const updateDriver = useUpdateFleetVehicleDriver(orgId, companyId);
  const recordService = useRecordFleetService(orgId, companyId);
  const recordInspection = useRecordFleetInspection(orgId, companyId);

  const submit = async (action: string, formData: FormData): Promise<void> => {
    if (action === 'createFleetVehicle') {
      await createVehicle.mutateAsync({
        name: String(formData.name ?? ''),
        vehicleType: String(formData.vehicle_type ?? 'truck'),
        licensePlate: optionalText(formData.license_plate),
        driverName: optionalText(formData.driver_name),
      });
    } else if (action === 'assignFleetDriver') {
      const driverId = String(formData.driver_id ?? '');
      await updateDriver.mutateAsync({
        vehicleId: BigInt(String(formData.vehicle_id)),
        driverId: driverId === 'unassigned' ? null : BigInt(driverId),
      });
    } else if (action === 'recordFleetService') {
      await recordService.mutateAsync({
        vehicleId: BigInt(String(formData.vehicle_id)),
        serviceTypeId: BigInt(String(formData.service_type_id)),
        servicedAt: optionalDate(formData.serviced_at),
        odometerKm: optionalNumber(formData.odometer_km),
        provider: String(formData.provider ?? ''),
        notes: String(formData.notes ?? ''),
        costAmount: Number(formData.cost_amount),
        journalId: BigInt(String(formData.journal_id)),
        expenseAccountId: BigInt(String(formData.expense_account_id)),
        offsetAccountId: BigInt(String(formData.offset_account_id)),
        clientRequestId: crypto.randomUUID(),
      });
    } else if (action === 'recordFleetInspection') {
      const inspectorId = String(formData.inspector_id ?? '').trim();
      await recordInspection.mutateAsync({
        vehicleId: BigInt(String(formData.vehicle_id)),
        inspectorId: inspectorId ? BigInt(inspectorId) : undefined,
        inspectedAt: optionalDate(formData.inspected_at),
        outcome: String(formData.outcome ?? 'passed') as FleetInspectionOutcome,
        odometerKm: optionalNumber(formData.odometer_km),
        notes: String(formData.notes ?? ''),
        clientRequestId: crypto.randomUUID(),
      });
    }
  };

  const isPending =
    createVehicle.isPending || updateDriver.isPending || recordService.isPending || recordInspection.isPending;

  return { submit, isPending };
}
