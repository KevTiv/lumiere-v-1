/** Where a fleet vehicle's page lives. */
export function fleetVehicleRecordHref(vehicle: Record<string, unknown>): string | undefined {
  return vehicle.id == null ? undefined : `/fleet/vehicles/${String(vehicle.id)}`;
}

/** Lower-cased tag of an enum cell (`{ tag }`, `{ Active: [] }`) or plain string. */
export function fleetEnumTag(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('tag' in value && typeof (value as { tag: unknown }).tag === 'string') return (value as { tag: string }).tag;
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0]!;
  }
  return '';
}

/** The rows of a related list (service records, inspections) that belong to one vehicle. */
export function rowsOfVehicle(rows: ReadonlyArray<Record<string, unknown>>, vehicleId: string): Record<string, unknown>[] {
  return rows.filter((row) => String(row.vehicle_id ?? row.vehicleId ?? '') === vehicleId);
}
