import { entityColumnLayouts } from "./entity-column-layouts"
import type { TFunction } from "i18next"
import Link from "next/link"
import { createElement } from "react"
import type { EntityDetailConfig, EntityViewConfig } from "./entity-view-types"

export const purchaseOrderListFieldAliases: Readonly<Record<string, string | null>> = {
  ponumber: "name",
  vendor: "partnerId",
  orderdate: "dateOrder",
  expecteddate: "datePlanned",
  status: "state",
  tags: null,
}

// ── Badge maps ────────────────────────────────────────────────────────────────
const poInvoiceStatusBadges = (t: TFunction) => ({
  badgeVariants: {
    No: "secondary",
    Partial: "outline",
    Invoiced: "default",
  },
  badgeLabels: {
    No: t("purchasing.purchaseOrders.invoiceStatus.No"),
    Partial: t("purchasing.purchaseOrders.invoiceStatus.Partial"),
    Invoiced: t("purchasing.purchaseOrders.invoiceStatus.Invoiced"),
  },
}) as const

const poStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    ToApprove: "outline",
    Approved: "default",
    Purchase: "default",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: t("purchasing.purchaseOrders.states.Draft"),
    Sent: t("purchasing.purchaseOrders.states.Sent"),
    ToApprove: t("purchasing.purchaseOrders.states.ToApprove"),
    Approved: t("purchasing.purchaseOrders.states.Approved"),
    Purchase: t("purchasing.purchaseOrders.states.Purchase", { defaultValue: "Purchase order" }),
    Done: t("purchasing.purchaseOrders.states.Done"),
    Cancelled: t("purchasing.purchaseOrders.states.Cancelled"),
  },
}) as const

export const purchaseOrderStatusBadges = poStateBadges

export type PurchaseOrdersTableConfigOptions = {
  /** Empty-state CTA — wired by the module client (opens create form). */
  onEmptyAction?: () => void
  /** Where an order has a page of its own: the reference then links to it. */
  recordHref?: (row: Record<string, unknown>) => string | undefined
}

export const purchaseOrderDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "vendor",
      fields: [
        { key: "partnerId", label: t("purchasing.purchaseOrders.columns.partnerId") },
        { key: "name", label: t("purchasing.purchaseOrders.columns.name") },
      ],
    },
    {
      id: "dates",
      fields: [
        { key: "dateOrder", label: t("purchasing.purchaseOrders.columns.dateOrder"), type: "relative-date" },
        { key: "datePlanned", label: t("purchasing.purchaseOrders.columns.datePlanned"), type: "relative-date" },
      ],
    },
    {
      id: "totals",
      fields: [
        { key: "amountUntaxed", label: t("purchasing.purchaseOrders.columns.amountUntaxed"), type: "currency" },
        { key: "amountTotal", label: t("purchasing.purchaseOrders.columns.amountTotal"), type: "currency" },
        {
          key: "invoiceStatus",
          label: t("purchasing.purchaseOrders.columns.invoiceStatus"),
          type: "badge",
          ...poInvoiceStatusBadges(t),
        },
        { key: "receiptStatus", label: t("purchasing.purchaseOrders.columns.receiptStatus"), type: "text" },
      ],
    },
  ],
})

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
export const purchaseOrdersTableConfig = (
  t: TFunction,
  options?: PurchaseOrdersTableConfigOptions,
): EntityViewConfig => ({
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
        label: t("purchasing.purchaseOrders.filters.state.label"),
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
      {
        key: "name",
        label: t("purchasing.purchaseOrders.columns.name"),
        layout: entityColumnLayouts.reference,
        sortable: true,
        ...(options?.recordHref
          ? {
              render: (_value: unknown, row: Record<string, unknown>) => {
                const shown = String(row.name ?? "").trim()
                const href = options.recordHref?.(row)
                if (!shown || !href) return shown || "—"
                // The row itself opens a preview; the reference opens the page.
                const linkProps = {
                  href,
                  className: "font-medium text-primary hover:underline",
                  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                  "data-testid": `purchase-order-link-${String(row.id)}`,
                }
                return createElement(Link, linkProps, shown)
              },
            }
          : {}),
      },
      { key: "partnerId", label: t("purchasing.purchaseOrders.columns.partnerId"), layout: entityColumnLayouts.identity },
      {
        key: "fulfillmentLabel",
        label: t("purchasing.purchaseOrders.columns.fulfillment", {
          defaultValue: "Fulfillment",
        }),
        type: "badge",
        layout: entityColumnLayouts.reference,
        badgeVariants: {
          Dropship: "outline",
          Standard: "secondary",
        },
        badgeLabels: {
          Dropship: t("purchasing.purchaseOrders.fulfillment.dropship", {
            defaultValue: "Dropship",
          }),
          Standard: t("purchasing.purchaseOrders.fulfillment.standard", {
            defaultValue: "Standard",
          }),
        },
      },
      {
        key: "state",
        label: t("purchasing.purchaseOrders.columns.state"),
        type: "status",
        sortable: true,
        ...poStateBadges(t),
      },
      {
        key: "dateOrder",
        label: t("purchasing.purchaseOrders.columns.dateOrder"),
        type: "relative-date",
        sortable: true,
      },
      { key: "datePlanned", label: t("purchasing.purchaseOrders.columns.datePlanned"), type: "relative-date" },
      { key: "amountUntaxed", defaultHidden: true, label: t("purchasing.purchaseOrders.columns.amountUntaxed"), type: "currency", align: "right" },
      {
        key: "amountTotal",
        label: t("purchasing.purchaseOrders.columns.amountTotal"),
        type: "currency",
        align: "right",
        sortable: true,
      },
      { key: "receiptStatus", label: t("purchasing.purchaseOrders.columns.receiptStatus"), type: "text" },
      {
        key: "invoiceStatus",
        label: t("purchasing.purchaseOrders.columns.invoiceStatus"),
        type: "badge",
        ...poInvoiceStatusBadges(t),
      },
    ],
    emptyMessage: t("purchasing.purchaseOrders.emptyMessage"),
    emptyState: {
      title: t("purchasing.purchaseOrders.emptyState.title"),
      description: t("purchasing.purchaseOrders.emptyState.description"),
      actionLabel: t("purchasing.purchaseOrders.emptyState.actionLabel"),
      onAction: options?.onEmptyAction,
      permission: { resource: "purchase_order", action: "create" },
      secondaryActionId: "csv-purchase-orders",
      learnHint: t("purchasing.purchaseOrders.emptyState.hint", { defaultValue: "Confirmed purchase orders drive receipts and vendor bills, so spend stays traceable." }),
    },
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
      { key: "orderId", label: t("purchasing.orderLines.columns.orderId"), layout: entityColumnLayouts.reference },
      { key: "productId", label: t("purchasing.orderLines.columns.productId"), layout: entityColumnLayouts.identity },
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
        label: t("purchasing.purchaseAgreements.filters.state.label"),
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
      { key: "origin", label: t("purchasing.purchaseAgreements.columns.origin"), layout: entityColumnLayouts.identity },
      { key: "vendorId", label: t("purchasing.purchaseAgreements.columns.vendorId"), layout: entityColumnLayouts.identity },
      { key: "state", label: t("purchasing.purchaseAgreements.columns.state"), type: "badge", ...requisitionStateBadges(t) },
      { key: "orderingDate", label: t("purchasing.purchaseAgreements.columns.orderingDate"), type: "date" },
      { key: "dateEnd", label: t("purchasing.purchaseAgreements.columns.dateEnd"), type: "date" },
      { key: "orderCount", label: t("purchasing.purchaseAgreements.columns.orderCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("purchasing.purchaseAgreements.emptyMessage"),
  },
})

