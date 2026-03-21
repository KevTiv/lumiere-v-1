import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const poStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    ToApprove: "outline",
    Approved: "default",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: t("purchasing.purchaseOrders.states.Draft"),
    Sent: t("purchasing.purchaseOrders.states.Sent"),
    ToApprove: t("purchasing.purchaseOrders.states.ToApprove"),
    Approved: t("purchasing.purchaseOrders.states.Approved"),
    Done: t("purchasing.purchaseOrders.states.Done"),
    Cancelled: t("purchasing.purchaseOrders.states.Cancelled"),
  },
}) as const

const requisitionStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    InProgress: "outline",
    Approved: "default",
    Cancelled: "destructive",
    Closed: "secondary",
  },
  badgeLabels: {
    Draft: t("purchasing.purchaseAgreements.states.Draft"),
    Sent: t("purchasing.purchaseAgreements.states.Sent"),
    InProgress: t("purchasing.purchaseAgreements.states.InProgress"),
    Approved: t("purchasing.purchaseAgreements.states.Approved"),
    Cancelled: t("purchasing.purchaseAgreements.states.Cancelled"),
    Closed: t("purchasing.purchaseAgreements.states.Closed"),
  },
}) as const

const lineStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Confirmed: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: t("purchasing.orderLines.states.Draft"),
    Confirmed: t("purchasing.orderLines.states.Confirmed"),
    Done: t("purchasing.orderLines.states.Done"),
    Cancelled: t("purchasing.orderLines.states.Cancelled"),
  },
}) as const

// ── Purchase Orders ───────────────────────────────────────────────────────────
export const purchaseOrdersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-orders-table",
  title: t("purchasing.purchaseOrders.title"),
  description: t("purchasing.purchaseOrders.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.purchaseOrders.searchPlaceholder"),
    searchKeys: ["name", "origin", "partnerRef"],
    filters: [
      {
        key: "state",
        label: t("purchasing.purchaseOrders.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("purchasing.purchaseOrders.filters.state.options.Draft") },
          { value: "Sent", label: t("purchasing.purchaseOrders.filters.state.options.Sent") },
          { value: "ToApprove", label: t("purchasing.purchaseOrders.filters.state.options.ToApprove") },
          { value: "Approved", label: t("purchasing.purchaseOrders.filters.state.options.Approved") },
          { value: "Done", label: t("purchasing.purchaseOrders.filters.state.options.Done") },
          { value: "Cancelled", label: t("purchasing.purchaseOrders.filters.state.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("purchasing.purchaseOrders.columns.name"), width: "min-w-32" },
      { key: "partnerId", label: t("purchasing.purchaseOrders.columns.partnerId"), width: "min-w-32" },
      { key: "state", label: t("purchasing.purchaseOrders.columns.state"), type: "badge", ...poStateBadges(t) },
      { key: "dateOrder", label: t("purchasing.purchaseOrders.columns.dateOrder"), type: "date" },
      { key: "datePlanned", label: t("purchasing.purchaseOrders.columns.datePlanned"), type: "date" },
      { key: "amountUntaxed", label: t("purchasing.purchaseOrders.columns.amountUntaxed"), type: "currency", align: "right" },
      { key: "amountTotal", label: t("purchasing.purchaseOrders.columns.amountTotal"), type: "currency", align: "right" },
    ],
    emptyMessage: t("purchasing.purchaseOrders.emptyMessage"),
  },
})

// ── Purchase Order Lines ──────────────────────────────────────────────────────
export const purchaseOrderLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-order-lines-table",
  title: t("purchasing.orderLines.title"),
  description: t("purchasing.orderLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "orderId", label: t("purchasing.orderLines.columns.orderId"), width: "min-w-24" },
      { key: "productId", label: t("purchasing.orderLines.columns.productId"), width: "min-w-40" },
      { key: "productQty", label: t("purchasing.orderLines.columns.productQty"), type: "number", align: "right" },
      { key: "qtyReceived", label: t("purchasing.orderLines.columns.qtyReceived"), type: "number", align: "right" },
      { key: "qtyToInvoice", label: t("purchasing.orderLines.columns.qtyToInvoice"), type: "number", align: "right" },
      { key: "priceUnit", label: t("purchasing.orderLines.columns.priceUnit"), type: "currency", align: "right" },
      { key: "priceSubtotal", label: t("purchasing.orderLines.columns.priceSubtotal"), type: "currency", align: "right" },
      { key: "state", label: t("purchasing.orderLines.columns.state"), type: "badge", ...lineStateBadges(t) },
      { key: "datePlanned", label: t("purchasing.orderLines.columns.datePlanned"), type: "date" },
    ],
    emptyMessage: t("purchasing.orderLines.emptyMessage"),
  },
})

