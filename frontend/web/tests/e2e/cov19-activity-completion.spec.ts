import { test } from "@playwright/test"

// COV-19 scaffold — see docs/plan/erp-cov19-activity-completion-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-19 Record-linked activity completion (then message post)", { tag: ["@cov-scaffold", "@cov19"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-19):
    //   1. drive `complete_activity` through /calendar, /messages and resolve the exact effect
    //   2. drive `post_message` through /calendar, /messages and resolve the exact effect
    //   - after each step: exact snapshot of activities by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
