import { test } from "@playwright/test"

// COV-15 scaffold — see docs/plan/erp-cov15-fleet-service-cost-status.md.
// Tagged @cov-scaffold (not @p0): a placeholder that reports as "fixme" until implemented.
test.describe("COV-15 Vehicle service/inspection cost history", { tag: ["@cov-scaffold", "@cov15"] }, () => {
  test.fixme("drives the bounded path with exact readback, stale replay and denied reader", async () => {
    // TODO(COV-15):
    //   1. drive `record_fleet_service` through /fleet (dedicated route now exists on main; /map stays the live-map view) and resolve the exact effect
    //   2. drive `record_fleet_inspection` through /fleet (dedicated route now exists on main; /map stays the live-map view) and resolve the exact effect
    //   - after each step: exact snapshot of fleet-service-records by id + scope + state
    //   - replay the accepted request → 422 and unchanged snapshot
    //   - replay as fixture.reader@example.test → 403 and unchanged snapshot
  })
})
