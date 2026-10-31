import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types";
import { fleetEnumTag } from "./fleet-record";

function optionalValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return value.some;
    if ("none" in value) return null;
  }
  return value;
}

/** Client-side narrowing of authorized reads, never a substitute for server policy. */
export function fleetCompanyRows<RowType extends EntityRow>(
  rows: readonly RowType[],
  organizationId: bigint,
  companyId: bigint | undefined,
  allowOrganizationWide = false,
): RowType[] {
  if (organizationId <= 0n || companyId == null || companyId <= 0n) return [];
  return rows.filter((row) => {
    const organization = parseStrictU64(
      row.organization_id ?? row.organizationId,
    );
    const company = optionalValue(
      "company_id" in row ? row.company_id : row.companyId,
    );
    return (
      organization === organizationId &&
      (parseStrictU64(company) === companyId ||
        (allowOrganizationWide && company === null))
    );
  });
}

function field(row: EntityRow, snake: string, camel: string): unknown {
  return snake in row ? row[snake] : row[camel];
}

export function fleetVehicleRows(rows: readonly EntityRow[]): EntityRow[] {
  return rows.map((row) => ({
    ...row,
    license_plate: optionalValue(field(row, "license_plate", "licensePlate")),
    vehicle_type: row.vehicle_type ?? row.vehicleType,
    driver_name: optionalValue(field(row, "driver_name", "driverName")),
    odometer_km: optionalValue(field(row, "odometer_km", "odometerKm")),
    last_position_at: optionalValue(
      field(row, "last_position_at", "lastPositionAt"),
    ),
    status: fleetEnumTag(row.status).toLowerCase(),
  }));
}

function rowNames(
  rows: readonly EntityRow[],
  field = "name",
): Map<string, string> {
  return new Map(
    rows.flatMap((row) => {
      const id = parseStrictU64(row.id);
      const label = String(
        row[field] ?? row.display_name ?? row.displayName ?? "",
      ).trim();
      return id != null && label ? [[id.toString(), label] as const] : [];
    }),
  );
}

/** Names come only from the caller's usable scoped collections; absent labels retain the exact id. */
export function fleetHistoryRows(
  rows: readonly EntityRow[],
  lookups: {
    vehicles: readonly EntityRow[];
    serviceTypes: readonly EntityRow[];
    employees: readonly EntityRow[];
    currencies: readonly EntityRow[];
  },
): EntityRow[] {
  const vehicles = rowNames(lookups.vehicles);
  const serviceTypes = rowNames(lookups.serviceTypes);
  const employees = rowNames(lookups.employees);
  const currencies = rowNames(lookups.currencies, "code");
  const named = (value: unknown, names: Map<string, string>) => {
    const id = parseStrictU64(optionalValue(value));
    return id == null ? "—" : (names.get(id.toString()) ?? `#${id}`);
  };
  return rows.map((row) => ({
    ...row,
    vehicle_name: named(row.vehicle_id ?? row.vehicleId, vehicles),
    service_type_name: named(
      row.service_type_id ?? row.serviceTypeId,
      serviceTypes,
    ),
    inspector_name: named(row.inspector_id ?? row.inspectorId, employees),
    currency_name: named(row.currency_id ?? row.currencyId, currencies),
    cost_amount: optionalValue(field(row, "cost_amount", "costAmount")),
    account_move_id: optionalValue(
      field(row, "account_move_id", "accountMoveId"),
    ),
    serviced_at: row.serviced_at ?? row.servicedAt,
    inspected_at: row.inspected_at ?? row.inspectedAt,
    odometer_km: optionalValue(field(row, "odometer_km", "odometerKm")),
    outcome: fleetEnumTag(row.outcome).toLowerCase(),
  }));
}

/** Facets describe the scoped dataset; no guessed vehicle categories are offered. */
export function fleetVehicleTypes(rows: readonly EntityRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => String(row.vehicle_type ?? row.vehicleType ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
