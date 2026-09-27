import { test } from "@playwright/test"

// COV-14 scaffold — see docs/plan/erp-cov14-helpdesk-ticket-lifecycle-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-14 Ticket assign → close → reopen", { tag: ["@cov-scaffold", "@cov14"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-14):
    //   1. drive `assign_ticket` through /helpdesk and resolve the exact effect
    //   2. drive `close_ticket` through /helpdesk and resolve the exact effect
    //   3. drive `reopen_ticket` through /helpdesk and resolve the exact effect
    //   - after each step: exact snapshot of helpdesk-tickets by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
