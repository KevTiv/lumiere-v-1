import assert from "node:assert/strict"
import test from "node:test"
import {
  ACCOUNTING_ACTION_WORKSPACES, ACCOUNTING_IMPORT_WORKSPACES, ACCOUNTING_SHARED_READS,
  accountingPlannedCollection, accountingReadPlan,
} from "./accounting-read-plan"

test("invoice workspace includes shared creation lookups and ledger rows without unrelated workspaces", () => {
  const plan = accountingReadPlan("invoices")
  for (const lookup of ["contacts", "products", "account-taxes", "tax-groups", "account-account-types", "account-journals", "currencies", "companies", "fiscal-years", "account-periods", "account-payment-terms", "account-move-lines"]) {
    assert.ok(plan.has(lookup), lookup)
  }
  for (const unrelated of ["budgets", "budget-lines", "bank-statements", "bank-match-candidates", "fixed-assets", "analytic-lines", "amortization-lines", "tax-jurisdictions", "consolidation-accounts", "financial-reports"]) {
    assert.ok(!plan.has(unrelated), unrelated)
  }
  assert.equal(plan.size, ACCOUNTING_SHARED_READS.length + 1)
})

test("overview reads enough to compute canonical payment residuals and bank queues", () => {
  const plan = accountingReadPlan("dashboard")
  for (const dependency of ["account-moves", "account-payments", "account-move-lines", "payment-transactions", "payment-reversals", "bank-statements", "bank-statement-lines", "tax-deadlines", "budgets"]) {
    assert.ok(plan.has(dependency), dependency)
  }
  assert.ok(!plan.has("bank-match-candidates"), "candidate search waits for the bank workbench")
  assert.ok(!plan.has("budget-lines"), "overview summary does not require budget line editors")
})

test("joined workspaces retain every secondary form and label dependency", () => {
  assert.ok(accountingReadPlan("move-lines").has("financial-reports"), "statement drill-down must revalidate the saved report scope")
  assert.ok(accountingReadPlan("tax-schedules").has("tax-jurisdictions"))
  assert.ok(accountingReadPlan("analytic-lines").has("analytic-accounts"))
  assert.ok(accountingReadPlan("analytic-distribution").has("analytic-accounts"))
  assert.ok(accountingReadPlan("fixed-assets").has("depreciation-lines"))
  assert.ok(accountingReadPlan("period-close").has("bank-statement-lines"))
  assert.ok(accountingReadPlan("period-close").has("financial-reports"))
  assert.ok(accountingReadPlan("payment-operations").has("account-payments"))
  assert.ok(accountingReadPlan("payment-operations").has("payment-reconciliations"))
})

test("original bank recovery and pending forms retain reads across navigation until dismissed", () => {
  const retained = accountingReadPlan("invoices", ["bank-statements", ACCOUNTING_ACTION_WORKSPACES.createDepreciationLine])
  for (const dependency of ["bank-statements", "bank-statement-lines", "bank-match-candidates", "account-move-lines", "fixed-assets", "depreciation-lines"]) {
    assert.ok(retained.has(dependency), dependency)
  }
  const dismissed = accountingReadPlan("invoices")
  assert.ok(!dismissed.has("bank-statements"))
  assert.ok(!dismissed.has("fixed-assets"))
})

test("an import or generic prompt pins its workspace instead of inheriting the next tab", () => {
  const plan = accountingReadPlan("payments", [ACCOUNTING_IMPORT_WORKSPACES.budgetLine, "analytic-distribution"])
  for (const dependency of ["account-payments", "budgets", "budget-lines", "budget-posts", "analytic-accounts", "analytic-distribution-models"]) assert.ok(plan.has(dependency), dependency)
  assert.ok(!plan.has("consolidation-elimination-entries"))
})

test("inactive cached collections are loading with no usable rows, never an empty ready lookup", () => {
  const stale = { state: { status: "ready" as const }, rows: [{ id: "previous-company-record" }] }
  const disabled = accountingPlannedCollection(false, stale)
  assert.equal(disabled.state.status, "loading")
  assert.deepEqual(disabled.rows, [])
  assert.equal(accountingPlannedCollection(true, stale), stale)
})

test("active denied, partial, failed and loading states preserve their source truth", () => {
  for (const status of ["denied", "partial", "error", "loading"] as const) {
    const original = { state: { status }, rows: [] }
    assert.equal(accountingPlannedCollection(true, original), original)
    assert.equal(accountingPlannedCollection(true, original).state.status, status)
  }
})
