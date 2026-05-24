import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Manufacturing mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` manufacturing hooks.
 */
export const MANUFACTURING_BFF_REDUCERS = [
  "block_workcenter",
  "cancel_manufacturing_order",
  "check_mo_availability",
  "complete_productivity_log",
  "compute_bom_cost",
  "confirm_manufacturing_order",
  "consume_mo_materials",
  "create_bom",
  "create_manufacturing_order",
  "create_routing_workcenter",
  "create_workcenter",
  "create_workorder",
  "delete_bom",
  "explode_bom",
  "finish_manufacturing_order",
  "finish_workorder",
  "import_bom_csv",
  "import_bom_line_csv",
  "import_manufacturing_order_csv",
  "import_workcenter_csv",
  "link_device_to_workcenter",
  "log_workcenter_productivity",
  "produce_manufacturing_order",
  "start_manufacturing_order",
  "start_workorder",
  "unblock_workcenter",
  "update_bom",
  "update_workcenter",
] as const;

export type ManufacturingBffReducerKey =
  (typeof MANUFACTURING_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ManufacturingBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function manufacturingBffCallUrl(
  reducer: ManufacturingBffReducerKey,
): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function manufacturingBffPost(
  reducer: ManufacturingBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: manufacturingBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Mirrors hook invalidation targets where explicit (TanStack uses query keys separately). */
const MANUFACTURING_HINT_OVERRIDES: Partial<
  Record<ManufacturingBffReducerKey, readonly string[]>
> = {
  block_workcenter: ["mrp-workcenters"],
  cancel_manufacturing_order: ["mrp-productions"],
  check_mo_availability: ["mrp-productions"],
  complete_productivity_log: ["mrp-workcenters"],
  compute_bom_cost: ["mrp-boms", "mrp-bom-lines"],
  confirm_manufacturing_order: ["mrp-productions"],
  consume_mo_materials: ["mrp-productions"],
  create_bom: ["mrp-boms", "mrp-bom-lines"],
  create_manufacturing_order: ["mrp-productions"],
  create_routing_workcenter: ["mrp-routing-workcenters", "mrp-workcenters"],
  create_workcenter: ["mrp-workcenters"],
  create_workorder: ["mrp-workorders", "mrp-productions"],
  delete_bom: ["mrp-boms", "mrp-bom-lines"],
  explode_bom: ["mrp-boms", "mrp-bom-lines"],
  finish_manufacturing_order: ["mrp-productions"],
  finish_workorder: ["mrp-workorders"],
  import_bom_csv: ["mrp-boms", "mrp-bom-lines"],
  import_bom_line_csv: ["mrp-boms", "mrp-bom-lines"],
  import_manufacturing_order_csv: ["mrp-productions"],
  import_workcenter_csv: ["mrp-workcenters"],
  link_device_to_workcenter: ["iot-devices"],
  log_workcenter_productivity: ["mrp-workcenters"],
  produce_manufacturing_order: ["mrp-productions"],
  start_manufacturing_order: ["mrp-productions"],
  start_workorder: ["mrp-workorders"],
  unblock_workcenter: ["mrp-workcenters"],
  update_bom: ["mrp-boms", "mrp-bom-lines"],
  update_workcenter: ["mrp-workcenters"],
};

function manufacturingReducerHints(): Record<
  ManufacturingBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<ManufacturingBffReducerKey, readonly string[]>;
  for (const k of MANUFACTURING_BFF_REDUCERS) {
    o[k] = MANUFACTURING_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const MANUFACTURING_COMMAND_SUBSCRIPTION_HINTS: Record<
  ManufacturingBffReducerKey,
  readonly string[]
> = manufacturingReducerHints();

export function manufacturingCommandContract(
  reducer: ManufacturingBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Manufacturing reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      MANUFACTURING_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
