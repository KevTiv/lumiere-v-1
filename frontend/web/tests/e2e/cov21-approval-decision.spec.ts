import { test } from "@playwright/test"

// COV-21 scaffold — see docs/plan/erp-cov21-approval-decision-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-21 One evidence-backed human-task decision", { tag: ["@cov-scaffold", "@cov21"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-21):
    //   1. drive `claim_workflow_human_task` through /approvals and resolve the exact effect
    //   2. drive `decide_workflow_human_task` through /approvals and resolve the exact effect
    //   - after each step: exact snapshot of workflow human tasks (no resource yet) by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
