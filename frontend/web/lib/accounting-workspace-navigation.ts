import type { TFunction } from "i18next"
import type { ModuleWorkspaceNav } from "@lumiere/ui/lib/module-types"

/** Navigation only: all destinations retain the Accounting module's canonical tab IDs. */
export const accountingWorkspaceNavigation = (t: TFunction): ModuleWorkspaceNav => ({
  label: t("accounting.workspaces.label", { defaultValue: "Accounting workspaces" }),
  overflowLabel: t("accounting.workspaces.configuration", { defaultValue: "Advanced / Configuration" }),
  workspaces: [
    { id: "overview", label: t("accounting.workspaces.overview", { defaultValue: "Overview" }), tabIds: ["dashboard"] },
    { id: "receivables", label: t("accounting.workspaces.receivables", { defaultValue: "Receivables" }), tabIds: ["invoices", "credit-control"] },
    { id: "payables", label: t("accounting.workspaces.payables", { defaultValue: "Payables" }), tabIds: ["bills"] },
    { id: "banking", label: t("modules.tabGroups.banking", { defaultValue: "Banking" }), tabIds: ["bank-statements", "payments", "payment-operations", "reconciliation-widgets"] },
    { id: "ledger", label: t("modules.tabGroups.ledger", { defaultValue: "Ledger" }), tabIds: ["journal-entries", "move-lines", "accounts"] },
    { id: "planning", label: t("modules.tabGroups.planning", { defaultValue: "Planning" }), tabIds: ["budgets", "analytic-lines", "fixed-assets", "amortization"] },
    { id: "close", label: t("modules.tabGroups.close", { defaultValue: "Close" }), tabIds: ["period-close", "account-periods", "fx-revaluation", "tax-deadlines"] },
  ],
  overflow: [
    { id: "tax-setup", label: t("accounting.workspaces.taxSetup", { defaultValue: "Taxes" }), tabIds: ["taxes", "tax-groups", "tax-jurisdictions", "tax-schedules"] },
    { id: "accounting-setup", label: t("modules.tabGroups.setup", { defaultValue: "Configuration" }), tabIds: ["account-journals", "fiscal-years", "payment-terms", "payment-term-lines", "analytic", "analytic-distribution"] },
    { id: "group-accounting", label: t("accounting.workspaces.groupAccounting", { defaultValue: "Group accounting" }), tabIds: ["consolidation", "intercompany-rules", "intercompany-transactions"] },
  ],
})
