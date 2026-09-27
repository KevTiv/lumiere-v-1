import { test } from "@playwright/test"

// COV-12 scaffold — see docs/plan/erp-cov12-subscription-invoice-run-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-12 One recurring invoice run", { tag: ["@cov-scaffold", "@cov12"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-12):
    //   1. drive `generate_subscription_invoice` through /subscriptions and resolve the exact effect
    //   2. drive `pay_subscription_invoice` through /subscriptions and resolve the exact effect
    //   - after each step: exact snapshot of subscriptions by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
