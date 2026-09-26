import { test } from "@playwright/test"

// COV-10 scaffold — see docs/plan/erp-cov10-project-timesheet-validation-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-10 Approved timesheet validation → billing handoff", { tag: ["@cov-scaffold", "@cov10"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-10):
    //   1. drive `validate_timesheets` through /projects → Timesheets and resolve the exact effect
    //   2. drive `reject_timesheets` through /projects → Timesheets and resolve the exact effect
    //   - after each step: exact snapshot of timesheets-to-validate by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
