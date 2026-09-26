import { test } from "@playwright/test"

// COV-08e scaffold — see docs/plan/erp-cov08e-finance-certification-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-08e Finance module certification over 08a–d", { tag: ["@cov-scaffold", "@cov08e"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-08e):
    //   1. drive `archive_financial_report` through /accounting, /reports and resolve the exact effect
    //   - after each step: exact snapshot of financial-reports by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
