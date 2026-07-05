import type { TFunction } from "i18next"
import { createElement } from "react"
import type { EntityViewConfig, EntityTableConfig } from "./entity-view-types"
import { transfersTableConfig } from "./inventory-entity-configs"

// ── Badge maps ────────────────────────────────────────────────────────────────
const saleStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Sent: "outline",
    ToApprove: "outline",
    Sale: "default",
    Done: "default",
    Cancel: "destructive",
  },
  badgeLabels: {
    Draft: t("sales.salesOrders.states.Draft"),
    Sent: t("sales.salesOrders.states.Sent"),
    ToApprove: t("sales.salesOrders.states.ToApprove"),
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

export type SaleOrdersTableConfigOptions = {
  /** Primary label for the reference column (e.g. partner / client ref fallbacks). */
  formatSaleOrderDisplayName?: (row: Record<string, unknown>) => string
}

export const saleOrdersTableConfig = (
  t: TFunction,
  options?: SaleOrdersTableConfigOptions,
): EntityViewConfig => {
  const formatName = options?.formatSaleOrderDisplayName

  const referenceColumn = {
    key: "reference",
    label: t("sales.salesOrders.columns.reference"),
    width: "min-w-28",
    ...(formatName
      ? {
          render: (_value: unknown, row: Record<string, unknown>) => {
            const formatted = formatName(row).trim()
            const fallback = String(row.reference ?? "").trim()
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
    id: "sale-orders-table",
    entityType: "sale_order",
    title: t("sales.salesOrders.title"),
    description: t("sales.salesOrders.description"),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("sales.salesOrders.searchPlaceholder"),
      searchKeys: [
        "reference",
        "clientOrderRef",
        "client_order_ref",
        "name",
        "partnerName",
        "partner_name",
      ],
      filters: [
        {
          key: "state",
          label: t("sales.salesOrders.filters.state.label"),
          type: "select",
          options: [
            { value: "Draft", label: t("sales.salesOrders.filters.state.options.Draft") },
            { value: "Sent", label: t("sales.salesOrders.filters.state.options.Sent") },
            { value: "ToApprove", label: t("sales.salesOrders.filters.state.options.ToApprove") },
            { value: "Sale", label: t("sales.salesOrders.filters.state.options.Sale") },
            { value: "Done", label: t("sales.salesOrders.filters.state.options.Done") },
            { value: "Cancel", label: t("sales.salesOrders.filters.state.options.Cancel") },
          ],
        },
      ],
      columns: [
        referenceColumn,
        {
          key: "clientOrderRef",
          label: t("sales.salesOrders.columns.clientOrderRef"),
          width: "min-w-28",
        },
        {
          key: "state",
          label: t("sales.salesOrders.columns.state"),
          type: "badge",
          ...saleStateBadges(t),
        },
        {
          key: "amountTotal",
          label: t("sales.salesOrders.columns.amountTotal"),
          type: "currency",
          align: "right",
        },
        {
          key: "amountResidual",
          label: t("sales.salesOrders.columns.amountResidual"),
          type: "currency",
          align: "right",
        },
        {
          key: "invoiceStatus",
          label: t("sales.salesOrders.columns.invoiceStatus"),
          type: "badge",
          ...invoiceStatusBadges(t),
        },
        {
          key: "dateOrder",
          label: t("sales.salesOrders.columns.dateOrder"),
          type: "date",
        },
        {
          key: "deliveryCount",
          label: t("sales.salesOrders.columns.deliveryCount"),
          type: "number",
          align: "right",
        },
      ],
      emptyMessage: t("sales.salesOrders.emptyMessage"),
    },
  }
}

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

// ── Pricelist items (pricing rules) ───────────────────────────────────────────
export const pricelistItemsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pricelist-items-table",
  title: t("sales.pricelistItems.title"),
  description: t("sales.pricelistItems.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.pricelistItems.searchPlaceholder"),
    searchKeys: ["pricelistId", "productId"],
    columns: [
      { key: "id", label: t("sales.pricelistItems.columns.id"), width: "min-w-16" },
      { key: "pricelistId", label: t("sales.pricelistItems.columns.pricelistId"), width: "min-w-20" },
      { key: "sequence", label: t("sales.pricelistItems.columns.sequence"), type: "number", align: "right" },
      { key: "appliedOn", label: t("sales.pricelistItems.columns.appliedOn"), type: "text" },
      { key: "computePrice", label: t("sales.pricelistItems.columns.computePrice"), type: "text" },
      { key: "productId", label: t("sales.pricelistItems.columns.productId"), width: "min-w-20" },
      { key: "minQuantity", label: t("sales.pricelistItems.columns.minQuantity"), type: "number", align: "right" },
      { key: "fixedPrice", label: t("sales.pricelistItems.columns.fixedPrice"), type: "currency", align: "right" },
      { key: "percentPrice", label: t("sales.pricelistItems.columns.percentPrice"), type: "percent", align: "right" },
    ],
    emptyMessage: t("sales.pricelistItems.emptyMessage"),
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
        label: t("sales.deliveries.filters.state.label"),
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

// ── Delivery & POS masters ────────────────────────────────────────────────────
export const deliveryPriceRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "delivery-price-rules-table",
  title: t("sales.deliveryPriceRules.title"),
  description: t("sales.deliveryPriceRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.deliveryPriceRules.searchPlaceholder"),
    searchKeys: ["variable", "operator"],
    columns: [
      { key: "id", label: t("sales.deliveryPriceRules.columns.id"), width: "min-w-16" },
      { key: "carrierId", label: t("sales.deliveryPriceRules.columns.carrierId"), width: "min-w-20" },
      { key: "variable", label: t("sales.deliveryPriceRules.columns.variable"), width: "min-w-28" },
      { key: "operator", label: t("sales.deliveryPriceRules.columns.operator"), width: "min-w-16" },
      { key: "maxValue", label: t("sales.deliveryPriceRules.columns.maxValue"), type: "number", align: "right" },
      { key: "listPrice", label: t("sales.deliveryPriceRules.columns.listPrice"), type: "currency", align: "right" },
    ],
    emptyMessage: t("sales.deliveryPriceRules.emptyMessage"),
  },
})