// ── RFQs and bids ─────────────────────────────────────────────────────────────
export const purchaseRfqsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-rfqs-table",
  title: t("purchasing.rfqs.title"),
  description: t("purchasing.rfqs.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.rfqs.searchPlaceholder"),
    searchKeys: ["name", "notes"],
    columns: [
      { key: "name", label: t("purchasing.rfqs.columns.name"), layout: entityColumnLayouts.identity },
      { key: "state", label: t("purchasing.rfqs.columns.state"), layout: entityColumnLayouts.status },
      { key: "requisitionId", label: t("purchasing.rfqs.columns.requisitionId"), layout: entityColumnLayouts.reference },
      { key: "purchaseOrderId", label: t("purchasing.rfqs.columns.purchaseOrderId"), layout: entityColumnLayouts.reference },
      { key: "notes", type: "markdown", label: t("purchasing.rfqs.columns.notes"), layout: entityColumnLayouts.description },
    ],
    emptyMessage: t("purchasing.rfqs.emptyMessage"),
  },
})

export const purchaseRfqBidsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-rfq-bids-table",
  title: t("purchasing.rfqBids.title"),
  description: t("purchasing.rfqBids.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.rfqBids.searchPlaceholder"),
    searchKeys: ["notes"],
    columns: [
      { key: "rfqId", label: t("purchasing.rfqBids.columns.rfqId"), layout: entityColumnLayouts.reference },
      { key: "partnerId", label: t("purchasing.rfqBids.columns.partnerId"), layout: entityColumnLayouts.identity },
      { key: "priceUnit", label: t("purchasing.rfqBids.columns.priceUnit"), type: "number", align: "right" },
      { key: "amountTotal", label: t("purchasing.rfqBids.columns.amountTotal"), type: "number", align: "right" },
      { key: "state", label: t("purchasing.rfqBids.columns.state"), layout: entityColumnLayouts.status },
    ],
    emptyMessage: t("purchasing.rfqBids.emptyMessage"),
  },
})

