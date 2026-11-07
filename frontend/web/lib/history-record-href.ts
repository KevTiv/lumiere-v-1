import { validHistoryId } from "@lumiere/query-hooks/hooks/account-move-history-model"
import { recordPageHref } from "./record-page-href"

// Each fallback selects the exact source row in its existing alpha workspace.
// It never guesses a parent document or expands navigation admission.
const HISTORY_LIST: Readonly<Record<string, readonly [module: string, tab: string]>> = {
  account_move_line: ["accounting", "move-lines"], account_account: ["accounting", "accounts"],
  account_payment: ["accounting", "payments"], account_journal: ["accounting", "account-journals"],
  contact: ["crm", "contacts"], crm_lead: ["crm", "leads"], crm_opportunity: ["crm", "opportunities"],
  lead: ["crm", "leads"], opportunity: ["crm", "opportunities"],
  sale_order_line: ["sales", "order-lines"], purchase_order_line: ["purchasing", "lines"],
  product: ["products", "products"], product_category: ["products", "product-categories"],
  stock_quant: ["warehouse", "stock"], stock_move: ["warehouse", "stock-moves"],
  stock_location: ["warehouse", "locations"], warehouse: ["warehouse", "warehouses"],
  stock_inventory: ["warehouse", "adjustments"], replenishment_rule: ["warehouse", "replenishment"],
  expense: ["expenses", "expenses"], hr_expense: ["expenses", "expenses"],
  subscription_plan: ["subscriptions", "plans"], subscription_line: ["subscriptions", "lines"],
  report_template: ["reports", "report-templates"], scheduled_report: ["reports", "scheduled-reports"],
  dashboard: ["reports", "dashboards"], document_folder: ["documents", "document-folders"],
  doc_folder: ["documents", "document-folders"], kb_category: ["documents", "knowledge-categories"],
  document_template: ["documents", "document-templates"], knowledge_article: ["documents", "knowledge-base"],
}

export function historyRecordHref(resource: string | undefined, recordId: string | undefined): string | undefined {
  if (!resource || !validHistoryId(recordId)) return undefined
  const table = resource === "expense_sheet" ? "hr_expense_sheet" : resource
  const page = recordPageHref(table, recordId)
  if (page) return page
  const list = HISTORY_LIST[resource]
  if (!list) return undefined
  const params = new URLSearchParams({ tab: list[1], filter: `id:${recordId}` })
  return `/${list[0]}?${params}`
}
