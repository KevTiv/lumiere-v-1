import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const saleStateBadges = (t: TFunction) => ({
  badgeVariants: { Draft: "secondary", Sent: "outline", Sale: "default", Done: "default", Cancel: "destructive" },
  badgeLabels: {
    Draft: t("sales.salesOrders.states.Draft"),
    Sent: t("sales.salesOrders.states.Sent"),
    Sale: t("sales.salesOrders.states.Sale"),
    Done: t("sales.salesOrders.states.Done"),
    Cancel: t("sales.salesOrders.states.Cancel"),
  },
}) as const

const invoiceStatusBadges = (t: TFunction) => ({
  badgeVariants: { Nothing: "secondary", ToInvoice: "outline", InvoicedPartially: "outline", Invoiced: "default" },
  badgeLabels: {
    Nothing: t("sales.salesOrders.invoiceStates.Nothing"),
    ToInvoice: t("sales.salesOrders.invoiceStates.ToInvoice"),
    InvoicedPartially: t("sales.salesOrders.invoiceStates.InvoicedPartially"),
    Invoiced: t("sales.salesOrders.invoiceStates.Invoiced"),
  },
}) as const

const batchStateBadges = (t: TFunction) => ({
  badgeVariants: { Draft: "secondary", InProgress: "outline", Done: "default", Cancel: "destructive" },
  badgeLabels: {
    Draft: t("sales.deliveries.states.Draft"),
    InProgress: t("sales.deliveries.states.InProgress"),
    Done: t("sales.deliveries.states.Done"),
    Cancel: t("sales.deliveries.states.Cancel"),
  },
}) as const

const discountPolicyBadges = (t: TFunction) => ({
  badgeVariants: { WithoutDiscount: "secondary", WithDiscount: "default" },
  badgeLabels: {
    WithoutDiscount: t("sales.pricelists.states.WithoutDiscount"),
    WithDiscount: t("sales.pricelists.states.WithDiscount"),
  },
}) as const

// ── Sale Orders ───────────────────────────────────────────────────────────────
export const saleOrdersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "sale-orders-table",
  title: t("sales.salesOrders.title"),
  description: t("sales.salesOrders.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.salesOrders.searchPlaceholder"),
    searchKeys: ["reference", "clientOrderRef"],
    filters: [
      {
        key: "state",
        label: t("sales.salesOrders.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("sales.salesOrders.filters.state.options.Draft") },
          { value: "Sent", label: t("sales.salesOrders.filters.state.options.Sent") },
          { value: "Sale", label: t("sales.salesOrders.filters.state.options.Sale") },
          { value: "Done", label: t("sales.salesOrders.filters.state.options.Done") },
          { value: "Cancel", label: t("sales.salesOrders.filters.state.options.Cancel") },
        ],
      },
    ],
    columns: [
      { key: "reference", label: t("sales.salesOrders.columns.reference"), width: "min-w-28" },
      { key: "clientOrderRef", label: t("sales.salesOrders.columns.clientOrderRef"), width: "min-w-28" },
      { key: "state", label: t("sales.salesOrders.columns.state"), type: "badge", ...saleStateBadges(t) },
      { key: "amountTotal", label: t("sales.salesOrders.columns.amountTotal"), type: "currency", align: "right" },
      { key: "amountResidual", label: t("sales.salesOrders.columns.amountResidual"), type: "currency", align: "right" },
      { key: "invoiceStatus", label: t("sales.salesOrders.columns.invoiceStatus"), type: "badge", ...invoiceStatusBadges(t) },
      { key: "dateOrder", label: t("sales.salesOrders.columns.dateOrder"), type: "date" },
      { key: "deliveryCount", label: t("sales.salesOrders.columns.deliveryCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("sales.salesOrders.emptyMessage"),
  },
})

// ── Sale Order Lines ──────────────────────────────────────────────────────────
export const saleOrderLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "sale-order-lines-table",
  title: t("sales.orderLines.title"),
  description: t("sales.orderLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.orderLines.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "orderId", label: t("sales.orderLines.columns.orderId"), width: "min-w-20" },
      { key: "name", label: t("sales.orderLines.columns.name"), width: "min-w-48" },
      { key: "productUomQty", label: t("sales.orderLines.columns.productUomQty"), type: "number", align: "right" },
      { key: "qtyDelivered", label: t("sales.orderLines.columns.qtyDelivered"), type: "number", align: "right" },
      { key: "qtyInvoiced", label: t("sales.orderLines.columns.qtyInvoiced"), type: "number", align: "right" },
      { key: "priceUnit", label: t("sales.orderLines.columns.priceUnit"), type: "currency", align: "right" },
      { key: "priceSubtotal", label: t("sales.orderLines.columns.priceSubtotal"), type: "currency", align: "right" },
      { key: "discount", label: t("sales.orderLines.columns.discount"), type: "percent", align: "right" },
    ],
    emptyMessage: t("sales.orderLines.emptyMessage"),
  },
})

// ── Pricelists ────────────────────────────────────────────────────────────────
export const pricelistsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pricelists-table",
  title: t("sales.pricelists.title"),
  description: t("sales.pricelists.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.pricelists.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("sales.pricelists.columns.name"), width: "min-w-40" },
      { key: "currencyId", label: t("sales.pricelists.columns.currencyId"), width: "min-w-20" },
      { key: "discountPolicy", label: t("sales.pricelists.columns.discountPolicy"), type: "badge", ...discountPolicyBadges(t) },
      { key: "active", label: t("sales.pricelists.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("sales.pricelists.emptyMessage"),
  },
})

// ── Deliveries (picking batches) ──────────────────────────────────────────────
export const deliveriesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "deliveries-table",
  title: t("sales.deliveries.title"),
  description: t("sales.deliveries.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.deliveries.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("sales.deliveries.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("sales.deliveries.filters.state.options.Draft") },
          { value: "InProgress", label: t("sales.deliveries.filters.state.options.InProgress") },
          { value: "Done", label: t("sales.deliveries.filters.state.options.Done") },
          { value: "Cancel", label: t("sales.deliveries.filters.state.options.Cancel") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("sales.deliveries.columns.name"), width: "min-w-28" },
      { key: "state", label: t("sales.deliveries.columns.state"), type: "badge", ...batchStateBadges(t) },
      { key: "scheduledDate", label: t("sales.deliveries.columns.scheduledDate"), type: "date" },
      { key: "pickingType", label: t("sales.deliveries.columns.pickingType"), type: "text" },
    ],
    emptyMessage: t("sales.deliveries.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const salesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "sale-orders-table": saleOrdersTableConfig(t),
  "sale-order-lines-table": saleOrderLinesTableConfig(t),
  "pricelists-table": pricelistsTableConfig(t),
  "deliveries-table": deliveriesTableConfig(t),
})