// ── Purchase Requisitions ─────────────────────────────────────────────────────
export const purchaseRequisitionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-requisitions-table",
  title: t("purchasing.purchaseAgreements.title"),
  description: t("purchasing.purchaseAgreements.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.purchaseAgreements.searchPlaceholder"),
    searchKeys: ["origin"],
    filters: [
      {
        key: "state",
        label: t("purchasing.purchaseAgreements.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("purchasing.purchaseAgreements.filters.state.options.Draft") },
          { value: "Sent", label: t("purchasing.purchaseAgreements.filters.state.options.Sent") },
          { value: "InProgress", label: t("purchasing.purchaseAgreements.filters.state.options.InProgress") },
          { value: "Approved", label: t("purchasing.purchaseAgreements.filters.state.options.Approved") },
          { value: "Cancelled", label: t("purchasing.purchaseAgreements.filters.state.options.Cancelled") },
          { value: "Closed", label: t("purchasing.purchaseAgreements.filters.state.options.Closed") },
        ],
      },
    ],
    columns: [
      { key: "origin", label: t("purchasing.purchaseAgreements.columns.origin"), width: "min-w-36" },
      { key: "vendorId", label: t("purchasing.purchaseAgreements.columns.vendorId"), width: "min-w-32" },
      { key: "state", label: t("purchasing.purchaseAgreements.columns.state"), type: "badge", ...requisitionStateBadges(t) },
      { key: "orderingDate", label: t("purchasing.purchaseAgreements.columns.orderingDate"), type: "date" },
      { key: "dateEnd", label: t("purchasing.purchaseAgreements.columns.dateEnd"), type: "date" },
      { key: "orderCount", label: t("purchasing.purchaseAgreements.columns.orderCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("purchasing.purchaseAgreements.emptyMessage"),
  },
})

// ── Vendors ───────────────────────────────────────────────────────────────────
export const vendorsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "vendors-table",
  title: t("purchasing.vendors.title"),
  description: t("purchasing.vendors.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.vendors.searchPlaceholder"),
    searchKeys: ["name", "email", "taxId"],
    columns: [
      { key: "name", label: t("purchasing.vendors.columns.name"), width: "min-w-48" },
      { key: "email", label: t("purchasing.vendors.columns.email"), width: "min-w-44" },
      { key: "phone", label: t("purchasing.vendors.columns.phone"), width: "min-w-28" },
      { key: "city", label: t("purchasing.vendors.columns.city"), width: "min-w-24" },
      { key: "countryId", label: t("purchasing.vendors.columns.countryId"), width: "min-w-20" },
      { key: "taxId", label: t("purchasing.vendors.columns.taxId"), width: "min-w-28" },
    ],
    emptyMessage: t("purchasing.vendors.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const purchasingEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "purchase-orders-table": purchaseOrdersTableConfig(t),
  "purchase-order-lines-table": purchaseOrderLinesTableConfig(t),
  "purchase-requisitions-table": purchaseRequisitionsTableConfig(t),
  "vendors-table": vendorsTableConfig(t),
})
