/** Loose row shape from `/api/query/fleet-vehicles`. */
export type FleetVehicleQueryRow = Record<string, unknown>;

/** Primary label for fleet vehicle rows (name, then license plate). */
export function fleetVehiclePrimaryLabel(row: FleetVehicleQueryRow): string {
  return primaryLabel([row.name, row.licensePlate, row.license_plate], row.id);
}
import { primaryLabel } from "./primary-label";
