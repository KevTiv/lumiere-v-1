import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const moStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Confirmed: "outline",
    Progress: "default",
    ToClose: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: t("manufacturing.manufacturingOrders.states.Draft"),
    Confirmed: t("manufacturing.manufacturingOrders.states.Confirmed"),
    Progress: t("manufacturing.manufacturingOrders.states.Progress"),
    ToClose: t("manufacturing.manufacturingOrders.states.ToClose"),
    Done: t("manufacturing.manufacturingOrders.states.Done"),
    Cancelled: t("manufacturing.manufacturingOrders.states.Cancelled"),
  },
})

const workorderStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Pending: "secondary",
    Ready: "outline",
    Progress: "default",
    Done: "default",
    Cancel: "destructive",
  },
  badgeLabels: {
    Pending: t("manufacturing.workOrders.states.Pending"),
    Ready: t("manufacturing.workOrders.states.Ready"),
    Progress: t("manufacturing.workOrders.states.Progress"),
    Done: t("manufacturing.workOrders.states.Done"),
    Cancel: t("manufacturing.workOrders.states.Cancel"),
  },
})

const bomTypeBadges = (t: TFunction) => ({
  badgeVariants: {
    Normal: "default",
    Phantom: "outline",
    Kit: "secondary",
    Subcontracting: "outline",
  },
  badgeLabels: {
    Normal: t("manufacturing.billsOfMaterials.states.Normal"),
    Phantom: t("manufacturing.billsOfMaterials.states.Phantom"),
    Kit: t("manufacturing.billsOfMaterials.states.Kit"),
    Subcontracting: t("manufacturing.billsOfMaterials.states.Subcontracting"),
  },
})

// ── Manufacturing Orders ──────────────────────────────────────────────────────
export const manufacturingOrdersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "manufacturing-orders-table",
  title: t("manufacturing.manufacturingOrders.title"),
  description: t("manufacturing.manufacturingOrders.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("manufacturing.manufacturingOrders.searchPlaceholder"),
    searchKeys: ["name", "origin"],
    filters: [
      {
        key: "state",
        label: t("manufacturing.manufacturingOrders.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("manufacturing.manufacturingOrders.filters.state.options.Draft") },
          { value: "Confirmed", label: t("manufacturing.manufacturingOrders.filters.state.options.Confirmed") },
          { value: "Progress", label: t("manufacturing.manufacturingOrders.filters.state.options.Progress") },
          { value: "ToClose", label: t("manufacturing.manufacturingOrders.filters.state.options.ToClose") },
          { value: "Done", label: t("manufacturing.manufacturingOrders.filters.state.options.Done") },
          { value: "Cancelled", label: t("manufacturing.manufacturingOrders.filters.state.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("manufacturing.manufacturingOrders.columns.name"), width: "min-w-32" },
      { key: "productId", label: t("manufacturing.manufacturingOrders.columns.productId"), width: "min-w-40" },
      { key: "productQty", label: t("manufacturing.manufacturingOrders.columns.productQty"), type: "number", align: "right" },
      { key: "qtyProducing", label: t("manufacturing.manufacturingOrders.columns.qtyProducing"), type: "number", align: "right" },
      { key: "state", label: t("manufacturing.manufacturingOrders.columns.state"), type: "badge", ...moStateBadges(t) },
      { key: "datePlannedStart", label: t("manufacturing.manufacturingOrders.columns.datePlannedStart"), type: "date" },
      { key: "datePlannedFinished", label: t("manufacturing.manufacturingOrders.columns.datePlannedFinished"), type: "date" },
      { key: "origin", label: t("manufacturing.manufacturingOrders.columns.origin"), width: "min-w-24" },
    ],
    emptyMessage: t("manufacturing.manufacturingOrders.emptyMessage"),
  },
})

// ── Bills of Materials ────────────────────────────────────────────────────────
export const bomsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "boms-table",
  title: t("manufacturing.billsOfMaterials.title"),
  description: t("manufacturing.billsOfMaterials.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("manufacturing.billsOfMaterials.searchPlaceholder"),
    searchKeys: ["productId"],
    filters: [
      {
        key: "type",
        label: t("manufacturing.billsOfMaterials.filters.type"),
        type: "select",
        options: [
          { value: "Normal", label: t("manufacturing.billsOfMaterials.filters.type.options.Normal") },
          { value: "Phantom", label: t("manufacturing.billsOfMaterials.filters.type.options.Phantom") },
          { value: "Kit", label: t("manufacturing.billsOfMaterials.filters.type.options.Kit") },
          { value: "Subcontracting", label: t("manufacturing.billsOfMaterials.filters.type.options.Subcontracting") },
        ],
      },
    ],
    columns: [
      { key: "productId", label: t("manufacturing.billsOfMaterials.columns.productId"), width: "min-w-40" },
      { key: "productTmplId", label: t("manufacturing.billsOfMaterials.columns.productTmplId"), width: "min-w-32" },
      { key: "type", label: t("manufacturing.billsOfMaterials.columns.type"), type: "badge", ...bomTypeBadges(t) },
      { key: "productQty", label: t("manufacturing.billsOfMaterials.columns.productQty"), type: "number", align: "right" },
      { key: "estimatedCost", label: t("manufacturing.billsOfMaterials.columns.estimatedCost"), type: "currency", align: "right" },
      { key: "routingId", label: t("manufacturing.billsOfMaterials.columns.routingId"), width: "min-w-24" },
    ],
    emptyMessage: t("manufacturing.billsOfMaterials.emptyMessage"),
  },
})

