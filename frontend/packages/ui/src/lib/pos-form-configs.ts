import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export type PosFormAction =
  | "createTerminal"
  | "updateTerminal"
  | "createConfig"
  | "activateConfig"
  | "deactivateConfig"
  | "openSession"
  | "computeTotals"
  | "closeSession"

export const posFormConfigs = (t: TFunction): Record<PosFormAction, FormConfig> => ({
  createTerminal: {
    id: "pos-create-terminal",
    title: t("pos.admin.forms.createTerminal.title"),
    submitLabel: t("pos.admin.forms.createTerminal.submit"),
    sections: [
      {
        id: "terminal",
        fields: [
          { id: "terminal-name", type: "text", name: "name", label: t("pos.admin.forms.fields.name"), required: true },
          { id: "terminal-location", type: "text", name: "locationLabel", label: t("pos.admin.forms.fields.locationLabel") },
          { id: "terminal-lat", type: "number", name: "latitude", label: t("pos.admin.forms.fields.latitude"), width: "1/2" },
          { id: "terminal-lng", type: "number", name: "longitude", label: t("pos.admin.forms.fields.longitude"), width: "1/2" },
        ],
      },
    ],
  },
  updateTerminal: {
    id: "pos-update-terminal",
    title: t("pos.admin.forms.updateTerminal.title"),
    description: t("pos.admin.forms.updateTerminal.description"),
    submitLabel: t("pos.admin.forms.updateTerminal.submit"),
    sections: [
      {
        id: "terminal-select",
        fields: [
          {
            id: "terminal-id",
            type: "select",
            name: "terminalId",
            label: t("pos.admin.forms.fields.terminal"),
            required: true,
            width: "full",
            options: [],
          },
        ],
      },
      {
        id: "terminal-status",
        fields: [
          { id: "terminal-status-value", type: "text", name: "status", label: t("pos.admin.forms.fields.status"), required: true },
          { id: "terminal-revenue", type: "number", name: "dailyRevenue", label: t("pos.admin.forms.fields.dailyRevenue"), width: "1/2" },
          { id: "terminal-open-orders", type: "number", name: "openOrders", label: t("pos.admin.forms.fields.openOrders"), width: "1/2" },
        ],
      },
    ],
  },
  createConfig: {
    id: "pos-create-config",
    title: t("pos.admin.forms.createConfig.title"),
    submitLabel: t("pos.admin.forms.createConfig.submit"),
    sections: [
      {
        id: "config",
        fields: [
          { id: "config-name", type: "text", name: "name", label: t("pos.admin.forms.fields.name"), required: true },
          { id: "config-active", type: "switch", name: "isActive", label: t("pos.admin.forms.fields.activeByDefault"), defaultValue: true },
        ],
      },
    ],
  },
  activateConfig: {
    id: "pos-activate-config",
    title: t("pos.admin.forms.activateConfig.title"),
    submitLabel: t("pos.admin.forms.activateConfig.submit"),
    sections: [
      {
        id: "config",
        fields: [
          { id: "config-id", type: "select", name: "configId", label: t("pos.admin.forms.fields.config"), required: true, options: [] },
        ],
      },
    ],
  },
  deactivateConfig: {
    id: "pos-deactivate-config",
    title: t("pos.admin.forms.deactivateConfig.title"),
    submitLabel: t("pos.admin.forms.deactivateConfig.submit"),
    sections: [
      {
        id: "config",
        fields: [
          { id: "config-id", type: "select", name: "configId", label: t("pos.admin.forms.fields.config"), required: true, options: [] },
        ],
      },
    ],
  },
  openSession: {
    id: "pos-open-session",
    title: t("pos.admin.forms.openSession.title"),
    submitLabel: t("pos.admin.forms.openSession.submit"),
    sections: [
      {
        id: "session",
        fields: [
          { id: "config-id", type: "select", name: "configId", label: t("pos.admin.forms.fields.config"), required: true, width: "1/2", options: [] },
          { id: "opening-balance", type: "number", name: "openingBalance", label: t("pos.admin.forms.fields.openingBalance"), width: "1/2" },
        ],
      },
    ],
  },
  computeTotals: {
    id: "pos-compute-session-totals",
    title: t("pos.admin.forms.computeTotals.title"),
    submitLabel: t("pos.admin.forms.computeTotals.submit"),
    sections: [
      {
        id: "session",
        fields: [
          { id: "session-id", type: "select", name: "sessionId", label: t("pos.admin.forms.fields.session"), required: true, options: [] },
        ],
      },
    ],
  },
  closeSession: {
    id: "pos-close-session",
    title: t("pos.admin.forms.closeSession.title"),
    submitLabel: t("pos.admin.forms.closeSession.submit"),
    sections: [
      {
        id: "session",
        fields: [
          { id: "session-id", type: "select", name: "sessionId", label: t("pos.admin.forms.fields.session"), required: true, width: "1/2", options: [] },
          { id: "closing-balance", type: "number", name: "closingBalance", label: t("pos.admin.forms.fields.closingBalance"), width: "1/2" },
        ],
      },
    ],
  },
})
