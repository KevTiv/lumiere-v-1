import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Inventory mutations via Next.js BFF POST /api/call/:reducer.
 * Keys match SpacetimeDB reducer snake_case names used by @lumiere/query-hooks inventory hooks.
 */
export const INVENTORY_BFF_REDUCERS = [
  "add_member_to_quality_team",
  "add_rule_to_nomenclature",
  "assign_quality_alert",
  "assign_stock_move",
  "assign_stock_picking",
  "assign_user_to_picking",
  "block_serial",
  "cancel_quality_alert",
  "cancel_stock_inventory",
  "cancel_stock_move",
  "cancel_stock_picking",
  "cancel_warehouse_task",
  "complete_picking_wave",
  "complete_warehouse_task",
  "confirm_stock_inventory",
  "confirm_stock_move",
  "confirm_stock_picking",
  "create_adjustment_reason",
  "create_barcode_nomenclature",
  "create_barcode_rule",
  "create_cycle_count_plan",
  "create_inventory_adjustment",
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
  "delete_picking_wave",
  "delete_product",
  "delete_product_category",
  "delete_quality_alert",
  "delete_quality_alert_reason",
  "delete_quality_check",
  "delete_quality_point",
  "delete_quality_team",
  "delete_replenishment_rule",
  "delete_stock_location",
  "delete_stock_production_lot",
  "delete_stock_production_serial",
  "delete_stock_route",
  "delete_stock_rule",
  "delete_uom",
  "delete_warehouse",
  "delete_warehouse_3d_zone",
  "delete_warehouse_task",
  "done_stock_move",
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
  "process_picking_wave",
  "record_barcode_scan",
  "record_cycle_count_line",
  "remove_member_from_quality_team",
  "remove_rule_from_nomenclature",
  "reserve_serial",
  "reserve_stock_quant",
  "restore_product_category",
  "run_traceability_report",
  "solve_quality_alert",
  "start_cycle_count_session",
  "start_quality_check",
  "start_stock_inventory",
  "start_warehouse_task",
  "trigger_replenishment",
  "unreserve_stock_quant",
  "update_barcode_nomenclature",
  "update_barcode_rule",
  "update_picking_wave",
  "update_product",
  "update_product_category",
  "update_product_inventory_data",
  "update_product_packaging",
  "update_product_pricing",
  "update_product_supplier_info",
  "update_product_variant",
  "update_quality_alert",
  "update_quality_alert_reason",
  "update_quality_check",
  "update_quality_point",
  "update_quality_team",
  "update_replenishment_rule",
  "update_stock_inventory_state",
  "update_stock_location",
  "update_stock_production_lot",
  "update_stock_production_serial",
  "update_stock_quant_quantity",
  "update_stock_route",
  "update_stock_rule",
  "update_uom",
  "update_warehouse",
  "update_warehouse_3d_zone",
  "update_warehouse_task_status",
  "update_whatsapp_quality_score",
  "upsert_warehouse_geo",
  "use_serial",
  "validate_cycle_count",
  "validate_stock_inventory",
  "validate_stock_picking",
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
  o["add_member_to_quality_team"] = []
  o["add_rule_to_nomenclature"] = []
  o["assign_quality_alert"] = []
  o["assign_stock_move"] = []
  o["assign_stock_picking"] = []
  o["assign_user_to_picking"] = []
  o["block_serial"] = []
  o["cancel_quality_alert"] = []
  o["cancel_stock_inventory"] = []
  o["cancel_stock_move"] = []
  o["cancel_stock_picking"] = []
  o["cancel_warehouse_task"] = []
  o["complete_picking_wave"] = []
  o["complete_warehouse_task"] = []
  o["confirm_stock_inventory"] = []
  o["confirm_stock_move"] = []
  o["confirm_stock_picking"] = []
  o["create_adjustment_reason"] = []
  o["create_barcode_nomenclature"] = []
  o["create_barcode_rule"] = []
  o["create_cycle_count_plan"] = []
  o["create_inventory_adjustment"] = []
  o["create_picking_wave"] = []
  o["create_product"] = []
  o["create_product_category"] = []
  o["create_product_packaging"] = []
  o["create_product_supplier_info"] = []
  o["create_product_variant"] = []
  o["create_quality_alert"] = []
  o["create_quality_alert_reason"] = []
  o["create_quality_check"] = []
  o["create_quality_point"] = []
  o["create_quality_team"] = []
  o["create_replenishment_rule"] = []
  o["create_stock_inventory"] = []
  o["create_stock_inventory_line"] = []
  o["create_stock_location"] = []
  o["create_stock_move"] = []
  o["create_stock_picking"] = []
  o["create_stock_production_lot"] = []
  o["create_stock_production_serial"] = []
  o["create_stock_quant"] = []
  o["create_stock_route"] = []
  o["create_stock_rule"] = []
  o["create_traceability_record"] = []
  o["create_traceability_report"] = []
  o["create_uom"] = []
  o["create_uom_category"] = []
  o["create_uom_conversion"] = []
  o["create_warehouse"] = []
  o["create_warehouse_3d_zone"] = []
  o["create_warehouse_task"] = []
  o["delete_barcode_nomenclature"] = []
  o["delete_barcode_rule"] = []
  o["delete_picking_wave"] = []
  o["delete_product"] = []
  o["delete_product_category"] = []
  o["delete_quality_alert"] = []
  o["delete_quality_alert_reason"] = []
  o["delete_quality_check"] = []
  o["delete_quality_point"] = []
  o["delete_quality_team"] = []
  o["delete_replenishment_rule"] = []
  o["delete_stock_location"] = []
  o["delete_stock_production_lot"] = []
  o["delete_stock_production_serial"] = []
  o["delete_stock_route"] = []
  o["delete_stock_rule"] = []
  o["delete_uom"] = []
  o["delete_warehouse"] = []
  o["delete_warehouse_3d_zone"] = []
  o["delete_warehouse_task"] = []
  o["done_stock_move"] = []
  o["execute_replenishment_rule"] = []
  o["fail_quality_check"] = []
  o["import_lot_csv"] = []
  o["import_product_category_csv"] = []
  o["import_product_csv"] = []
  o["import_product_variant_csv"] = []
  o["import_stock_location_csv"] = []
  o["import_stock_quant_csv"] = []
  o["import_uom_category_csv"] = []
  o["import_uom_csv"] = []
  o["import_warehouse_csv"] = []
  o["link_device_to_quality_check"] = []
  o["move_stock_quant"] = []
  o["open_quality_alert"] = []
  o["pass_quality_check"] = []
  o["post_cycle_count_adjustments"] = []
  o["process_inventory_adjustment"] = []
  o["process_picking_wave"] = []
  o["record_barcode_scan"] = []
  o["record_cycle_count_line"] = []
  o["remove_member_from_quality_team"] = []
  o["remove_rule_from_nomenclature"] = []
  o["reserve_serial"] = []
  o["reserve_stock_quant"] = []
  o["restore_product_category"] = []
  o["run_traceability_report"] = []
  o["solve_quality_alert"] = []
  o["start_cycle_count_session"] = []
  o["start_quality_check"] = []
  o["start_stock_inventory"] = []
  o["start_warehouse_task"] = []
  o["trigger_replenishment"] = []
  o["unreserve_stock_quant"] = []
  o["update_barcode_nomenclature"] = []
  o["update_barcode_rule"] = []
  o["update_picking_wave"] = []
  o["update_product"] = []
  o["update_product_category"] = []
  o["update_product_inventory_data"] = []
  o["update_product_packaging"] = []
  o["update_product_pricing"] = []
  o["update_product_supplier_info"] = []
  o["update_product_variant"] = []
  o["update_quality_alert"] = []
  o["update_quality_alert_reason"] = []
  o["update_quality_check"] = []
  o["update_quality_point"] = []
  o["update_quality_team"] = []
  o["update_replenishment_rule"] = []
  o["update_stock_inventory_state"] = []
  o["update_stock_location"] = []
  o["update_stock_production_lot"] = []
  o["update_stock_production_serial"] = []
  o["update_stock_quant_quantity"] = []
  o["update_stock_route"] = []
  o["update_stock_rule"] = []
  o["update_uom"] = []
  o["update_warehouse"] = []
  o["update_warehouse_3d_zone"] = []
  o["update_warehouse_task_status"] = []
  o["update_whatsapp_quality_score"] = []
  o["upsert_warehouse_geo"] = []
  o["use_serial"] = []
  o["validate_cycle_count"] = []
  o["validate_stock_inventory"] = []
  o["validate_stock_picking"] = []
  return o
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
