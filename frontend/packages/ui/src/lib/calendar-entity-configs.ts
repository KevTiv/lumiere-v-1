import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const eventStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", confirmed: "default", cancelled: "destructive" },
  badgeLabels: {
    draft: t("calendar.events.states.draft"),
    confirmed: t("calendar.events.states.confirmed"),
    cancelled: t("calendar.events.states.cancelled"),
  },
}) as const

const privacyBadges = (t: TFunction) => ({
  badgeVariants: { public: "default", private: "secondary", confidential: "outline" },
  badgeLabels: {
    public: t("calendar.events.privacy.public"),
    private: t("calendar.events.privacy.private"),
    confidential: t("calendar.events.privacy.confidential"),
  },
}) as const

// ── Calendar Events ───────────────────────────────────────────────────────────
export const calendarEventsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "calendar-events-table",
  title: t("calendar.events.title"),
  description: t("calendar.events.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("calendar.events.searchPlaceholder"),
    searchKeys: ["name", "location"],
    filters: [
      {
        key: "state",
        label: t("calendar.events.filters.state"),
        type: "select",
        options: [
          { value: "draft", label: t("calendar.events.filters.stateOptions.draft") },
          { value: "confirmed", label: t("calendar.events.filters.stateOptions.confirmed") },
          { value: "cancelled", label: t("calendar.events.filters.stateOptions.cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("calendar.events.columns.name"), width: "min-w-48" },
      { key: "start", label: t("calendar.events.columns.start"), type: "date" },
      { key: "stop", label: t("calendar.events.columns.stop"), type: "date" },
      { key: "location", label: t("calendar.events.columns.location"), width: "min-w-36" },
      { key: "allday", label: t("calendar.events.columns.allday"), type: "boolean" },
      { key: "state", label: t("calendar.events.columns.state"), type: "badge", ...eventStateBadges(t) },
      { key: "privacy", label: t("calendar.events.columns.privacy"), type: "badge", ...privacyBadges(t) },
      { key: "recurrency", label: t("calendar.events.columns.recurrency"), type: "boolean" },
    ],
    emptyMessage: t("calendar.events.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const calendarEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "calendar-events-table": calendarEventsTableConfig(t),
})
