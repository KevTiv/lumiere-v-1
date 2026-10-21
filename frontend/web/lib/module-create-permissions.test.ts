import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// module-dashboard-configs imports @lumiere/ui (JSX), which node:test cannot load, so the tab
// declarations are read from source: each createAction must be followed by its createPermission.
const source = readFileSync(new URL("./module-dashboard-configs.ts", import.meta.url), "utf8")

/** tab createAction -> resource the matching create reducer passes to check_permission(..., "create"). */
const expected: Array<[string, string]> = [
  ["createSaleOrder", "sale_order"],
  ["createPurchaseOrder", "purchase_order"],
  ["createProduct", "product"],
  ["createStockPicking", "stock_picking"],
  ["createLead", "lead"],
  ["createOpportunity", "opportunity"],
  ["createContact", "contact"],
  ["createTicket", "helpdesk_ticket"],
  ["createProject", "project_project"],
  ["createExpense", "hr_expense"],
  ["createEmployee", "hr_employee"],
  ["createManufacturingOrder", "mrp_production"],
  ["createSubscription", "subscription"],
  ["createInvoice", "account_move"],
  ["createBill", "account_move"],
]

for (const [action, resource] of expected) {
  test(`tab ${action} is gated by ${resource}:create`, () => {
    const pattern = new RegExp(
      `createAction: "${action}",\\s*createPermission: \\{ resource: "${resource}", action: "create" \\},`,
    )
    assert.match(source, pattern)
  })
}
