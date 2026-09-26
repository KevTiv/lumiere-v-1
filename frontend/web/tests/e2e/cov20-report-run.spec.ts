import { test } from "@playwright/test"

// COV-20 scaffold — see docs/plan/erp-cov20-report-run-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-20 Configure → execute → export one scheduled report", { tag: ["@cov-scaffold", "@cov20"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-20):
    //   1. drive `create_scheduled_report` through /reports and resolve the exact effect
    //   2. drive `record_report_run` through /reports and resolve the exact effect
    //   - after each step: exact snapshot of scheduled-reports by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
