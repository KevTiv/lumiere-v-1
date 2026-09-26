import { test } from "@playwright/test"

// COV-22 scaffold — see docs/plan/erp-cov22-form-publish-import-commit-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-22 Publish one form configuration; validate→commit one import", { tag: ["@cov-scaffold", "@cov22"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-22):
    //   1. drive `publish_form_configuration` through embedded surfaces (no standalone route) and resolve the exact effect
    //   2. drive `import_hr_payslip_csv` through embedded surfaces (no standalone route) and resolve the exact effect
    //   - after each step: exact snapshot of form-configs by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
