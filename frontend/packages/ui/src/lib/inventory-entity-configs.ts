import type { TFunction } from "i18next"
import { createElement } from "react"
import type { EntityDetailConfig, EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const productTypeBadges = (t: TFunction) => ({
  badgeVariants: { consu: "secondary", service: "outline", product: "default" },
  badgeLabels: {
    consu: t("inventory.products.states.consu"),
    service: t("inventory.products.states.service"),
    product: t("inventory.products.states.product"),
  },
}) as const

export const productStatusBadges = productTypeBadges

const pickingStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", waiting: "outline", confirmed: "outline", assigned: "default", done: "default", cancel: "destructive" },
  badgeLabels: {
    draft: t("inventory.transfers.states.draft"),
    waiting: t("inventory.transfers.states.waiting"),
    confirmed: t("inventory.transfers.states.confirmed"),
    assigned: t("inventory.transfers.states.assigned"),
    done: t("inventory.transfers.states.done"),
    cancel: t("inventory.transfers.states.cancel"),
  },
}) as const

export const transferStatusBadges = pickingStateBadges

const adjustmentStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", confirm: "outline", validate: "default", cancel: "destructive" },
  badgeLabels: {
    draft: t("inventory.inventoryAdjustments.states.draft"),
    confirm: t("inventory.inventoryAdjustments.states.confirm"),
    validate: t("inventory.inventoryAdjustments.states.validate"),
    cancel: t("inventory.inventoryAdjustments.states.cancel"),
  },
})

const qualityCheckResultBadges = (t: TFunction) => ({
  badgeVariants: { none: "secondary", pass: "default", fail: "destructive" },
  badgeLabels: {
    none: t("inventory.qualityChecks.states.none"),
    pass: t("inventory.qualityChecks.states.pass"),
    fail: t("inventory.qualityChecks.states.fail"),
  },
})

const qualityAlertStateBadges = (t: TFunction) => ({
  badgeVariants: {
    draft: "secondary",
    open: "outline",
    in_progress: "default",
    solved: "default",
    cancelled: "destructive",
  },
  badgeLabels: {
    draft: t("inventory.qualityAlerts.states.draft"),
    open: t("inventory.qualityAlerts.states.open"),
    in_progress: t("inventory.qualityAlerts.states.inProgress"),
    solved: t("inventory.qualityAlerts.states.solved"),
    cancelled: t("inventory.qualityAlerts.states.cancelled"),
  },
})

const qualityAlertPriorityBadges = (t: TFunction) => ({
  badgeVariants: { normal: "secondary", low: "outline", high: "default", critical: "destructive" },
  badgeLabels: {
    normal: t("inventory.forms.newQualityAlert.fields.priorities.normal"),
    low: t("inventory.forms.newQualityAlert.fields.priorities.low"),
    high: t("inventory.forms.newQualityAlert.fields.priorities.high"),
    critical: t("inventory.forms.newQualityAlert.fields.priorities.critical"),
  },
})

const serialStateBadges = (t: TFunction) => ({
  badgeVariants: { available: "default", in_use: "outline", blocked: "destructive" },
  badgeLabels: {
    available: t("inventory.productionSerials.states.available"),
    in_use: t("inventory.productionSerials.states.inUse"),
    blocked: t("inventory.productionSerials.states.blocked"),
  },
})

const locationTypeBadges = (t: TFunction) => ({
  badgeVariants: { internal: "default", customer: "outline", supplier: "outline", inventory: "secondary", transit: "secondary", view: "secondary" },
  badgeLabels: {
    internal: t("inventory.stockLocations.states.internal"),
    customer: t("inventory.stockLocations.states.customer"),
    supplier: t("inventory.stockLocations.states.supplier"),
    inventory: t("inventory.stockLocations.states.inventory"),
    transit: t("inventory.stockLocations.states.transit"),
    view: t("inventory.stockLocations.states.view"),
  },
})

// ── Products ──────────────────────────────────────────────────────────────────

export type ProductsTableConfigOptions = {
  /** Combined default code + name for dense lists (optional). */
  formatProductDisplayName?: (row: Record<string, unknown>) => string
  /** Empty-state CTA — wired by the module client (opens create form). */
  onEmptyAction?: () => void
}

