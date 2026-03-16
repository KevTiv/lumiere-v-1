import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const productTypeBadges = {
  badgeVariants: { consu: "secondary", service: "outline", product: "default" },
  badgeLabels: { consu: "Consumable", service: "Service", product: "Storable" },
} as const

const pickingStateBadges = {
  badgeVariants: { draft: "secondary", waiting: "outline", confirmed: "outline", assigned: "default", done: "default", cancel: "destructive" },
  badgeLabels: { draft: "Draft", waiting: "Waiting", confirmed: "Confirmed", assigned: "Ready", done: "Done", cancel: "Cancelled" },
} as const

const adjustmentStateBadges = {
  badgeVariants: { draft: "secondary", confirm: "outline", validate: "default", cancel: "destructive" },
  badgeLabels: { draft: "Draft", confirm: "In Progress", validate: "Validated", cancel: "Cancelled" },
} as const

// ── Products ──────────────────────────────────────────────────────────────────
export const productsTableConfig: EntityViewConfig = {
  id: "products-table",
  title: "Products",
  description: "Product catalog",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by name or internal reference…",
    searchKeys: ["name", "defaultCode"],
    filters: [
      {
        key: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "product", label: "Storable" },
          { value: "consu", label: "Consumable" },
          { value: "service", label: "Service" },
        ],
      },
    ],
    columns: [
      { key: "defaultCode", label: "SKU", width: "min-w-24" },
      { key: "name", label: "Name", width: "min-w-48" },
      { key: "type", label: "Type", type: "badge", ...productTypeBadges },
      { key: "standardPrice", label: "Cost", type: "currency", align: "right" },
      { key: "saleOk", label: "Can Sell", type: "boolean" },
      { key: "purchaseOk", label: "Can Buy", type: "boolean" },
    ],
    emptyMessage: "No products found.",
  },
}

// ── Stock (on-hand) ───────────────────────────────────────────────────────────
export const stockQuantsTableConfig: EntityViewConfig = {
  id: "stock-quants-table",
  title: "Stock On Hand",
  description: "Current inventory quantities by location",
  view: {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "productId", label: "Product ID", width: "min-w-24" },
      { key: "locationId", label: "Location", width: "min-w-32" },
      { key: "availableQuantity", label: "Available", type: "number", align: "right" },
      { key: "reservedQuantity", label: "Reserved", type: "number", align: "right" },
      { key: "inventoryQuantity", label: "On Hand", type: "number", align: "right" },
      { key: "value", label: "Value", type: "currency", align: "right" },
    ],
    emptyMessage: "No stock records found.",
  },
}

// ── Transfers (pickings) ──────────────────────────────────────────────────────
export const transfersTableConfig: EntityViewConfig = {
  id: "transfers-table",
  title: "Transfers",
  description: "Stock movements and delivery orders",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by reference or origin…",
    searchKeys: ["name", "origin"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "confirmed", label: "Confirmed" },
          { value: "assigned", label: "Ready" },
          { value: "done", label: "Done" },
          { value: "cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-28" },
      { key: "origin", label: "Source", width: "min-w-28" },
      { key: "state", label: "Status", type: "badge", ...pickingStateBadges },
      { key: "scheduledDate", label: "Scheduled", type: "date" },
      { key: "dateDone", label: "Done Date", type: "date" },
      { key: "moveType", label: "Move Type", type: "text" },
    ],
    emptyMessage: "No transfers found.",
  },
}

// ── Warehouses ────────────────────────────────────────────────────────────────
export const warehousesTableConfig: EntityViewConfig = {
  id: "warehouses-table",
  title: "Warehouses",
  description: "Warehouse locations and configuration",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search warehouses…",
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: "Name", width: "min-w-40" },
      { key: "code", label: "Code", width: "min-w-20" },
      { key: "active", label: "Active", type: "boolean" },
    ],
    emptyMessage: "No warehouses found.",
  },
}

// ── Inventory Adjustments ─────────────────────────────────────────────────────
export const inventoryAdjustmentsTableConfig: EntityViewConfig = {
  id: "inventory-adjustments-table",
  title: "Inventory Adjustments",
  description: "Physical inventory counts and adjustments",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search adjustments…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "confirm", label: "In Progress" },
          { value: "validate", label: "Validated" },
          { value: "cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-32" },
      { key: "state", label: "Status", type: "badge", ...adjustmentStateBadges },
      { key: "date", label: "Date", type: "date" },
      { key: "accountingDate", label: "Accounting Date", type: "date" },
    ],
    emptyMessage: "No inventory adjustments found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const inventoryEntityConfigs: Record<string, EntityViewConfig> = {
  "products-table": productsTableConfig,
  "stock-quants-table": stockQuantsTableConfig,
  "transfers-table": transfersTableConfig,
  "warehouses-table": warehousesTableConfig,
  "inventory-adjustments-table": inventoryAdjustmentsTableConfig,
}
