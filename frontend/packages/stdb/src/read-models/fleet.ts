/** Loose row shape from `/api/query/fleet-vehicles`. */
export type FleetVehicleQueryRow = Record<string, unknown>;

/** Primary label for fleet vehicle rows (name, then license plate). */
export function fleetVehiclePrimaryLabel(row: FleetVehicleQueryRow): string {
  const candidates = [row.name, row.licensePlate, row.license_plate];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
