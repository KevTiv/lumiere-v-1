import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const poStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    ToApprove: "outline",
    Approved: "default",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: "Draft",
    Sent: "Sent",
    ToApprove: "To Approve",
    Approved: "Purchase Order",
    Done: "Done",
    Cancelled: "Cancelled",
  },
} as const

const requisitionStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    InProgress: "outline",
    Approved: "default",
    Cancelled: "destructive",
    Closed: "secondary",
  },
  badgeLabels: {
    Draft: "Draft",
    Sent: "Sent",
    InProgress: "In Progress",
    Approved: "Approved",
    Cancelled: "Cancelled",
    Closed: "Closed",
  },
} as const

const lineStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Confirmed: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: "Draft",
    Confirmed: "Confirmed",
    Done: "Done",
    Cancelled: "Cancelled",
  },
} as const

// ── Purchase Orders ───────────────────────────────────────────────────────────
export const purchaseOrdersTableConfig: EntityViewConfig = {
  id: "purchase-orders-table",
  title: "Purchase Orders",
  description: "All purchase orders",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by reference or origin…",
    searchKeys: ["name", "origin", "partnerRef"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Sent", label: "Sent" },
          { value: "ToApprove", label: "To Approve" },
          { value: "Approved", label: "Purchase Order" },
          { value: "Done", label: "Done" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-32" },
      { key: "partnerId", label: "Vendor", width: "min-w-32" },
      { key: "state", label: "Status", type: "badge", ...poStateBadges },
      { key: "dateOrder", label: "Order Date", type: "date" },
      { key: "datePlanned", label: "Expected", type: "date" },
      { key: "amountUntaxed", label: "Subtotal", type: "currency", align: "right" },
      { key: "amountTotal", label: "Total", type: "currency", align: "right" },
    ],
    emptyMessage: "No purchase orders found.",
  },
}

// ── Purchase Order Lines ──────────────────────────────────────────────────────
export const purchaseOrderLinesTableConfig: EntityViewConfig = {
  id: "purchase-order-lines-table",
  title: "Order Lines",
  description: "Individual line items across all purchase orders",
  view: {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "orderId", label: "PO", width: "min-w-24" },
      { key: "productId", label: "Product", width: "min-w-40" },
      { key: "productQty", label: "Qty Ordered", type: "number", align: "right" },
      { key: "qtyReceived", label: "Qty Received", type: "number", align: "right" },
      { key: "qtyToInvoice", label: "Qty to Bill", type: "number", align: "right" },
      { key: "priceUnit", label: "Unit Price", type: "currency", align: "right" },
      { key: "priceSubtotal", label: "Subtotal", type: "currency", align: "right" },
      { key: "state", label: "Status", type: "badge", ...lineStateBadges },
      { key: "datePlanned", label: "Expected", type: "date" },
    ],
    emptyMessage: "No order lines found.",
  },
}

// ── Purchase Requisitions ─────────────────────────────────────────────────────
export const purchaseRequisitionsTableConfig: EntityViewConfig = {
  id: "purchase-requisitions-table",
  title: "Purchase Agreements",
  description: "Blanket orders and purchase agreements",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search agreements…",
    searchKeys: ["origin"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Sent", label: "Sent" },
          { value: "InProgress", label: "In Progress" },
          { value: "Approved", label: "Approved" },
          { value: "Cancelled", label: "Cancelled" },
          { value: "Closed", label: "Closed" },
        ],
      },
    ],
    columns: [
      { key: "origin", label: "Source Document", width: "min-w-36" },
      { key: "vendorId", label: "Vendor", width: "min-w-32" },
      { key: "state", label: "Status", type: "badge", ...requisitionStateBadges },
      { key: "orderingDate", label: "Ordering Date", type: "date" },
      { key: "dateEnd", label: "Expiry Date", type: "date" },
      { key: "orderCount", label: "Orders", type: "number", align: "right" },
    ],
    emptyMessage: "No purchase agreements found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const purchasingEntityConfigs: Record<string, EntityViewConfig> = {
  "purchase-orders-table": purchaseOrdersTableConfig,
  "purchase-order-lines-table": purchaseOrderLinesTableConfig,
  "purchase-requisitions-table": purchaseRequisitionsTableConfig,
}
