import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const moStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Confirmed: "outline",
    Progress: "default",
    ToClose: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: "Draft",
    Confirmed: "Confirmed",
    Progress: "In Progress",
    ToClose: "To Close",
    Done: "Done",
    Cancelled: "Cancelled",
  },
} as const

const workorderStateBadges = {
  badgeVariants: {
    Pending: "secondary",
    Ready: "outline",
    Progress: "default",
    Done: "default",
    Cancel: "destructive",
  },
  badgeLabels: {
    Pending: "Pending",
    Ready: "Ready",
    Progress: "In Progress",
    Done: "Done",
    Cancel: "Cancelled",
  },
} as const

const bomTypeBadges = {
  badgeVariants: {
    Normal: "default",
    Phantom: "outline",
    Kit: "secondary",
    Subcontracting: "outline",
  },
  badgeLabels: {
    Normal: "Manufacture",
    Phantom: "Phantom",
    Kit: "Kit",
    Subcontracting: "Subcontracting",
  },
} as const

// ── Manufacturing Orders ──────────────────────────────────────────────────────
export const manufacturingOrdersTableConfig: EntityViewConfig = {
  id: "manufacturing-orders-table",
  title: "Manufacturing Orders",
  description: "Production orders and their status",
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
          { value: "Draft", label: "Draft" },
          { value: "Confirmed", label: "Confirmed" },
          { value: "Progress", label: "In Progress" },
          { value: "ToClose", label: "To Close" },
          { value: "Done", label: "Done" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-32" },
      { key: "productId", label: "Product", width: "min-w-40" },
      { key: "productQty", label: "Qty", type: "number", align: "right" },
      { key: "qtyProducing", label: "Producing", type: "number", align: "right" },
      { key: "state", label: "Status", type: "badge", ...moStateBadges },
      { key: "datePlannedStart", label: "Scheduled", type: "date" },
      { key: "datePlannedFinished", label: "Deadline", type: "date" },
      { key: "origin", label: "Source", width: "min-w-24" },
    ],
    emptyMessage: "No manufacturing orders found.",
  },
}

// ── Bills of Materials ────────────────────────────────────────────────────────
export const bomsTableConfig: EntityViewConfig = {
  id: "boms-table",
  title: "Bills of Materials",
  description: "Product structures and component lists",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search BOMs…",
    searchKeys: ["productId"],
    filters: [
      {
        key: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "Normal", label: "Manufacture" },
          { value: "Phantom", label: "Phantom" },
          { value: "Kit", label: "Kit" },
          { value: "Subcontracting", label: "Subcontracting" },
        ],
      },
    ],
    columns: [
      { key: "productId", label: "Product", width: "min-w-40" },
      { key: "productTmplId", label: "Product Template", width: "min-w-32" },
      { key: "type", label: "BOM Type", type: "badge", ...bomTypeBadges },
      { key: "productQty", label: "Quantity", type: "number", align: "right" },
      { key: "estimatedCost", label: "Est. Cost", type: "currency", align: "right" },
      { key: "routingId", label: "Routing", width: "min-w-24" },
    ],
    emptyMessage: "No bills of materials found.",
  },
}

// ── Work Orders ───────────────────────────────────────────────────────────────
export const workordersTableConfig: EntityViewConfig = {
  id: "workorders-table",
  title: "Work Orders",
  description: "Operations scheduled at work centers",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search work orders…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Pending", label: "Pending" },
          { value: "Ready", label: "Ready" },
          { value: "Progress", label: "In Progress" },
          { value: "Done", label: "Done" },
          { value: "Cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Operation", width: "min-w-36" },
      { key: "productionId", label: "MO", width: "min-w-28" },
      { key: "workcenterId", label: "Work Center", width: "min-w-32" },
      { key: "state", label: "Status", type: "badge", ...workorderStateBadges },
      { key: "durationExpected", label: "Expected (min)", type: "number", align: "right" },
      { key: "duration", label: "Actual (min)", type: "number", align: "right" },
      { key: "dateStart", label: "Start", type: "date" },
      { key: "dateFinished", label: "Finish", type: "date" },
    ],
    emptyMessage: "No work orders found.",
  },
}

// ── Work Centers ──────────────────────────────────────────────────────────────
export const workcentersTableConfig: EntityViewConfig = {
  id: "workcenters-table",
  title: "Work Centers",
  description: "Machines and work stations",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search work centers…",
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: "Name", width: "min-w-36" },
      { key: "code", label: "Code", width: "min-w-20" },
      { key: "active", label: "Active", type: "boolean" },
      { key: "timeEfficiency", label: "Efficiency %", type: "number", align: "right" },
      { key: "oee", label: "OEE %", type: "number", align: "right" },
      { key: "capacity", label: "Capacity", type: "number", align: "right" },
      { key: "workorderCount", label: "WO Count", type: "number", align: "right" },
    ],
    emptyMessage: "No work centers found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const manufacturingEntityConfigs: Record<string, EntityViewConfig> = {
  "manufacturing-orders-table": manufacturingOrdersTableConfig,
  "boms-table": bomsTableConfig,
  "workorders-table": workordersTableConfig,
  "workcenters-table": workcentersTableConfig,
}