// ── Vendors ───────────────────────────────────────────────────────────────────
// Purchase returns
export const purchaseReturnsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "purchase-returns-table",
  entityType: "purchase_return",
  title: t("purchasing.purchaseReturns.title", { defaultValue: "Purchase returns" }),
  description: t("purchasing.purchaseReturns.description", {
    defaultValue: "Confirm vendor returns and create the related vendor credits.",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.purchaseReturns.searchPlaceholder", {
      defaultValue: "Search purchase returns",
    }),
    searchKeys: ["name", "returnReason"],
    filters: [
      {
        key: "state",
        label: t("purchasing.purchaseReturns.filters.state.label", { defaultValue: "State" }),
        type: "select",
        options: [
          { value: "draft", label: t("purchasing.purchaseReturns.states.draft", { defaultValue: "Draft" }) },
          { value: "confirmed", label: t("purchasing.purchaseReturns.states.confirmed", { defaultValue: "Confirmed" }) },
          { value: "refunded", label: t("purchasing.purchaseReturns.states.refunded", { defaultValue: "Refunded" }) },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("purchasing.purchaseReturns.columns.name", { defaultValue: "Return" }), layout: entityColumnLayouts.reference, sortable: true },
      { key: "purchaseOrderId", label: t("purchasing.purchaseReturns.columns.purchaseOrderId", { defaultValue: "Purchase order" }), layout: entityColumnLayouts.reference },
      { key: "partnerId", label: t("purchasing.purchaseReturns.columns.partnerId", { defaultValue: "Vendor" }), layout: entityColumnLayouts.identity },
      {
        key: "state",
        label: t("purchasing.purchaseReturns.columns.state", { defaultValue: "State" }),
        type: "badge",
        layout: entityColumnLayouts.status,
        badgeVariants: { draft: "secondary", confirmed: "default", refunded: "outline" },
        badgeLabels: {
          draft: t("purchasing.purchaseReturns.states.draft", { defaultValue: "Draft" }),
          confirmed: t("purchasing.purchaseReturns.states.confirmed", { defaultValue: "Confirmed" }),
          refunded: t("purchasing.purchaseReturns.states.refunded", { defaultValue: "Refunded" }),
        },
      },
      { key: "returnReason", label: t("purchasing.purchaseReturns.columns.returnReason", { defaultValue: "Reason" }), layout: entityColumnLayouts.description },
      { key: "pickingId", label: t("purchasing.purchaseReturns.columns.pickingId", { defaultValue: "Return picking" }), layout: entityColumnLayouts.reference },
      { key: "creditMoveId", label: t("purchasing.purchaseReturns.columns.creditMoveId", { defaultValue: "Vendor credit" }), layout: entityColumnLayouts.reference },
      { key: "createDate", label: t("purchasing.purchaseReturns.columns.createDate", { defaultValue: "Created" }), type: "relative-date", sortable: true },
    ],
    emptyMessage: t("purchasing.purchaseReturns.emptyMessage", { defaultValue: "No purchase returns yet." }),
  },
})

// ── Vendors ─────────────────────────────────────────────────────────────────────────
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
      { key: "name", label: t("purchasing.vendors.columns.name"), layout: entityColumnLayouts.identity },
      { key: "email", label: t("purchasing.vendors.columns.email"), width: "min-w-44" },
      { key: "phone", label: t("purchasing.vendors.columns.phone"), layout: entityColumnLayouts.reference },
      { key: "city", label: t("purchasing.vendors.columns.city"), layout: entityColumnLayouts.location },
      { key: "countryId", label: t("purchasing.vendors.columns.countryId"), layout: entityColumnLayouts.location },
      { key: "taxId", label: t("purchasing.vendors.columns.taxId"), layout: entityColumnLayouts.reference },
    ],
    emptyMessage: t("purchasing.vendors.emptyMessage"),
  },
})

export const partnerBanksTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "partner-banks-table",
  title: t("purchasing.partnerBanks.title"),
  description: t("purchasing.partnerBanks.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("purchasing.partnerBanks.searchPlaceholder"),
    searchKeys: ["sanitizedAccNumber", "accHolderName"],
    columns: [
      { key: "id", label: t("purchasing.partnerBanks.columns.id"), width: "min-w-16" },
      { key: "partnerId", label: t("purchasing.partnerBanks.columns.partnerId"), layout: entityColumnLayouts.identity },
      {
        key: "sanitizedAccNumber",
        label: t("purchasing.partnerBanks.columns.account"),
        layout: entityColumnLayouts.identity,
      },
      { key: "accHolderName", label: t("purchasing.partnerBanks.columns.holder"), layout: entityColumnLayouts.identity },
      { key: "active", label: t("purchasing.partnerBanks.columns.active"), type: "boolean" },
      { key: "allowOutPayment", label: t("purchasing.partnerBanks.columns.allowOutPayment"), type: "boolean" },
    ],
    emptyMessage: t("purchasing.partnerBanks.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const purchasingEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "purchase-orders-table": purchaseOrdersTableConfig(t),
  "purchase-order-lines-table": purchaseOrderLinesTableConfig(t),
  "purchase-requisitions-table": purchaseRequisitionsTableConfig(t),
  "purchase-rfqs-table": purchaseRfqsTableConfig(t),
  "purchase-rfq-bids-table": purchaseRfqBidsTableConfig(t),
  "purchase-returns-table": purchaseReturnsTableConfig(t),
  "vendors-table": vendorsTableConfig(t),
  "partner-banks-table": partnerBanksTableConfig(t),
})
