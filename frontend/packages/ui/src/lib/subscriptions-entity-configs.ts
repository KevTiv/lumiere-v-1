import type { TFunction } from "i18next"
import type { EntityAction, EntityViewConfig } from "./entity-view-types"

const subscriptionStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", active: "default", paused: "outline", closed: "destructive" },
  badgeLabels: {
    draft: t("subscriptions.subscriptions.states.draft"),
    active: t("subscriptions.subscriptions.states.active"),
    paused: t("subscriptions.subscriptions.states.paused"),
    closed: t("subscriptions.subscriptions.states.closed"),
  },
}) as const

const healthBadges = (t: TFunction) => ({
  badgeVariants: { good: "default", bad: "destructive" },
  badgeLabels: {
    good: t("subscriptions.subscriptions.health.good"),
    bad: t("subscriptions.subscriptions.health.bad"),
  },
}) as const

// ── Subscriptions ─────────────────────────────────────────────────────────────
export const subscriptionsTableConfig = (
  t: TFunction,
  actions?: EntityAction[],
): EntityViewConfig => ({
  id: "subscriptions-table",
  title: t("subscriptions.subscriptions.title"),
  description: t("subscriptions.subscriptions.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.subscriptions.searchPlaceholder"),
    searchKeys: ["code", "description"],
    filters: [
      {
        key: "state",
        label: t("subscriptions.subscriptions.filters.state.label"),
        type: "select",
        options: [
          { value: "draft", label: t("subscriptions.subscriptions.filters.state.options.draft") },
          { value: "active", label: t("subscriptions.subscriptions.filters.state.options.active") },
          { value: "paused", label: t("subscriptions.subscriptions.filters.state.options.paused") },
          { value: "closed", label: t("subscriptions.subscriptions.filters.state.options.closed") },
        ],
      },
    ],
    columns: [
      { key: "code", label: t("subscriptions.subscriptions.columns.code"), width: "min-w-28" },
      { key: "description", label: t("subscriptions.subscriptions.columns.description"), width: "min-w-40" },
      { key: "state", label: t("subscriptions.subscriptions.columns.state"), type: "badge", ...subscriptionStateBadges(t) },
      { key: "health", label: t("subscriptions.subscriptions.columns.health"), type: "badge", ...healthBadges(t) },
      { key: "recurringMonthly", label: t("subscriptions.subscriptions.columns.recurringMonthly"), type: "currency", align: "right" },
      { key: "isTrial", label: t("subscriptions.subscriptions.columns.isTrial"), type: "boolean" },
      { key: "dateStart", label: t("subscriptions.subscriptions.columns.dateStart"), type: "date" },
      { key: "recurringNextDate", label: t("subscriptions.subscriptions.columns.recurringNextDate"), type: "date" },
    ],
    emptyMessage: t("subscriptions.subscriptions.emptyMessage"),
    ...(actions?.length ? { actions } : {}),
  },
})

// ── Subscription Plans ────────────────────────────────────────────────────────
export const subscriptionPlansTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-plans-table",
  title: t("subscriptions.plans.title"),
  description: t("subscriptions.plans.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.plans.searchPlaceholder"),
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: t("subscriptions.plans.columns.name"), width: "min-w-40" },
      { key: "code", label: t("subscriptions.plans.columns.code"), width: "min-w-24" },
      { key: "billingPeriod", label: t("subscriptions.plans.columns.billingPeriod"), width: "min-w-28" },
      { key: "billingPeriodUnit", label: t("subscriptions.plans.columns.billingPeriodUnit"), type: "number", align: "right" },
      { key: "trialPeriod", label: t("subscriptions.plans.columns.trialPeriod"), type: "boolean" },
      { key: "trialDuration", label: t("subscriptions.plans.columns.trialDuration"), type: "number", align: "right" },
      { key: "isDefault", label: t("subscriptions.plans.columns.isDefault"), type: "boolean" },
      { key: "active", label: t("subscriptions.plans.columns.active"), type: "boolean" },
    ],
    emptyMessage: t("subscriptions.plans.emptyMessage"),
  },
})

