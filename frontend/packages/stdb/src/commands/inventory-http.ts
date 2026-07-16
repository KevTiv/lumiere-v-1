import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Inventory mutations via Next.js BFF POST /api/call/:reducer.
 * Keys match SpacetimeDB reducer snake_case names used by @lumiere/query-hooks inventory hooks.
 * Only real module reducers — no forward-compat phantoms.
 */
export const INVENTORY_BFF_REDUCERS = [
  "activate_consignment_agreement",
  "add_member_to_quality_team",
  "add_rule_to_nomenclature",
  "assign_quality_alert",
  "assign_stock_move",
  "assign_stock_picking",
  "assign_user_to_picking",
  "block_serial",
  "cancel_quality_alert",
  "cancel_stock_move",
  "cancel_stock_picking",
  "complete_picking_wave",
  "confirm_stock_move",
  "confirm_stock_picking",
  "create_adjustment_reason",
  "create_barcode_nomenclature",
  "create_barcode_rule",
  "create_cycle_count_plan",
  "create_inventory_adjustment",
  "create_inventory_close",
  "create_inventory_integration_intent",
  "create_packaging_material",
  "create_picking_wave",
  "create_product",
  "create_product_category",
  "create_product_packaging",
  "create_product_supplier_info",
  "create_product_variant",
  "create_quality_alert",
  "create_quality_alert_reason",
  "create_quality_check",
  "create_quality_point",
  "create_quality_team",
  "create_replenishment_rule",
  "create_stock_inventory",
  "create_stock_inventory_line",
  "create_stock_location",
  "create_stock_move",
  "create_stock_picking",
  "create_stock_production_lot",
  "create_stock_production_serial",
  "create_stock_quant",
  "create_stock_route",
  "create_stock_rule",
  "create_traceability_record",
  "create_traceability_report",
  "create_uom",
  "create_uom_category",
  "create_uom_conversion",
  "create_warehouse",
  "create_warehouse_3d_zone",
  "create_warehouse_task",
  "delete_barcode_nomenclature",
  "delete_barcode_rule",
  "delete_product",
  "delete_product_category",
  "delete_quality_alert_reason",
  "delete_quality_point",
  "delete_quality_team",
  "delete_stock_location",
  "delete_stock_production_lot",
  "delete_stock_production_serial",
  "delete_stock_route",
  "delete_stock_rule",
  "delete_warehouse",
  "delete_warehouse_3d_zone",
  "done_stock_move",
  "execute_cross_dock",
  "execute_directed_putaway",
  "execute_replenishment_rule",
  "fail_quality_check",
  "import_lot_csv",
  "import_product_category_csv",
  "import_product_csv",
  "import_product_variant_csv",
  "import_stock_location_csv",
  "import_stock_quant_csv",
  "import_uom_category_csv",
  "import_uom_csv",
  "import_warehouse_csv",
  "link_device_to_quality_check",
  "move_stock_quant",
  "open_quality_alert",
  "pass_quality_check",
  "post_cycle_count_adjustments",
  "process_inventory_adjustment",
  "record_barcode_scan",
  "record_cycle_count_line",
  "receive_consignment_stock",
  "record_inventory_integration_result",
  "remove_member_from_quality_team",
  "remove_rule_from_nomenclature",
  "release_picking_wave",
  "reopen_inventory_close",
  "reserve_serial",
  "run_cartonization",
  "run_inventory_close",
  "reserve_stock_quant",
  "restore_product_category",
  "run_traceability_report",
  "solve_quality_alert",
  "start_cycle_count_session",
  "start_quality_check",
  "unreserve_stock_quant",
  "update_barcode_nomenclature",
  "update_barcode_rule",
  "update_product",
  "update_product_category",
  "update_product_inventory_data",
  "update_product_packaging",
  "update_product_pricing",
  "update_product_supplier_info",
  "update_product_variant",
  "update_quality_alert_reason",
  "update_quality_point",
  "update_quality_team",
  "update_stock_inventory_state",
  "update_stock_location",
  "update_stock_production_lot",
  "update_stock_production_serial",
  "update_stock_quant_quantity",
  "update_stock_route",
  "update_stock_rule",
  "update_warehouse",
  "update_warehouse_3d_zone",
  "update_warehouse_task_status",
  "update_whatsapp_quality_score",
  "upsert_warehouse_geo",
  "use_serial",
  "validate_cycle_count",
  "validate_stock_picking",
  "validate_stock_picking_backorder",
] as const;

export type InventoryBffReducerKey = (typeof INVENTORY_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<InventoryBffReducerKey>([
  "create_warehouse",
  "update_warehouse",
  "delete_warehouse",
  "create_cycle_count_plan",
  "start_cycle_count_session",
  "record_cycle_count_line",
  "validate_cycle_count",
  "post_cycle_count_adjustments",
  "start_quality_check",
  "open_quality_alert",
  "solve_quality_alert",
  "execute_replenishment_rule",
  "update_warehouse_task_status",
]);

/** Same-origin path used by apiFetch in the web app. */
export function inventoryBffCallUrl(reducer: InventoryBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function inventoryBffPost(
  reducer: InventoryBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: inventoryBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

function inventoryReducerHints(): Record<InventoryBffReducerKey, readonly string[]> {
  const o = {} as Record<InventoryBffReducerKey, readonly string[]>;
  for (const key of INVENTORY_BFF_REDUCERS) {
    o[key] = [];
  }
  return o;
}

export const INVENTORY_COMMAND_SUBSCRIPTION_HINTS: Record<
  InventoryBffReducerKey,
  readonly string[]
> = inventoryReducerHints();

export function inventoryCommandContract(
  reducer: InventoryBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Inventory reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: INVENTORY_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
