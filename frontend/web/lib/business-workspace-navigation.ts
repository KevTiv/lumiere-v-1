import type { TFunction } from "i18next"
import type { ModuleWorkspaceNav } from "@lumiere/ui/lib/module-types"

export type BusinessWorkspaceModule = "sales" | "crm" | "purchasing" | "reports" | "expenses"
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
      ["operations", ["operations", "inbox"]],
    ],
  },
}

export function businessWorkspaceNavigation(module: BusinessWorkspaceModule, t: TFunction): ModuleWorkspaceNav {
  const groups = (items: readonly Group[]) => items.map(([id, tabIds]) => ({
    id, label: module === "reports" && ["overview", "financial", "analytics", "schedules", "configuration", "analysis"].includes(id)
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
