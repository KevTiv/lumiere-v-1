import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

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
export const subscriptionsTableConfig = (t: TFunction): EntityViewConfig => ({
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
        label: t("subscriptions.subscriptions.filters.state"),
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

// ── Registry ──────────────────────────────────────────────────────────────────
export const subscriptionsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "subscriptions-table": subscriptionsTableConfig(t),
  "subscription-plans-table": subscriptionPlansTableConfig(t),
})