export const productDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "identification",
      fields: [
        { key: "defaultCode", label: t("inventory.products.columns.defaultCode") },
        { key: "barcode", label: t("inventory.products.detail.barcode") },
        {
          key: "type",
          label: t("inventory.products.columns.type"),
          type: "badge",
          ...productTypeBadges(t),
        },
      ],
    },
    {
      id: "pricing",
      fields: [
        {
          key: "standardPrice",
          label: t("inventory.products.columns.standardPrice"),
          type: "currency",
        },
        {
          key: "listPrice",
          label: t("inventory.products.detail.listPrice"),
          type: "currency",
        },
      ],
    },
    {
      id: "availability",
      fields: [
        {
          key: "qtyAvailable",
          label: t("inventory.products.detail.qtyAvailable"),
          type: "number",
        },
        {
          key: "saleOk",
          label: t("inventory.products.columns.saleOk"),
          type: "boolean",
        },
        {
          key: "purchaseOk",
          label: t("inventory.products.columns.purchaseOk"),
          type: "boolean",
        },
        { key: "active", label: t("inventory.products.detail.active"), type: "boolean" },
      ],
    },
  ],
})

export const stockQuantDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "stock",
      fields: [
        { key: "productId", label: t("inventory.stockOnHand.columns.productId") },
        { key: "locationId", label: t("inventory.stockOnHand.columns.locationId") },
        {
          key: "availableQuantity",
          label: t("inventory.stockOnHand.columns.availableQuantity"),
          type: "number",
        },
        {
          key: "reservedQuantity",
          label: t("inventory.stockOnHand.columns.reservedQuantity"),
          type: "number",
        },
        {
          key: "inventoryQuantity",
          label: t("inventory.stockOnHand.columns.inventoryQuantity"),
          type: "number",
        },
        {
          key: "value",
          label: t("inventory.stockOnHand.columns.value"),
          type: "currency",
        },
      ],
    },
  ],
})

export const transferDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "source",
      fields: [
        { key: "origin", label: t("inventory.transfers.columns.origin") },
        { key: "moveType", label: t("inventory.transfers.columns.moveType") },
      ],
    },
    {
      id: "dates",
      fields: [
        {
          key: "scheduledDate",
          label: t("inventory.transfers.columns.scheduledDate"),
          type: "relative-date",
        },
        {
          key: "dateDone",
          label: t("inventory.transfers.columns.dateDone"),
          type: "relative-date",
        },
      ],
    },
    {
      id: "locations",
      fields: [
        { key: "locationId", label: t("inventory.transfers.detail.locationFrom") },
        { key: "locationDestId", label: t("inventory.transfers.detail.locationTo") },
      ],
    },
  ],
})

export const productsTableConfig = (
  t: TFunction,
  options?: ProductsTableConfigOptions,
): EntityViewConfig => {
  const formatName = options?.formatProductDisplayName

  const nameColumn = {
    key: "name",
    label: t("inventory.products.columns.name"),
    width: "min-w-48",
    sortable: true,
    ...(formatName
      ? {
          render: (_value: unknown, row: Record<string, unknown>) => {
            const formatted = formatName(row).trim()
            const fallback = String(row.name ?? "").trim()
            const shown = formatted || fallback
            if (!shown)
              return createElement(
                "span",
                { className: "text-muted-foreground" },
                "—",
              )
            return shown
          },
        }
      : {}),
  }

  return {
    id: "products-table",
    entityType: "product",
    title: t("inventory.products.title"),
    description: t("inventory.products.description"),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("inventory.products.searchPlaceholder"),
      searchKeys: ["name", "defaultCode", "default_code", "barcode"],
      filters: [
        {
          key: "type",
          label: t("inventory.products.filters.type.label"),
          type: "select",
          options: [
            { value: "product", label: t("inventory.products.filters.type.options.product") },
            { value: "consu", label: t("inventory.products.filters.type.options.consu") },
            { value: "service", label: t("inventory.products.filters.type.options.service") },
          ],
        },
      ],
      columns: [
        {
          key: "defaultCode",
          label: t("inventory.products.columns.defaultCode"),
          width: "min-w-24",
          sortable: true,
        },
        nameColumn,
        {
          key: "type",
          label: t("inventory.products.columns.type"),
          type: "status",
          sortable: true,
          ...productTypeBadges(t),
        },
        {
          key: "standardPrice",
          label: t("inventory.products.columns.standardPrice"),
          type: "currency",
          align: "right",
          sortable: true,
        },
        {
          key: "saleOk",
          label: t("inventory.products.columns.saleOk"),
          type: "boolean",
        },
        {
          key: "purchaseOk",
          label: t("inventory.products.columns.purchaseOk"),
          type: "boolean",
        },
      ],
      emptyMessage: t("inventory.products.emptyMessage"),
      emptyState: {
        title: t("inventory.products.emptyState.title"),
        description: t("inventory.products.emptyState.description"),
        actionLabel: t("inventory.products.emptyState.actionLabel"),
        onAction: options?.onEmptyAction,
      },
    },
  }
}

