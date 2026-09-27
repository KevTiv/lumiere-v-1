import { test } from "@playwright/test"

// COV-11 scaffold — see docs/plan/erp-cov11-expense-sheet-lifecycle-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-11 Expense sheet submit → approve → post → reimburse", { tag: ["@cov-scaffold", "@cov11"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-11):
    //   1. drive `submit_expense_sheet` through /expenses and resolve the exact effect
    //   2. drive `approve_expense_sheet` through /expenses and resolve the exact effect
    //   3. drive `post_expense_sheet` through /expenses and resolve the exact effect
    //   4. drive `create_expense_reimbursement_payment` through /expenses and resolve the exact effect
    //   - after each step: exact snapshot of expense-sheets by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