// ── Subscription lines ────────────────────────────────────────────────────────
export const subscriptionLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-lines-table",
  title: t("subscriptions.lines.title", { defaultValue: "Subscription lines" }),
  description: t("subscriptions.lines.description", {
    defaultValue: "Recurring contract lines copied from sale orders",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.lines.searchPlaceholder", {
      defaultValue: "Search lines…",
    }),
    searchKeys: ["name"],
    columns: [
      {
        key: "subscriptionId",
        label: t("subscriptions.lines.columns.subscriptionId", { defaultValue: "Subscription" }),
        type: "number",
        align: "right",
      },
      { key: "name", label: t("subscriptions.lines.columns.name", { defaultValue: "Description" }), width: "min-w-40" },
      {
        key: "productUomQty",
        label: t("subscriptions.lines.columns.qty", { defaultValue: "Qty" }),
        type: "number",
        align: "right",
      },
      {
        key: "priceUnit",
        label: t("subscriptions.lines.columns.priceUnit", { defaultValue: "Unit price" }),
        type: "currency",
        align: "right",
      },
      {
        key: "priceSubtotal",
        label: t("subscriptions.lines.columns.priceSubtotal", { defaultValue: "Subtotal" }),
        type: "currency",
        align: "right",
      },
      {
        key: "recurringRuleType",
        label: t("subscriptions.lines.columns.recurringRuleType", { defaultValue: "Cadence" }),
        width: "min-w-24",
      },
    ],
    emptyMessage: t("subscriptions.lines.emptyMessage", { defaultValue: "No subscription lines yet." }),
  },
})

// ── Subscription amendments ───────────────────────────────────────────────────
export const subscriptionAmendmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-amendments-table",
  title: t("subscriptions.amendments.title", { defaultValue: "Amendments" }),
  description: t("subscriptions.amendments.description", {
    defaultValue: "Versioned commercial changes with proration links",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.amendments.searchPlaceholder", {
      defaultValue: "Search amendments…",
    }),
    searchKeys: ["amendmentType", "notes"],
    columns: [
      {
        key: "subscriptionId",
        label: t("subscriptions.amendments.columns.subscriptionId", { defaultValue: "Subscription" }),
        type: "number",
        align: "right",
      },
      {
        key: "version",
        label: t("subscriptions.amendments.columns.version", { defaultValue: "Version" }),
        type: "number",
        align: "right",
      },
      {
        key: "amendmentType",
        label: t("subscriptions.amendments.columns.amendmentType", { defaultValue: "Type" }),
        type: "badge",
      },
      {
        key: "prorationMoveId",
        label: t("subscriptions.amendments.columns.prorationMoveId", {
          defaultValue: "Proration move",
        }),
        type: "number",
        align: "right",
      },
      {
        key: "creditNoteMoveId",
        label: t("subscriptions.amendments.columns.creditNoteMoveId", {
          defaultValue: "Credit note",
        }),
        type: "number",
        align: "right",
      },
      {
        key: "notes",
        label: t("subscriptions.amendments.columns.notes", { defaultValue: "Notes" }),
        width: "min-w-40",
      },
    ],
    emptyMessage: t("subscriptions.amendments.emptyMessage", {
      defaultValue: "No amendments yet.",
    }),
  },
})

// ── Deferred revenue schedules ────────────────────────────────────────────────
export const deferredRevenueSchedulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "deferred-revenue-schedules-table",
  title: t("subscriptions.deferredSchedules.title"),
  description: t("subscriptions.deferredSchedules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.deferredSchedules.searchPlaceholder"),
    searchKeys: ["description", "state"],
    columns: [
      { key: "id", label: t("subscriptions.deferredSchedules.columns.id"), type: "number", align: "right" },
      { key: "description", label: t("subscriptions.deferredSchedules.columns.description"), width: "min-w-40" },
      { key: "state", label: t("subscriptions.deferredSchedules.columns.state"), type: "badge" },
      {
        key: "totalAmount",
        label: t("subscriptions.deferredSchedules.columns.totalAmount"),
        type: "currency",
        align: "right",
      },
      {
        key: "deferredAmount",
        label: t("subscriptions.deferredSchedules.columns.deferredAmount"),
        type: "currency",
        align: "right",
      },
      { key: "startDate", label: t("subscriptions.deferredSchedules.columns.startDate"), type: "date" },
      { key: "endDate", label: t("subscriptions.deferredSchedules.columns.endDate"), type: "date" },
    ],
    emptyMessage: t("subscriptions.deferredSchedules.emptyMessage"),
  },
})

