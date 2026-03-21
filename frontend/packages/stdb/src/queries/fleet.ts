import { getStdbConnection } from "../connection";

// ── Row types (using `any` until bindings are regenerated after publish) ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FleetVehicle = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PosTerminal = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WarehouseGeo = Record<string, any>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function fleetSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM fleet_vehicle WHERE organization_id = ${id}`,
    `SELECT * FROM pos_terminal WHERE organization_id = ${id}`,
    `SELECT * FROM warehouse_geo WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryFleetVehicles(): FleetVehicle[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.fleet_vehicle) return [];
  return [...db.fleet_vehicle.iter()].sort((a: FleetVehicle, b: FleetVehicle) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function queryPosTerminals(): PosTerminal[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.pos_terminal) return [];
  return [...db.pos_terminal.iter()].sort((a: PosTerminal, b: PosTerminal) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function queryWarehouseGeo(): WarehouseGeo[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.warehouse_geo) return [];
  return [...db.warehouse_geo.iter()];
}
