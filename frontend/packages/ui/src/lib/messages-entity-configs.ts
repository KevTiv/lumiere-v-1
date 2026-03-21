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
        label: t("messages.messages.filters.messageType"),
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

// ── Registry ──────────────────────────────────────────────────────────────────
export const messagesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "mail-messages-table": mailMessagesTableConfig(t),
})