// ── Deferred revenue lines ────────────────────────────────────────────────────
export const deferredRevenueLinesTableConfig = (
  t: TFunction,
  actions?: EntityAction[],
): EntityViewConfig => ({
  id: "deferred-revenue-lines-table",
  title: t("subscriptions.deferredLines.title"),
  description: t("subscriptions.deferredLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.deferredLines.searchPlaceholder"),
    searchKeys: ["notes"],
    columns: [
      { key: "id", label: t("subscriptions.deferredLines.columns.id"), type: "number", align: "right" },
      {
        key: "scheduleId",
        label: t("subscriptions.deferredLines.columns.scheduleId"),
        type: "number",
        align: "right",
      },
      {
        key: "sequence",
        label: t("subscriptions.deferredLines.columns.sequence"),
        type: "number",
        align: "right",
      },
      {
        key: "recognitionDate",
        label: t("subscriptions.deferredLines.columns.recognitionDate"),
        type: "date",
      },
      { key: "amount", label: t("subscriptions.deferredLines.columns.amount"), type: "currency", align: "right" },
      {
        key: "recognized",
        label: t("subscriptions.deferredLines.columns.recognized"),
        type: "boolean",
      },
    ],
    emptyMessage: t("subscriptions.deferredLines.emptyMessage"),
    ...(actions?.length ? { actions } : {}),
  },
})

// ── Revenue recognition rules ─────────────────────────────────────────────────
export const revenueRecognitionRulesTableConfig = (
  t: TFunction,
  actions?: EntityAction[],
): EntityViewConfig => ({
  id: "revenue-recognition-rules-table",
  title: t("subscriptions.recognitionRules.title"),
  description: t("subscriptions.recognitionRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("subscriptions.recognitionRules.searchPlaceholder"),
    searchKeys: ["description", "notes"],
    columns: [
      { key: "id", label: t("subscriptions.recognitionRules.columns.id"), type: "number", align: "right" },
      { key: "description", label: t("subscriptions.recognitionRules.columns.description"), width: "min-w-40" },
      {
        key: "priority",
        label: t("subscriptions.recognitionRules.columns.priority"),
        type: "number",
        align: "right",
      },
      {
        key: "isActive",
        label: t("subscriptions.recognitionRules.columns.isActive"),
        type: "boolean",
      },
      {
        key: "recognitionMethod",
        label: t("subscriptions.recognitionRules.columns.recognitionMethod"),
        width: "min-w-28",
      },
      {
        key: "recognitionPeriod",
        label: t("subscriptions.recognitionRules.columns.recognitionPeriod"),
        width: "min-w-24",
      },
    ],
    emptyMessage: t("subscriptions.recognitionRules.emptyMessage"),
    ...(actions?.length ? { actions } : {}),
  },
})

export const subscriptionUsageEventsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-usage-events-table",
  title: t("subscriptions.usageEvents.title", { defaultValue: "Usage events" }),
  description: t("subscriptions.usageEvents.description", {
    defaultValue: "Meter ingest ledger (pending → rated)",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["source", "eventId", "status"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "source", label: "Source", width: "min-w-24" },
      { key: "eventId", label: "Event id", width: "min-w-28" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    emptyMessage: t("subscriptions.usageEvents.emptyMessage", {
      defaultValue: "No usage events yet.",
    }),
  },
})

export const subscriptionUsageChargesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-usage-charges-table",
  title: t("subscriptions.usageCharges.title", { defaultValue: "Usage charges" }),
  description: t("subscriptions.usageCharges.description", {
    defaultValue: "Rated charges awaiting or attached to billing runs",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["status", "tierBand", "description"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "tierBand", label: "Tier band", width: "min-w-32" },
      { key: "status", label: "Status", type: "badge" },
    ],
    emptyMessage: t("subscriptions.usageCharges.emptyMessage", {
      defaultValue: "No usage charges yet.",
    }),
  },
})

export const subscriptionRatingBacklogTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-rating-backlog-table",
  title: t("subscriptions.ratingBacklog.title", { defaultValue: "Rating backlog" }),
  description: t("subscriptions.ratingBacklog.description", {
    defaultValue: "Pending usage events waiting to be rated",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["source", "eventId"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "source", label: "Source" },
      { key: "eventId", label: "Event id" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    emptyMessage: t("subscriptions.ratingBacklog.emptyMessage", {
      defaultValue: "Rating backlog is empty.",
    }),
  },
})