export type StockQuantsTableConfigOptions = {
  /** Empty-state CTA — wired by the module client (opens create form). */
  onEmptyAction?: () => void
}

// ── Stock (on-hand) ───────────────────────────────────────────────────────────
export const stockQuantsTableConfig = (
  t: TFunction,
  options?: StockQuantsTableConfigOptions,
): EntityViewConfig => ({
  id: "stock-quants-table",
  title: t("inventory.stockOnHand.title"),
  description: t("inventory.stockOnHand.description"),
  view: {
    mode: "table",
    rowKey: "id",
    columns: [
      {
        key: "productId",
        label: t("inventory.stockOnHand.columns.productId"),
        width: "min-w-24",
        sortable: true,
      },
      {
        key: "locationId",
        label: t("inventory.stockOnHand.columns.locationId"),
        width: "min-w-32",
        sortable: true,
      },
      {
        key: "availableQuantity",
        label: t("inventory.stockOnHand.columns.availableQuantity"),
        type: "number",
        align: "right",
        sortable: true,
      },
      {
        key: "reservedQuantity",
        label: t("inventory.stockOnHand.columns.reservedQuantity"),
        type: "number",
        align: "right",
      },
      {
        key: "inventoryQuantity",
        label: t("inventory.stockOnHand.columns.inventoryQuantity"),
        type: "number",
        align: "right",
        sortable: true,
      },
      {
        key: "value",
        label: t("inventory.stockOnHand.columns.value"),
        type: "currency",
        align: "right",
        sortable: true,
      },
    ],
    emptyMessage: t("inventory.stockOnHand.emptyMessage"),
    emptyState: {
      title: t("inventory.stockOnHand.emptyState.title"),
      description: t("inventory.stockOnHand.emptyState.description"),
      actionLabel: t("inventory.stockOnHand.emptyState.actionLabel"),
      onAction: options?.onEmptyAction,
    },
  },
})

export type TransfersTableConfigOptions = {
  /** Empty-state CTA — wired by the module client (opens create form). */
  onEmptyAction?: () => void
}

// ── Transfers (pickings) ──────────────────────────────────────────────────────
export const transfersTableConfig = (
  t: TFunction,
  options?: TransfersTableConfigOptions,
): EntityViewConfig => ({
  id: "transfers-table",
  title: t("inventory.transfers.title"),
  description: t("inventory.transfers.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.transfers.searchPlaceholder"),
    searchKeys: ["name", "origin"],
    filters: [
      {
        key: "state",
        label: t("inventory.transfers.filters.state.label"),
        type: "select",
        options: [
          { value: "draft", label: t("inventory.transfers.filters.state.options.draft") },
          { value: "confirmed", label: t("inventory.transfers.filters.state.options.confirmed") },
          { value: "assigned", label: t("inventory.transfers.filters.state.options.assigned") },
          { value: "done", label: t("inventory.transfers.filters.state.options.done") },
          { value: "cancel", label: t("inventory.transfers.filters.state.options.cancel") },
        ],
      },
    ],
    columns: [
      {
        key: "name",
        label: t("inventory.transfers.columns.name"),
        width: "min-w-28",
        sortable: true,
      },
      { key: "origin", label: t("inventory.transfers.columns.origin"), width: "min-w-28" },
      {
        key: "state",
        label: t("inventory.transfers.columns.state"),
        type: "status",
        sortable: true,
        ...pickingStateBadges(t),
      },
      {
        key: "scheduledDate",
        label: t("inventory.transfers.columns.scheduledDate"),
        type: "relative-date",
        sortable: true,
      },
      {
        key: "dateDone",
        label: t("inventory.transfers.columns.dateDone"),
        type: "relative-date",
      },
      { key: "moveType", label: t("inventory.transfers.columns.moveType"), type: "text" },
    ],
    emptyMessage: t("inventory.transfers.emptyMessage"),
    emptyState: {
      title: t("inventory.transfers.emptyState.title"),
      description: t("inventory.transfers.emptyState.description"),
      actionLabel: t("inventory.transfers.emptyState.actionLabel"),
      onAction: options?.onEmptyAction,
    },
  },
})

