import { test } from "@playwright/test"

// COV-16 scaffold — see docs/plan/erp-cov16-iot-alert-resolve-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-16 Device alert → acknowledge/resolve", { tag: ["@cov-scaffold", "@cov16"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-16):
    //   1. drive `acknowledge_iot_action` through /iot and resolve the exact effect
    //   2. drive `resolve_iot_alert` through /iot and resolve the exact effect
    //   - after each step: exact snapshot of iot-alerts by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