export const subscriptionPriceTiersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-price-tiers-table",
  title: t("subscriptions.priceTiers.title", { defaultValue: "Price tiers" }),
  description: t("subscriptions.priceTiers.description", {
    defaultValue: "Progressive volume ladders on plans",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["planId"],
    columns: [
      { key: "planId", label: "Plan", type: "number", align: "right" },
      { key: "sequence", label: "Seq", type: "number", align: "right" },
      { key: "minQty", label: "Min", type: "number", align: "right" },
      { key: "maxQty", label: "Max", type: "number", align: "right" },
      { key: "unitPrice", label: "Unit price", type: "currency", align: "right" },
      { key: "active", label: "Active", type: "boolean" },
    ],
    emptyMessage: t("subscriptions.priceTiers.emptyMessage", {
      defaultValue: "No price tiers yet.",
    }),
  },
})

export const subscriptionPastDueTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-past-due-table",
  title: t("subscriptions.pastDue.title", { defaultValue: "Past due" }),
  description: t("subscriptions.pastDue.description", {
    defaultValue: "Collections queue (dunning / failed payments)",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["subscriptionId", "stage"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "stage", label: "Stage", type: "badge" },
      { key: "failedPaymentCount", label: "Failures", type: "number", align: "right" },
      { key: "pastDueDays", label: "Past-due days", type: "number", align: "right" },
      { key: "pastDue", label: "Past due", type: "boolean" },
    ],
    emptyMessage: t("subscriptions.pastDue.emptyMessage", {
      defaultValue: "No past-due subscriptions.",
    }),
  },
})

export const subscriptionDueToBillTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-due-to-bill-table",
  title: t("subscriptions.dueToBill.title", { defaultValue: "Due to bill" }),
  description: t("subscriptions.dueToBill.description", {
    defaultValue: "Active contracts with next invoice date due",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["subscriptionId"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "stage", label: "Stage", type: "badge" },
      { key: "dueToBill", label: "Due", type: "boolean" },
    ],
    emptyMessage: t("subscriptions.dueToBill.emptyMessage", {
      defaultValue: "Nothing due to bill.",
    }),
  },
})

export const subscriptionEntitlementsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-entitlements-table",
  title: t("subscriptions.entitlements.title", { defaultValue: "Entitlements" }),
  description: t("subscriptions.entitlements.description", {
    defaultValue: "Customer access grants (not platform SaaS billing_account)",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["featureCode", "status"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "partnerId", label: "Partner", type: "number", align: "right" },
      { key: "featureCode", label: "Feature", width: "min-w-32" },
      { key: "status", label: "Status", type: "badge" },
    ],
    emptyMessage: t("subscriptions.entitlements.emptyMessage", {
      defaultValue: "No entitlements yet.",
    }),
  },
})

export const subscriptionPaymentIntentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "subscription-payment-intents-table",
  title: t("subscriptions.paymentIntents.title", { defaultValue: "Payment intents" }),
  description: t("subscriptions.paymentIntents.description", {
    defaultValue: "Card + local rail charge intents for workers",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["intentType", "status"],
    columns: [
      { key: "subscriptionId", label: "Subscription", type: "number", align: "right" },
      { key: "intentType", label: "Rail", type: "badge" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "status", label: "Status", type: "badge" },
      { key: "fallbackDraftInvoice", label: "Draft fallback", type: "boolean" },
    ],
    emptyMessage: t("subscriptions.paymentIntents.emptyMessage", {
      defaultValue: "No payment intents yet.",
    }),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const subscriptionsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "subscriptions-table": subscriptionsTableConfig(t),
  "subscription-plans-table": subscriptionPlansTableConfig(t),
  "subscription-lines-table": subscriptionLinesTableConfig(t),
  "subscription-amendments-table": subscriptionAmendmentsTableConfig(t),
  "subscription-usage-events-table": subscriptionUsageEventsTableConfig(t),
  "subscription-usage-charges-table": subscriptionUsageChargesTableConfig(t),
  "subscription-rating-backlog-table": subscriptionRatingBacklogTableConfig(t),
  "subscription-price-tiers-table": subscriptionPriceTiersTableConfig(t),
  "subscription-past-due-table": subscriptionPastDueTableConfig(t),
  "subscription-due-to-bill-table": subscriptionDueToBillTableConfig(t),
  "subscription-entitlements-table": subscriptionEntitlementsTableConfig(t),
  "subscription-payment-intents-table": subscriptionPaymentIntentsTableConfig(t),
  "deferred-revenue-schedules-table": deferredRevenueSchedulesTableConfig(t),
  "deferred-revenue-lines-table": deferredRevenueLinesTableConfig(t),
  "revenue-recognition-rules-table": revenueRecognitionRulesTableConfig(t),
})
