import { test } from "@playwright/test"

// COV-13 scaffold — see docs/plan/erp-cov13-pos-session-close-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-13 Session order/payment → close", { tag: ["@cov-scaffold", "@cov13"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-13):
    //   1. drive `close_pos_session` through /pos and resolve the exact effect
    //   - after each step: exact snapshot of pos-sessions by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