// ── Warehouses ────────────────────────────────────────────────────────────────
export const warehousesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "warehouses-table",
  title: t("inventory.warehouses.title"),
  description: t("inventory.warehouses.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.warehouses.searchPlaceholder"),
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: t("inventory.warehouses.columns.name"), width: "min-w-40" },
      { key: "code", label: t("inventory.warehouses.columns.code"), width: "min-w-20" },
      { key: "active", label: t("inventory.warehouses.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("inventory.warehouses.emptyMessage"),
  },
})

// ── Inventory Adjustments ─────────────────────────────────────────────────────
export const inventoryAdjustmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "inventory-adjustments-table",
  title: t("inventory.inventoryAdjustments.title"),
  description: t("inventory.inventoryAdjustments.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.inventoryAdjustments.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("inventory.inventoryAdjustments.filters.state.label"),
        type: "select",
        options: [
          { value: "draft", label: t("inventory.inventoryAdjustments.filters.state.options.draft") },
          { value: "confirm", label: t("inventory.inventoryAdjustments.filters.state.options.confirm") },
          { value: "validate", label: t("inventory.inventoryAdjustments.filters.state.options.validate") },
          { value: "cancel", label: t("inventory.inventoryAdjustments.filters.state.options.cancel") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("inventory.inventoryAdjustments.columns.name"), width: "min-w-32" },
      { key: "state", label: t("inventory.inventoryAdjustments.columns.state"), type: "badge", ...adjustmentStateBadges(t) },
      { key: "date", label: t("inventory.inventoryAdjustments.columns.date"), type: "date" },
      { key: "accountingDate", label: t("inventory.inventoryAdjustments.columns.accountingDate"), type: "date" },
    ],
    emptyMessage: t("inventory.inventoryAdjustments.emptyMessage"),
  },
})

// ── Stock Locations ───────────────────────────────────────────────────────────
export const stockLocationsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "stock-locations-table",
  title: t("inventory.stockLocations.title"),
  description: t("inventory.stockLocations.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.stockLocations.searchPlaceholder"),
    searchKeys: ["name", "completeName"],
    filters: [
      {
        key: "usage",
        label: t("inventory.stockLocations.filters.usage.label"),
        type: "select",
        options: [
          { value: "internal", label: t("inventory.stockLocations.filters.usage.options.internal") },
          { value: "customer", label: t("inventory.stockLocations.filters.usage.options.customer") },
          { value: "supplier", label: t("inventory.stockLocations.filters.usage.options.supplier") },
          { value: "inventory", label: t("inventory.stockLocations.filters.usage.options.inventory") },
          { value: "transit", label: t("inventory.stockLocations.filters.usage.options.transit") },
        ],
      },
    ],
    columns: [
      { key: "completeName", label: t("inventory.stockLocations.columns.completeName"), width: "min-w-48" },
      { key: "usage", label: t("inventory.stockLocations.columns.usage"), type: "badge", ...locationTypeBadges(t) },
      { key: "barcode", label: t("inventory.stockLocations.columns.barcode"), width: "min-w-28" },
      { key: "active", label: t("inventory.stockLocations.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("inventory.stockLocations.emptyMessage"),
  },
})

