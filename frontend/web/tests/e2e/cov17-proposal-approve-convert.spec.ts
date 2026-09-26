import { test } from "@playwright/test"

// COV-17 scaffold — see docs/plan/erp-cov17-proposal-approve-convert-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-17 Versioned review → approve → convert to sale order", { tag: ["@cov-scaffold", "@cov17"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-17):
    //   1. drive `approve_proposal` through /proposals and resolve the exact effect
    //   2. drive `convert_proposal_to_sale_order` through /proposals and resolve the exact effect
    //   - after each step: exact snapshot of proposals by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
