import { test } from "@playwright/test"

// COV-09 scaffold — see docs/plan/erp-cov09-hr-leave-approval-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-09 Leave request submit → approve/refuse", { tag: ["@cov-scaffold", "@cov09"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-09):
    //   1. drive `submit_leave` through /hr → Leave and resolve the exact effect
    //   2. drive `approve_leave` through /hr → Leave and resolve the exact effect
    //   3. drive `refuse_leave` through /hr → Leave and resolve the exact effect
    //   - after each step: exact snapshot of leave-requests by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
