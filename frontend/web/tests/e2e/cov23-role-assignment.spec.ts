import { test } from "@playwright/test"

// COV-23 scaffold — see docs/plan/erp-cov23-role-assignment-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-23 Membership role assign → revoke", { tag: ["@cov-scaffold", "@cov23"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-23):
    //   1. drive `assign_role` through /settings and resolve the exact effect
    //   2. drive `revoke_role` through /settings and resolve the exact effect
    //   - after each step: exact snapshot of user-role-assignment by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
