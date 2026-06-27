import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

export const posTerminalsAdminTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-terminals-admin-table",
  title: t("pos.admin.terminals.title"),
  description: t("pos.admin.terminals.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("pos.admin.terminals.searchPlaceholder"),
    searchKeys: ["name", "locationLabel", "status"],
    columns: [
      { key: "name", label: t("pos.admin.terminals.columns.name"), width: "min-w-36" },
      { key: "locationLabel", label: t("pos.admin.terminals.columns.location"), width: "min-w-32" },
      { key: "status", label: t("pos.admin.terminals.columns.status"), type: "badge", width: "min-w-24" },
      { key: "dailyRevenue", label: t("pos.admin.terminals.columns.dailyRevenue"), type: "currency", align: "right" },
      { key: "openOrders", label: t("pos.admin.terminals.columns.openOrders"), type: "number", align: "right" },
    ],
    emptyMessage: t("pos.admin.terminals.emptyMessage"),
  },
})

export const posConfigsAdminTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-configs-admin-table",
  title: t("pos.admin.configs.title"),
  description: t("pos.admin.configs.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("pos.admin.configs.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("pos.admin.configs.columns.name"), width: "min-w-40" },
      { key: "isActive", label: t("pos.admin.configs.columns.isActive"), type: "boolean" },
      { key: "companyId", label: t("pos.admin.configs.columns.companyId"), width: "min-w-20" },
    ],
    emptyMessage: t("pos.admin.configs.emptyMessage"),
  },
})

export const posSessionsAdminTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "pos-sessions-admin-table",
  title: t("pos.admin.sessions.title"),
  description: t("pos.admin.sessions.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("pos.admin.sessions.searchPlaceholder"),
    searchKeys: ["name", "state"],
    columns: [
      { key: "name", label: t("pos.admin.sessions.columns.name"), width: "min-w-32" },
      { key: "configId", label: t("pos.admin.sessions.columns.configId"), width: "min-w-20" },
      { key: "state", label: t("pos.admin.sessions.columns.state"), type: "badge", width: "min-w-24" },
      { key: "orderCount", label: t("pos.admin.sessions.columns.orderCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("pos.admin.sessions.emptyMessage"),
  },
})
