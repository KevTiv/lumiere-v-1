/** Map entity view config ids to SpacetimeDB entity_type keys (snapshot registry). */
export const ENTITY_VIEW_ID_TO_ENTITY_TYPE: Readonly<Record<string, string>> = {
  "sale-orders-table": "sale_order",
  "sale-order-lines-table": "sale_order_line",
  "products-table": "product",
  "contacts-table": "contact",
  "purchase-orders-table": "purchase_order",
  "mrp-production-table": "mrp_production",
  "account-moves-table": "account_move",
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
