import { test } from "@playwright/test"

// COV-18 scaffold — see docs/plan/erp-cov18-document-lock-version-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-18 Upload/version → lock/unlock one document", { tag: ["@cov-scaffold", "@cov18"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-18):
    //   1. drive `lock_document` through /documents and resolve the exact effect
    //   2. drive `unlock_document` through /documents and resolve the exact effect
    //   - after each step: exact snapshot of documents by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