// ── Production Lots ───────────────────────────────────────────────────────────
export const productionLotsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "production-lots-table",
  title: t("inventory.productionLots.title"),
  description: t("inventory.productionLots.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.productionLots.searchPlaceholder"),
    searchKeys: ["name", "ref"],
    columns: [
      { key: "name", label: t("inventory.productionLots.columns.name"), width: "min-w-36" },
      { key: "productId", label: t("inventory.productionLots.columns.productId"), width: "min-w-40" },
      { key: "ref", label: t("inventory.productionLots.columns.ref"), width: "min-w-28" },
      { key: "createDate", label: t("inventory.productionLots.columns.createDate"), type: "date" },
      { key: "expirationDate", label: t("inventory.productionLots.columns.expirationDate"), type: "date" },
    ],
    emptyMessage: t("inventory.productionLots.emptyMessage"),
  },
})

export const stockProductionSerialsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "stock-production-serials-table",
  title: t("inventory.productionSerials.title"),
  description: t("inventory.productionSerials.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.productionSerials.searchPlaceholder"),
    searchKeys: ["name", "ref"],
    columns: [
      { key: "name", label: t("inventory.productionSerials.columns.name"), width: "min-w-36" },
      { key: "productId", label: t("inventory.productionSerials.columns.productId"), width: "min-w-32" },
      { key: "state", label: t("inventory.productionSerials.columns.state"), type: "badge", ...serialStateBadges(t) },
      { key: "isLocked", label: t("inventory.productionSerials.columns.isLocked"), type: "boolean" },
      { key: "locationId", label: t("inventory.productionSerials.columns.locationId"), width: "min-w-24" },
      { key: "createDate", label: t("inventory.productionSerials.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("inventory.productionSerials.emptyMessage"),
  },
})

export const qualityAlertsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "quality-alerts-table",
  title: t("inventory.qualityAlerts.title"),
  description: t("inventory.qualityAlerts.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.qualityAlerts.searchPlaceholder"),
    searchKeys: ["name", "title", "description"],
    filters: [
      {
        key: "state",
        label: t("inventory.qualityAlerts.filters.state.label"),
        type: "select",
        options: [
          { value: "draft", label: t("inventory.qualityAlerts.states.draft") },
          { value: "open", label: t("inventory.qualityAlerts.states.open") },
          { value: "in_progress", label: t("inventory.qualityAlerts.states.inProgress") },
          { value: "solved", label: t("inventory.qualityAlerts.states.solved") },
          { value: "cancelled", label: t("inventory.qualityAlerts.states.cancelled") },
        ],
      },
    ],
    columns: [
      { key: "title", label: t("inventory.qualityAlerts.columns.title"), width: "min-w-40" },
      { key: "state", label: t("inventory.qualityAlerts.columns.state"), type: "badge", ...qualityAlertStateBadges(t) },
      { key: "priority", label: t("inventory.qualityAlerts.columns.priority"), type: "badge", ...qualityAlertPriorityBadges(t) },
      { key: "productId", label: t("inventory.qualityAlerts.columns.productId"), width: "min-w-28" },
      { key: "teamId", label: t("inventory.qualityAlerts.columns.teamId"), width: "min-w-24" },
      { key: "createDate", label: t("inventory.qualityAlerts.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("inventory.qualityAlerts.emptyMessage"),
  },
})

// ── Quality Checks ────────────────────────────────────────────────────────────
export const qualityChecksTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "quality-checks-table",
  title: t("inventory.qualityChecks.title"),
  description: t("inventory.qualityChecks.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.qualityChecks.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "qualityState",
        label: t("inventory.qualityChecks.filters.qualityState.label"),
        type: "select",
        options: [
          { value: "none", label: t("inventory.qualityChecks.filters.qualityState.options.none") },
          { value: "pass", label: t("inventory.qualityChecks.filters.qualityState.options.pass") },
          { value: "fail", label: t("inventory.qualityChecks.filters.qualityState.options.fail") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("inventory.qualityChecks.columns.name"), width: "min-w-32" },
      { key: "productId", label: t("inventory.qualityChecks.columns.productId"), width: "min-w-40" },
      { key: "qualityState", label: t("inventory.qualityChecks.columns.qualityState"), type: "badge", ...qualityCheckResultBadges(t) },
      { key: "createDate", label: t("inventory.qualityChecks.columns.createDate"), type: "date" },
      { key: "teamId", label: t("inventory.qualityChecks.columns.teamId"), width: "min-w-28" },
    ],
    emptyMessage: t("inventory.qualityChecks.emptyMessage"),
  },
})

