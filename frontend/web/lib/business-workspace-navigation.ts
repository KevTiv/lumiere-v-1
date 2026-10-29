import type { TFunction } from "i18next"
import type { ModuleWorkspaceNav } from "@lumiere/ui/lib/module-types"

export type BusinessWorkspaceModule = "sales" | "crm" | "purchasing" | "reports" | "expenses" | "documents" | "calendar" | "messages"
type Group = readonly [id: string, tabIds: readonly string[]]

// Navigation metadata only. Runtime clients keep their canonical tabs, permissions,
// filters and record actions; unavailable destinations are removed by the renderer.
const definitions: Record<BusinessWorkspaceModule, { workspaces: readonly Group[]; overflow?: readonly Group[] }> = {
  sales: {
    workspaces: [
      ["overview", ["dashboard", "ops"]],
      ["orders", ["orders", "order-lines", "returns", "invoices"]],
      ["fulfillment", ["deliveries", "fulfillment"]],
      ["pricing", ["pricelists", "pricelist-items", "loyalty-programs", "loyalty-cards"]],
    ],
    overflow: [["configuration", ["delivery-price-rules", "delivery-carriers", "shipping-methods", "pos-payment-methods", "commission-plans"]]],
  },
  crm: {
    workspaces: [
      ["myWork", ["my-activities"]],
      ["overview", ["dashboard"]],
      ["pipeline", ["leads", "opportunities", "opportunity-lines"]],
      ["contacts", ["contacts", "contact-segments", "duplicates"]],
      ["activities", ["activities"]],
    ],
    overflow: [["configuration", ["contact-tags", "contact-categories", "attribution", "pipeline-admin"]]],
  },
  purchasing: {
    workspaces: [
      ["overview", ["dashboard", "operations"]],
      ["orders", ["orders", "lines", "purchase-returns", "landed-costs"]],
      ["sourcing", ["requisitions", "rfqs", "rfq-bids", "blanket-orders"]],
      ["suppliers", ["vendors", "supplier-intakes", "partner-banks"]],
    ],
  },
  reports: {
    workspaces: [
      ["overview", ["dashboard", "owner-reports"]],
      ["financial", ["reports", "statements", "trial-balance", "vat-report"]],
      ["analytics", ["dashboards", "pivot-explorer"]],
      ["schedules", ["scheduled-reports"]],
    ],
    overflow: [["configuration", ["report-templates", "dashboard-widgets", "analytics-metrics"]], ["analysis", ["query-builder"]]],
  },
  expenses: {
    workspaces: [
      ["overview", ["dashboard"]],
      ["expenses", ["expenses"]],
      ["expenseReports", ["expense-sheets"]],
      ["operations", ["inbox", "operations", "card-reconciliation"]],
    ],
    overflow: [["configuration", ["expense-settings"]]],
  },
  documents: {
    workspaces: [
      ["files", ["documents"]],
      ["knowledge", ["knowledge-base"]],
      ["templates", ["document-templates", "mail-templates"]],
    ],
    overflow: [
      ["manage", ["document-folders", "knowledge-categories", "document-processing", "document-insights", "documents-recycle-bin"]],
      ["overview", ["dashboard"]],
    ],
  },
  calendar: {
    workspaces: [
      ["schedule", ["calendar", "events"]],
      ["activities", ["activities"]],
    ],
    overflow: [["overview", ["dashboard"]]],
  },
  messages: {
    workspaces: [
      ["conversations", ["messages"]],
      ["notifications", ["notifications"]],
    ],
    overflow: [
      ["following", ["followers"]],
      ["messageBatches", ["message-batches"]],
      ["overview", ["dashboard"]],
    ],
  },
}

const productivityLabels: Record<string, string> = {
  files: "Files",
  knowledge: "Knowledge",
  templates: "Templates",
  manage: "Manage",
  schedule: "Schedule",
  conversations: "Conversations",
  notifications: "Notifications",
  following: "Following",
  messageBatches: "Message batches",
}

export function businessWorkspaceNavigation(module: BusinessWorkspaceModule, t: TFunction): ModuleWorkspaceNav {
  const groups = (items: readonly Group[]) => items.map(([id, tabIds]) => ({
    id, label: productivityLabels[id]
      ? t(`productivity.navigation.${id}`, { defaultValue: productivityLabels[id] })
      : module === "reports" && ["overview", "financial", "analytics", "schedules", "configuration", "analysis"].includes(id)
        ? t(`reports.workspace.${({ overview: "run", financial: "saved", analytics: "dashboards", schedules: "schedules", configuration: "authoring", analysis: "analysis" } as Record<string, string>)[id]}`)
        : t(`modules.workspaces.${id}`), tabIds,
  }))
  return {
    label: t("modules.workspaces.label"),
    overflowLabel: t("modules.workspaces.advanced"),
    workspaces: groups(definitions[module].workspaces),
    overflow: groups(definitions[module].overflow ?? []),
  }
}
