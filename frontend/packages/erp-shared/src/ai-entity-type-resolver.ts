/** Map entity view config ids to SpacetimeDB entity_type keys (snapshot registry). */
export const ENTITY_VIEW_ID_TO_ENTITY_TYPE: Readonly<Record<string, string>> = {
  "sale-orders-table": "sale_order",
  "sale-order-lines-table": "sale_order_line",
  "products-table": "product",
  "contacts-table": "contact",
  "leads-table": "lead",
  "opportunities-table": "opportunity",
  "purchase-orders-table": "purchase_order",
  "mrp-production-table": "mrp_production",
  "account-moves-table": "account_move",
  "account-move-lines-table": "account_move_line",
  "account-payments-table": "account_payment",
  "expenses-table": "hr_expense",
  "expense-sheets-table": "hr_expense_sheet",
  "subscriptions-table": "subscription",
  "transfers-table": "stock_picking",
  "stock-quants-table": "stock_quant",
  "stock-moves-table": "stock_move",
  "stock-locations-table": "stock_location",
  "cycle-counts-table": "stock_cycle_count",
  "fleet-vehicles-table": "fleet_vehicle",
  "fleet-service-records-table": "fleet_service_record",
  "fleet-inspections-table": "fleet_inspection",
  "project-tasks-table": "project_task",
}

export function normalizeEntityTypeKey(raw: string): string {
  return raw.trim().toLowerCase().replaceAll("-", "_")
}

/** Resolve canonical STDB entity_type for AI context and live snapshots. */
export function resolveAiEntityType(config: {
  id: string
  entityType?: string | null
}): string | undefined {
  const explicit = config.entityType?.trim()
  if (explicit) {
    return normalizeEntityTypeKey(explicit)
  }

  const mapped = ENTITY_VIEW_ID_TO_ENTITY_TYPE[config.id.trim()]
  if (mapped) {
    return normalizeEntityTypeKey(mapped)
  }

  return undefined
}