// ── Cycle counts ─────────────────────────────────────────────────────────────
export const cycleCountsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "cycle-counts-table",
  title: t("inventory.cycleCounts.title"),
  description: t("inventory.cycleCounts.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.cycleCounts.title"),
    searchKeys: ["name", "state"],
    columns: [
      { key: "name", label: t("inventory.cycleCounts.columns.name"), width: "min-w-40" },
      { key: "state", label: t("inventory.cycleCounts.columns.state"), type: "badge" },
      { key: "locationId", label: t("inventory.cycleCounts.columns.locationId"), width: "min-w-24" },
      { key: "frequency", label: t("inventory.cycleCounts.columns.frequency"), width: "min-w-24" },
      { key: "nextCountDate", label: t("inventory.cycleCounts.columns.nextCountDate"), type: "date" },
    ],
    emptyMessage: t("inventory.cycleCounts.emptyMessage"),
  },
})

// ── Picking waves ────────────────────────────────────────────────────────────
export const pickingWavesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "picking-waves-table",
  title: t("inventory.pickingWaves.title"),
  description: t("inventory.pickingWaves.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name", "state"],
    columns: [
      { key: "name", label: t("inventory.pickingWaves.columns.name"), width: "min-w-40" },
      { key: "state", label: t("inventory.pickingWaves.columns.state"), type: "badge" },
      { key: "pickingTypeId", label: t("inventory.pickingWaves.columns.pickingTypeId"), width: "min-w-24" },
      { key: "dateStart", label: t("inventory.pickingWaves.columns.dateStart"), type: "datetime" },
    ],
    emptyMessage: t("inventory.pickingWaves.emptyMessage"),
  },
})

// ── Warehouse tasks ───────────────────────────────────────────────────────────
export const warehouseTasksTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "warehouse-tasks-table",
  title: t("inventory.warehouseTasks.title"),
  description: t("inventory.warehouseTasks.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name", "state"],
    columns: [
      { key: "name", label: t("inventory.warehouseTasks.columns.name"), width: "min-w-40" },
      { key: "taskType", label: t("inventory.warehouseTasks.columns.taskType"), width: "min-w-24" },
      { key: "state", label: t("inventory.warehouseTasks.columns.state"), type: "badge" },
      { key: "priority", label: t("inventory.warehouseTasks.columns.priority"), width: "min-w-20" },
      { key: "quantity", label: t("inventory.warehouseTasks.columns.quantity"), type: "number", align: "right" },
    ],
    emptyMessage: t("inventory.warehouseTasks.emptyMessage"),
  },
})

// ── Stock routes / rules (read-only lists) ───────────────────────────────────
export const stockRoutesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "stock-routes-table",
  title: t("inventory.stockRoutes.title"),
  description: t("inventory.stockRoutes.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("inventory.stockRoutes.columns.name"), width: "min-w-48" },
      { key: "sequence", label: t("inventory.stockRoutes.columns.sequence"), type: "number", align: "right" },
      { key: "active", label: t("inventory.stockRoutes.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("inventory.stockRoutes.emptyMessage"),
  },
})

export const stockRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "stock-rules-table",
  title: t("inventory.stockRules.title"),
  description: t("inventory.stockRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name", "action"],
    columns: [
      { key: "name", label: t("inventory.stockRules.columns.name"), width: "min-w-40" },
      { key: "action", label: t("inventory.stockRules.columns.action"), width: "min-w-24" },
      { key: "sequence", label: t("inventory.stockRules.columns.sequence"), type: "number", align: "right" },
      { key: "active", label: t("inventory.stockRules.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("inventory.stockRules.emptyMessage"),
  },
})