export const deliveryCarriersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "delivery-carriers-table",
  title: t("sales.deliveryCarriers.title"),
  description: t("sales.deliveryCarriers.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.deliveryCarriers.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("sales.deliveryCarriers.columns.name"), width: "min-w-40" },
      { key: "deliveryType", label: t("sales.deliveryCarriers.columns.deliveryType"), width: "min-w-24" },
      { key: "active", label: t("sales.deliveryCarriers.columns.active"), type: "boolean" },
      { key: "currencyId", label: t("sales.deliveryCarriers.columns.currencyId"), width: "min-w-20" },
      { key: "productId", label: t("sales.deliveryCarriers.columns.productId"), width: "min-w-20" },
    ],
    emptyMessage: t("sales.deliveryCarriers.emptyMessage"),
  },
})

export const shippingMethodsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "shipping-methods-table",
  title: t("sales.shippingMethods.title"),
  description: t("sales.shippingMethods.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.shippingMethods.searchPlaceholder"),
    searchKeys: ["name", "provider"],
    columns: [
      { key: "name", label: t("sales.shippingMethods.columns.name"), width: "min-w-40" },
      { key: "provider", label: t("sales.shippingMethods.columns.provider"), width: "min-w-28" },
      { key: "deliveryType", label: t("sales.shippingMethods.columns.deliveryType"), width: "min-w-24" },
      { key: "active", label: t("sales.shippingMethods.columns.active"), type: "boolean" },
      { key: "fixedPrice", label: t("sales.shippingMethods.columns.fixedPrice"), type: "currency", align: "right" },
    ],
    emptyMessage: t("sales.shippingMethods.emptyMessage"),
  },
})

export const posPaymentMethodsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-payment-methods-table",
  title: t("sales.posPaymentMethods.title"),
  description: t("sales.posPaymentMethods.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.posPaymentMethods.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("sales.posPaymentMethods.columns.name"), width: "min-w-40" },
      { key: "sequence", label: t("sales.posPaymentMethods.columns.sequence"), type: "number", align: "right" },
      { key: "active", label: t("sales.posPaymentMethods.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("sales.posPaymentMethods.emptyMessage"),
  },
})

export const posLoyaltyProgramsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-loyalty-programs-table",
  title: t("sales.loyaltyPrograms.title"),
  description: t("sales.loyaltyPrograms.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.loyaltyPrograms.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("sales.loyaltyPrograms.columns.name"), width: "min-w-40" },
      { key: "currencyId", label: t("sales.loyaltyPrograms.columns.currencyId"), width: "min-w-20" },
      { key: "programType", label: t("sales.loyaltyPrograms.columns.programType"), width: "min-w-24" },
      { key: "isActive", label: t("sales.loyaltyPrograms.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("sales.loyaltyPrograms.emptyMessage"),
  },
})

