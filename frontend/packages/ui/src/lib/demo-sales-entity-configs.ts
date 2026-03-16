import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const saleStateBadges = {
  badgeVariants: { Draft: "secondary", Sent: "outline", Sale: "default", Done: "default", Cancel: "destructive" },
  badgeLabels: { Draft: "Draft", Sent: "Sent", Sale: "Confirmed", Done: "Done", Cancel: "Cancelled" },
} as const

const invoiceStatusBadges = {
  badgeVariants: { Nothing: "secondary", ToInvoice: "outline", InvoicedPartially: "outline", Invoiced: "default" },
  badgeLabels: { Nothing: "Nothing", ToInvoice: "To Invoice", InvoicedPartially: "Partial", Invoiced: "Invoiced" },
} as const

const batchStateBadges = {
  badgeVariants: { Draft: "secondary", InProgress: "outline", Done: "default", Cancel: "destructive" },
  badgeLabels: { Draft: "Draft", InProgress: "In Progress", Done: "Done", Cancel: "Cancelled" },
} as const

const discountPolicyBadges = {
  badgeVariants: { WithoutDiscount: "secondary", WithDiscount: "default" },
  badgeLabels: { WithoutDiscount: "No Discount", WithDiscount: "With Discount" },
} as const

// ── Sale Orders ───────────────────────────────────────────────────────────────
export const saleOrdersTableConfig: EntityViewConfig = {
  id: "sale-orders-table",
  title: "Sales Orders",
  description: "All sales orders",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by reference or customer ref…",
    searchKeys: ["reference", "clientOrderRef"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Sent", label: "Sent" },
          { value: "Sale", label: "Confirmed" },
          { value: "Done", label: "Done" },
          { value: "Cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "reference", label: "Order #", width: "min-w-28" },
      { key: "clientOrderRef", label: "Customer Ref", width: "min-w-28" },
      { key: "state", label: "Status", type: "badge", ...saleStateBadges },
      { key: "amountTotal", label: "Total", type: "currency", align: "right" },
      { key: "amountResidual", label: "Outstanding", type: "currency", align: "right" },
      { key: "invoiceStatus", label: "Invoice", type: "badge", ...invoiceStatusBadges },
      { key: "dateOrder", label: "Order Date", type: "date" },
      { key: "deliveryCount", label: "Deliveries", type: "number", align: "right" },
    ],
    emptyMessage: "No sales orders found.",
  },
}

// ── Sale Order Lines ──────────────────────────────────────────────────────────
export const saleOrderLinesTableConfig: EntityViewConfig = {
  id: "sale-order-lines-table",
  title: "Order Lines",
  description: "Individual line items across all sales orders",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by product or description…",
    searchKeys: ["name"],
    columns: [
      { key: "orderId", label: "Order ID", width: "min-w-20" },
      { key: "name", label: "Product / Description", width: "min-w-48" },
      { key: "productUomQty", label: "Qty Ordered", type: "number", align: "right" },
      { key: "qtyDelivered", label: "Delivered", type: "number", align: "right" },
      { key: "qtyInvoiced", label: "Invoiced", type: "number", align: "right" },
      { key: "priceUnit", label: "Unit Price", type: "currency", align: "right" },
      { key: "priceSubtotal", label: "Subtotal", type: "currency", align: "right" },
      { key: "discount", label: "Disc %", type: "percent", align: "right" },
    ],
    emptyMessage: "No order lines found.",
  },
}

// ── Pricelists ────────────────────────────────────────────────────────────────
export const pricelistsTableConfig: EntityViewConfig = {
  id: "pricelists-table",
  title: "Pricelists",
  description: "Product pricelists and pricing rules",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search pricelists…",
    searchKeys: ["name"],
    columns: [
      { key: "name", label: "Name", width: "min-w-40" },
      { key: "currencyId", label: "Currency", width: "min-w-20" },
      { key: "discountPolicy", label: "Discount Policy", type: "badge", ...discountPolicyBadges },
      { key: "active", label: "Active", type: "boolean" },
    ],
    emptyMessage: "No pricelists found.",
  },
}

// ── Deliveries (picking batches) ──────────────────────────────────────────────
export const deliveriesTableConfig: EntityViewConfig = {
  id: "deliveries-table",
  title: "Deliveries",
  description: "Stock picking batches and delivery runs",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search deliveries…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "InProgress", label: "In Progress" },
          { value: "Done", label: "Done" },
          { value: "Cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Batch", width: "min-w-28" },
      { key: "state", label: "Status", type: "badge", ...batchStateBadges },
      { key: "scheduledDate", label: "Scheduled", type: "date" },
      { key: "pickingType", label: "Operation", type: "text" },
    ],
    emptyMessage: "No deliveries found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const salesEntityConfigs: Record<string, EntityViewConfig> = {
  "sale-orders-table": saleOrdersTableConfig,
  "sale-order-lines-table": saleOrderLinesTableConfig,
  "pricelists-table": pricelistsTableConfig,
  "deliveries-table": deliveriesTableConfig,
}