export const stockMovesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "stock-moves-table",
  title: t("inventory.stockMoves.title"),
  description: t("inventory.stockMoves.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.stockMoves.searchPlaceholder"),
    searchKeys: ["name", "reference", "origin"],
    filters: [
      {
        key: "state",
        label: t("inventory.stockMoves.filters.state.label"),
        type: "select",
        options: [
          { value: "draft", label: t("inventory.stockMoves.filters.state.options.draft") },
          { value: "confirmed", label: t("inventory.stockMoves.filters.state.options.confirmed") },
          { value: "assigned", label: t("inventory.stockMoves.filters.state.options.assigned") },
          { value: "done", label: t("inventory.stockMoves.filters.state.options.done") },
          { value: "cancel", label: t("inventory.stockMoves.filters.state.options.cancel") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("inventory.stockMoves.columns.name"), width: "min-w-32" },
      { key: "state", label: t("inventory.stockMoves.columns.state"), type: "badge" },
      { key: "productId", label: t("inventory.stockMoves.columns.productId"), width: "min-w-20" },
      { key: "locationId", label: t("inventory.stockMoves.columns.locationId"), width: "min-w-20" },
      { key: "locationDestId", label: t("inventory.stockMoves.columns.locationDestId"), width: "min-w-20" },
      {
        key: "productUomQty",
        label: t("inventory.stockMoves.columns.productUomQty"),
        type: "number",
        align: "right",
      },
    ],
    emptyMessage: t("inventory.stockMoves.emptyMessage"),
  },
})

export const inventoryValuationsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "inventory-valuations-table",
  title: t("inventory.inventoryValuations.title"),
  description: t("inventory.inventoryValuations.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name", "reference"],
    columns: [
      { key: "name", label: t("inventory.inventoryValuations.columns.name"), width: "min-w-40" },
      { key: "state", label: t("inventory.inventoryValuations.columns.state"), type: "badge" },
      { key: "productId", label: t("inventory.inventoryValuations.columns.productId"), width: "min-w-24" },
      {
        key: "value",
        label: t("inventory.inventoryValuations.columns.value"),
        type: "currency",
        align: "right",
      },
    ],
    emptyMessage: t("inventory.inventoryValuations.emptyMessage"),
  },
})

export const replenishmentRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "replenishment-rules-table",
  title: t("inventory.replenishmentRules.title"),
  description: t("inventory.replenishmentRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("inventory.replenishmentRules.columns.name"), width: "min-w-40" },
      { key: "active", label: t("inventory.replenishmentRules.columns.active"), type: "boolean" },
      {
        key: "sequence",
        label: t("inventory.replenishmentRules.columns.sequence"),
        type: "number",
        align: "right",
      },
    ],
    emptyMessage: t("inventory.replenishmentRules.emptyMessage"),
  },
})

export const productCategoriesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "product-categories-table",
  title: t("inventory.productCategories.title"),
  description: t("inventory.productCategories.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.productCategories.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("inventory.productCategories.columns.name"), width: "min-w-48" },
      { key: "parentId", label: t("inventory.productCategories.columns.parentId"), width: "min-w-24" },
      { key: "active", label: t("inventory.productCategories.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("inventory.productCategories.emptyMessage"),
  },
})

export const barcodeRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "barcode-rules-table",
  title: t("inventory.barcodeRules.title"),
  description: t("inventory.barcodeRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.barcodeRules.searchPlaceholder"),
    searchKeys: ["name", "pattern"],
    columns: [
      { key: "name", label: t("inventory.barcodeRules.columns.name"), width: "min-w-40" },
      { key: "pattern", label: t("inventory.barcodeRules.columns.pattern"), width: "min-w-36" },
      { key: "encoding", label: t("inventory.barcodeRules.columns.encoding"), width: "min-w-24" },
      { key: "isActive", label: t("inventory.barcodeRules.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("inventory.barcodeRules.emptyMessage"),
  },
})

export const adjustmentReasonsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "adjustment-reasons-table",
  title: t("inventory.adjustmentReasons.title"),
  description: t("inventory.adjustmentReasons.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.adjustmentReasons.searchPlaceholder"),
    searchKeys: ["code", "description"],
    columns: [
      { key: "code", label: t("inventory.adjustmentReasons.columns.code"), width: "min-w-28" },
      { key: "description", label: t("inventory.adjustmentReasons.columns.description"), width: "min-w-48" },
      { key: "isActive", label: t("inventory.adjustmentReasons.columns.isActive"), type: "boolean" },
      { key: "isSystem", label: t("inventory.adjustmentReasons.columns.isSystem"), type: "boolean" },
    ],
    emptyMessage: t("inventory.adjustmentReasons.emptyMessage"),
  },
})

