import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const messageTypeBadges = (t: TFunction) => ({
  badgeVariants: { email: "default", comment: "outline", notification: "secondary", user_notification: "secondary" },
  badgeLabels: {
    email: t("messages.messages.states.email"),
    comment: t("messages.messages.states.comment"),
    notification: t("messages.messages.states.notification"),
    user_notification: t("messages.messages.states.user_notification"),
  },
}) as const

// ── Mail Messages ─────────────────────────────────────────────────────────────
export const mailMessagesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "mail-messages-table",
  title: t("messages.messages.title"),
  description: t("messages.messages.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("messages.messages.searchPlaceholder"),
    searchKeys: ["body", "subtype"],
    filters: [
      {
        key: "messageType",
        label: t("messages.messages.filters.messageType.label"),
        type: "select",
        options: [
          { value: "email", label: t("messages.messages.filters.messageType.options.email") },
          { value: "comment", label: t("messages.messages.filters.messageType.options.comment") },
          { value: "notification", label: t("messages.messages.filters.messageType.options.notification") },
          { value: "user_notification", label: t("messages.messages.filters.messageType.options.user_notification") },
        ],
      },
    ],
    columns: [
      { key: "body", label: t("messages.messages.columns.body"), width: "min-w-64" },
      { key: "model", label: t("messages.messages.columns.model"), width: "min-w-28" },
      { key: "resId", label: t("messages.messages.columns.resId"), type: "number", align: "right" },
      { key: "messageType", label: t("messages.messages.columns.messageType"), type: "badge", ...messageTypeBadges(t) },
      { key: "subtype", label: t("messages.messages.columns.subtype"), width: "min-w-28" },
      { key: "date", label: t("messages.messages.columns.date"), type: "date" },
    ],
    emptyMessage: t("messages.messages.emptyMessage"),
  },
})

export const mailMyNotificationsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "mail-my-notifications-table",
  title: t("messages.notifications.title"),
  description: t("messages.notifications.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("messages.notifications.searchPlaceholder"),
    searchKeys: ["body", "model", "subtype"],
    columns: [
      { key: "body", label: t("messages.messages.columns.body"), width: "min-w-64" },
      { key: "model", label: t("messages.messages.columns.model"), width: "min-w-28" },
      { key: "resId", label: t("messages.messages.columns.resId"), type: "number", align: "right" },
      { key: "messageType", label: t("messages.messages.columns.messageType"), type: "badge", ...messageTypeBadges(t) },
      { key: "date", label: t("messages.messages.columns.date"), type: "date" },
    ],
    emptyMessage: t("messages.notifications.emptyMessage"),
  },
})

export const mailFollowersTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "mail-followers-table",
  title: t("messages.followers.title"),
  description: t("messages.followers.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("messages.followers.searchPlaceholder"),
    searchKeys: ["resModel", "resId"],
    columns: [
      { key: "resModel", label: t("messages.followers.columns.resModel"), width: "min-w-32" },
      { key: "resId", label: t("messages.followers.columns.resId"), type: "number", align: "right" },
      { key: "subtypes", label: t("messages.followers.columns.subtypes"), width: "min-w-48" },
      { key: "partnerId", label: t("messages.followers.columns.partnerId"), width: "min-w-40" },
    ],
    emptyMessage: t("messages.followers.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const messagesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "mail-messages-table": mailMessagesTableConfig(t),
  "mail-my-notifications-table": mailMyNotificationsTableConfig(t),
  "mail-followers-table": mailFollowersTableConfig(t),
})
