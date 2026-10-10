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

/** Adds `vehicle_name` to service/inspection rows (falls back to `#id` when the vehicle is unknown). */
export function withVehicleNames<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  vehicles: ReadonlyArray<Record<string, unknown>>,
): Array<T & { vehicle_name: string }> {
  const names = new Map<string, string>();
  for (const vehicle of vehicles) {
    const name = String(vehicle.name ?? '').trim();
    if (vehicle.id != null && name) names.set(String(vehicle.id), name);
  }
  return rows.map((row) => {
    const id = String(row.vehicle_id ?? row.vehicleId ?? '');
    return { ...row, vehicle_name: names.get(id) ?? (id ? `#${id}` : '') };
  });
}

/** Swaps the numeric `vehicle_id` column of a table config for the text `vehicle_name` column. */
export function showVehicleNameColumn<C extends { key: string; type?: string; align?: string }>(columns: ReadonlyArray<C>): C[] {
  return columns.map((column) => {
    if (column.key !== 'vehicle_id') return column;
    const { type: _type, align: _align, ...rest } = column;
    return { ...rest, key: 'vehicle_name' } as C;
  });
}