// ── Work Orders ───────────────────────────────────────────────────────────────
export const workordersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workorders-table",
  title: t("manufacturing.workOrders.title"),
  description: t("manufacturing.workOrders.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("manufacturing.workOrders.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("manufacturing.workOrders.filters.state"),
        type: "select",
        options: [
          { value: "Pending", label: t("manufacturing.workOrders.filters.state.options.Pending") },
          { value: "Ready", label: t("manufacturing.workOrders.filters.state.options.Ready") },
          { value: "Progress", label: t("manufacturing.workOrders.filters.state.options.Progress") },
          { value: "Done", label: t("manufacturing.workOrders.filters.state.options.Done") },
          { value: "Cancel", label: t("manufacturing.workOrders.filters.state.options.Cancel") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("manufacturing.workOrders.columns.name"), width: "min-w-36" },
      { key: "productionId", label: t("manufacturing.workOrders.columns.productionId"), width: "min-w-28" },
      { key: "workcenterId", label: t("manufacturing.workOrders.columns.workcenterId"), width: "min-w-32" },
      { key: "state", label: t("manufacturing.workOrders.columns.state"), type: "badge", ...workorderStateBadges(t) },
      { key: "durationExpected", label: t("manufacturing.workOrders.columns.durationExpected"), type: "number", align: "right" },
      { key: "duration", label: t("manufacturing.workOrders.columns.duration"), type: "number", align: "right" },
      { key: "dateStart", label: t("manufacturing.workOrders.columns.dateStart"), type: "date" },
      { key: "dateFinished", label: t("manufacturing.workOrders.columns.dateFinished"), type: "date" },
    ],
    emptyMessage: t("manufacturing.workOrders.emptyMessage"),
  },
})

// ── Work Centers ──────────────────────────────────────────────────────────────
export const workcentersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workcenters-table",
  title: t("manufacturing.workCenters.title"),
  description: t("manufacturing.workCenters.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("manufacturing.workCenters.searchPlaceholder"),
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: t("manufacturing.workCenters.columns.name"), width: "min-w-36" },
      { key: "code", label: t("manufacturing.workCenters.columns.code"), width: "min-w-20" },
      { key: "active", label: t("manufacturing.workCenters.columns.active"), type: "boolean" },
      { key: "timeEfficiency", label: t("manufacturing.workCenters.columns.timeEfficiency"), type: "number", align: "right" },
      { key: "oee", label: t("manufacturing.workCenters.columns.oee"), type: "number", align: "right" },
      { key: "capacity", label: t("manufacturing.workCenters.columns.capacity"), type: "number", align: "right" },
      { key: "workorderCount", label: t("manufacturing.workCenters.columns.workorderCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("manufacturing.workCenters.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const manufacturingEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "manufacturing-orders-table": manufacturingOrdersTableConfig(t),
  "boms-table": bomsTableConfig(t),
  "workorders-table": workordersTableConfig(t),
  "workcenters-table": workcentersTableConfig(t),
})