export const posLoyaltyCardsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-loyalty-cards-table",
  title: t("sales.loyaltyCards.title"),
  description: t("sales.loyaltyCards.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("sales.loyaltyCards.searchPlaceholder"),
    searchKeys: ["code"],
    columns: [
      { key: "code", label: t("sales.loyaltyCards.columns.code"), width: "min-w-32" },
      { key: "points", label: t("sales.loyaltyCards.columns.points"), type: "number", align: "right" },
      { key: "partnerId", label: t("sales.loyaltyCards.columns.partnerId"), width: "min-w-20" },
      { key: "currencyId", label: t("sales.loyaltyCards.columns.currencyId"), width: "min-w-20" },
      { key: "isActive", label: t("sales.loyaltyCards.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("sales.loyaltyCards.emptyMessage"),
  },
})

// ── Order fulfillment (stock pickings) & returns ───────────────────────────────
export const salesFulfillmentTableConfig = (t: TFunction): EntityViewConfig => {
  const base = transfersTableConfig(t)
  const view = base.view as EntityTableConfig
  return {
    ...base,
    id: "sales-fulfillment-table",
    title: t("sales.fulfillment.title"),
    description: t("sales.fulfillment.description"),
    view: {
      ...view,
      searchPlaceholder: t("sales.fulfillment.searchPlaceholder"),
      emptyMessage: t("sales.fulfillment.emptyMessage"),
      columns: [
        ...(view.columns ?? []),
        {
          key: "backorderId",
          label: t("sales.fulfillment.columns.backorder"),
          width: "min-w-24",
        },
      ],
    },
  }
}

export const salesReturnsTableConfig = (t: TFunction): EntityViewConfig => {
  const returnStateBadges = {
    badgeVariants: {
      draft: "secondary",
      confirmed: "outline",
      received: "default",
      refunded: "default",
      cancelled: "destructive",
    },
    badgeLabels: {
      draft: t("sales.returnOrders.states.draft"),
      confirmed: t("sales.returnOrders.states.confirmed"),
      received: t("sales.returnOrders.states.received"),
      refunded: t("sales.returnOrders.states.refunded"),
      cancelled: t("sales.returnOrders.states.cancelled"),
    },
  } as const

  return {
    id: "sales-returns-table",
    entityType: "return_order",
    title: t("sales.returnOrders.title"),
    description: t("sales.returnOrders.description"),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("sales.returnOrders.searchPlaceholder"),
      searchKeys: ["name", "state", "returnReason", "return_reason"],
      emptyMessage: t("sales.returnOrders.emptyMessage"),
      columns: [
        { key: "name", label: t("sales.returnOrders.columns.name"), width: "min-w-32" },
        {
          key: "state",
          label: t("sales.returnOrders.columns.state"),
          type: "badge",
          width: "min-w-24",
          ...returnStateBadges,
        },
        {
          key: "partnerId",
          label: t("sales.returnOrders.columns.partnerId"),
          width: "min-w-24",
        },
        {
          key: "saleOrderId",
          label: t("sales.returnOrders.columns.saleOrderId"),
          width: "min-w-24",
        },
        {
          key: "pickingId",
          label: t("sales.returnOrders.columns.pickingId"),
          width: "min-w-24",
        },
        {
          key: "creditMoveId",
          label: t("sales.returnOrders.columns.creditMoveId"),
          width: "min-w-24",
        },
        {
          key: "returnReason",
          label: t("sales.returnOrders.columns.returnReason"),
          width: "min-w-40",
        },
      ],
    },
  }
}

export const returnOrderLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "return-order-lines-table",
  entityType: "return_order_line",
  title: t("sales.returnOrderLines.title"),
  description: t("sales.returnOrderLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: false,
    emptyMessage: t("sales.returnOrderLines.emptyMessage"),
    columns: [
      { key: "productId", label: t("sales.returnOrderLines.columns.productId"), width: "min-w-24" },
      {
        key: "productUomQty",
        label: t("sales.returnOrderLines.columns.quantity"),
        type: "number",
        width: "min-w-20",
      },
      {
        key: "priceUnit",
        label: t("sales.returnOrderLines.columns.priceUnit"),
        type: "currency",
        width: "min-w-24",
      },
      {
        key: "toRefund",
        label: t("sales.returnOrderLines.columns.toRefund"),
        type: "boolean",
        width: "min-w-20",
      },
      {
        key: "saleOrderLineId",
        label: t("sales.returnOrderLines.columns.saleOrderLineId"),
        width: "min-w-24",
      },
    ],
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const salesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "sale-orders-table": saleOrdersTableConfig(t),
  "sale-order-lines-table": saleOrderLinesTableConfig(t),
  "pricelists-table": pricelistsTableConfig(t),
  "pricelist-items-table": pricelistItemsTableConfig(t),
  "deliveries-table": deliveriesTableConfig(t),
  "sales-fulfillment-table": salesFulfillmentTableConfig(t),
  "sales-returns-table": salesReturnsTableConfig(t),
  "return-order-lines-table": returnOrderLinesTableConfig(t),
  "delivery-price-rules-table": deliveryPriceRulesTableConfig(t),
  "delivery-carriers-table": deliveryCarriersTableConfig(t),
  "shipping-methods-table": shippingMethodsTableConfig(t),
  "pos-payment-methods-table": posPaymentMethodsTableConfig(t),
  "pos-loyalty-programs-table": posLoyaltyProgramsTableConfig(t),
  "pos-loyalty-cards-table": posLoyaltyCardsTableConfig(t),
})
