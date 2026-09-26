import { test } from "@playwright/test"

// COV-08d2 scaffold — see docs/plan/erp-cov08d2-asset-depreciation-disposal-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-08d2 Fixed-asset depreciation board and disposal exact effects", { tag: ["@cov-scaffold", "@cov08d2"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-08d2):
    //   1. drive `compute_depreciation_board` through /accounting → Fixed assets and resolve the exact effect
    //   2. drive `dispose_account_asset` through /accounting → Fixed assets and resolve the exact effect
    //   - after each step: exact snapshot of account-assets by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