export const barcodeNomenclaturesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "barcode-nomenclatures-table",
  title: t("inventory.barcodeNomenclatures.title"),
  description: t("inventory.barcodeNomenclatures.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.barcodeNomenclatures.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("inventory.barcodeNomenclatures.columns.name"), width: "min-w-40" },
      { key: "ruleIds", label: t("inventory.barcodeNomenclatures.columns.ruleIds"), width: "min-w-36" },
      { key: "isDefault", label: t("inventory.barcodeNomenclatures.columns.isDefault"), type: "boolean" },
      { key: "isActive", label: t("inventory.barcodeNomenclatures.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("inventory.barcodeNomenclatures.emptyMessage"),
  },
})

export const traceabilityRecordsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "traceability-records-table",
  title: t("inventory.traceabilityRecords.title"),
  description: t("inventory.traceabilityRecords.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.traceabilityRecords.searchPlaceholder"),
    searchKeys: ["documentType", "origin"],
    columns: [
      { key: "productId", label: t("inventory.traceabilityRecords.columns.productId"), width: "min-w-24" },
      { key: "documentType", label: t("inventory.traceabilityRecords.columns.documentType"), width: "min-w-28" },
      { key: "documentId", label: t("inventory.traceabilityRecords.columns.documentId"), width: "min-w-24" },
      {
        key: "quantity",
        label: t("inventory.traceabilityRecords.columns.quantity"),
        type: "number",
        align: "right",
      },
      { key: "uomId", label: t("inventory.traceabilityRecords.columns.uomId"), width: "min-w-20" },
      { key: "date", label: t("inventory.traceabilityRecords.columns.date"), type: "datetime" },
    ],
    emptyMessage: t("inventory.traceabilityRecords.emptyMessage"),
  },
})

const traceReportStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", running: "outline", done: "default", error: "destructive" },
  badgeLabels: {
    draft: t("inventory.traceabilityReports.states.draft"),
    running: t("inventory.traceabilityReports.states.running"),
    done: t("inventory.traceabilityReports.states.done"),
    error: t("inventory.traceabilityReports.states.error"),
  },
})

export const traceabilityReportsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "traceability-reports-table",
  title: t("inventory.traceabilityReports.title"),
  description: t("inventory.traceabilityReports.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("inventory.traceabilityReports.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("inventory.traceabilityReports.columns.name"), width: "min-w-40" },
      { key: "state", label: t("inventory.traceabilityReports.columns.state"), type: "badge", ...traceReportStateBadges(t) },
      { key: "dateFrom", label: t("inventory.traceabilityReports.columns.dateFrom"), type: "datetime" },
      { key: "dateTo", label: t("inventory.traceabilityReports.columns.dateTo"), type: "datetime" },
    ],
    emptyMessage: t("inventory.traceabilityReports.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const inventoryEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "products-table": productsTableConfig(t),
  "stock-quants-table": stockQuantsTableConfig(t),
  "transfers-table": transfersTableConfig(t),
  "warehouses-table": warehousesTableConfig(t),
  "inventory-adjustments-table": inventoryAdjustmentsTableConfig(t),
  "stock-locations-table": stockLocationsTableConfig(t),
  "production-lots-table": productionLotsTableConfig(t),
  "stock-production-serials-table": stockProductionSerialsTableConfig(t),
  "quality-checks-table": qualityChecksTableConfig(t),
  "quality-alerts-table": qualityAlertsTableConfig(t),
  "cycle-counts-table": cycleCountsTableConfig(t),
  "picking-waves-table": pickingWavesTableConfig(t),
  "warehouse-tasks-table": warehouseTasksTableConfig(t),
  "stock-routes-table": stockRoutesTableConfig(t),
  "stock-rules-table": stockRulesTableConfig(t),
  "stock-moves-table": stockMovesTableConfig(t),
  "inventory-valuations-table": inventoryValuationsTableConfig(t),
  "replenishment-rules-table": replenishmentRulesTableConfig(t),
  "product-categories-table": productCategoriesTableConfig(t),
  "barcode-rules-table": barcodeRulesTableConfig(t),
  "adjustment-reasons-table": adjustmentReasonsTableConfig(t),
  "barcode-nomenclatures-table": barcodeNomenclaturesTableConfig(t),
  "traceability-records-table": traceabilityRecordsTableConfig(t),
  "traceability-reports-table": traceabilityReportsTableConfig(t),
})
